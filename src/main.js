import "./style.css";
import { EmotionWebSocket } from "./websocket.js";
import {
  emptyExpressions,
  getDominantExpression,
  normalizeExpressions,
} from "./emotionMapping.js";
import { faceApiState, featureState, outputState, webcamState } from "./state.js";

const VIDEO_WIDTH = webcamState.width;
const VIDEO_HEIGHT = webcamState.height;
const SEND_FPS = outputState.sendFps;
const SEND_INTERVAL_MS = 1000 / SEND_FPS;
const NO_FACE_GRACE_MS = 2000;
const BUILD_ID = "ml5-td-lean-refined-eye-2026-05-19-01";
const FACEMESH_TARGET_FPS = 12;
const FACEMESH_POLL_MS = 1000 / FACEMESH_TARGET_FPS;
const FACEMESH_INFERENCE_WIDTH = 192;
const FACEMESH_INFERENCE_HEIGHT = 144;
const REFINED_FACEMESH_MODEL_PATH = "./src/ml5-local-models/refined-facemesh";
const LEFT_IRIS_INDICES = [474, 475, 476, 477];
const RIGHT_IRIS_INDICES = [469, 470, 471, 472];
const LEFT_EYE_INDICES = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_INDICES = [362, 385, 387, 263, 373, 380];

const ui = {
  debugOverlay: document.getElementById("debug-overlay"),
  modelStatus: document.getElementById("model-status"),
  socketStatus: document.getElementById("socket-status"),
  dominantExpression: document.getElementById("dominant-expression"),
  dominantConfidence: document.getElementById("dominant-confidence"),
  faceCount: document.getElementById("face-count"),
  fpsStatus: document.getElementById("fps-status"),
};

let faceApi = null;
let faceMeshModel = null;
let faceMeshResults = [];
let detections = [];
let emotionReady = false;
let faceMeshReady = false;
let video = null;
let faceMeshPredictCount = 0;
let lastFaceMeshPredictTime = 0;
let lastPayload = buildNoFacePayload();
let lastFacePayload = buildNoFacePayload();
let lastFaceMeshPayload = buildNoFaceMeshPayload();
let lastEyeTrackPayload = buildNoEyeTrackPayload();
let lastFaceTime = 0;
let lastSendTime = 0;
let cameraStarted = false;
let centerMessage = "Starting camera...";
let p5Instance = null;
let lastVideoTime = -1;
let lastVideoFrameChangeTime = 0;
let faceMeshPollTimer = null;
let faceMeshPollingActive = false;
let lastFaceMeshDurationMs = 0;
let faceMeshFps = 0;
let faceMeshFpsCounter = 0;
let lastFaceMeshFpsTime = 0;
let faceMeshInputCanvas = null;
let faceMeshInputContext = null;
let lastSentFaceMeshPredictCount = -1;
let lastSentEyeTrackPredictCount = -1;

handleQueryParams();
updateStartupFeatureReadout();

const emotionSocket = new EmotionWebSocket({
  onStatusChange: ({ connected, message }) => {
    ui.socketStatus.textContent = `WebSocket: ${message}`;
    ui.socketStatus.dataset.connected = String(connected);

    if (connected) {
      sendWebcamDevices();
    }
  },
  onMessage: handleSocketMessage,
});
emotionSocket.connect();

new window.p5((p) => {
  p5Instance = p;

  p.setup = () => {
    const canvas = p.createCanvas(window.innerWidth, window.innerHeight);
    canvas.parent("canvas-holder");
    p.pixelDensity(1);
    p.textFont("monospace");
    startWebcam(p);
  };

  p.draw = () => {
    p.background(10);

    drawVideoCover(p);

    if (featureState.showOverlays) {
      drawDetectionOverlay(p, detections);
      drawFaceMeshOverlay(p, faceMeshResults);
    }
    drawWaitingMessage(p);

    const now = performance.now();
    updateFpsReadout(p, now);

    if (now - lastSendTime >= SEND_INTERVAL_MS) {
      lastSendTime = now;
      sendEnabledPayloads();
    }
  };

  p.windowResized = () => {
    p.resizeCanvas(window.innerWidth, window.innerHeight);
  };
});

async function startWebcam(p) {
  centerMessage = "Requesting camera access...";

  if (!navigator.mediaDevices?.getUserMedia) {
    centerMessage = "Camera error: getUserMedia is not available in this browser.";
    ui.modelStatus.textContent = centerMessage;
    return;
  }

  try {
    const stream = await getWebcamStream();

    stopCurrentStream();
    webcamState.currentStream = stream;
    video = p.createVideo([]);
    video.elt.srcObject = stream;
    video.elt.autoplay = true;
    video.elt.muted = true;
    video.elt.playsInline = true;
    video.size(VIDEO_WIDTH, VIDEO_HEIGHT);
    video.hide();
    await video.elt.play();
    cameraStarted = true;
    lastVideoTime = -1;
    lastVideoFrameChangeTime = performance.now();
    await sendWebcamDevices();
    updateWebcamReadout();
    onWebcamReady();
  } catch (error) {
    console.error(error);
    centerMessage = `Camera error: ${error.name}. ${error.message}`;
    ui.modelStatus.textContent = centerMessage;
  }
}

function handleQueryParams() {
  const params = new URLSearchParams(window.location.search);

  // Support Torin/MoveNet-style URLs:
  // http://localhost:<port>?webcamId=<deviceId-or-label>
  const webcamId = normalizeWebcamValue(params.get("webcamId"));
  const webcam = normalizeWebcamValue(params.get("Webcam"));

  if (webcamId) {
    webcamState.selectedLabel = webcamId;
  }

  if (webcam) {
    webcamState.selectedLabel = webcam;
  }

  featureState.emotion = readBooleanParam(params, ["Emotion", "emotion"], featureState.emotion);
  featureState.faceMeshOutput = readBooleanParam(params, ["FaceMesh", "Facemesh", "faceMesh", "facemesh"], featureState.faceMeshOutput);
  featureState.eyeTrack = readBooleanParam(params, ["EyeTrack", "Eyetrack", "eyeTrack", "eyetrack"], featureState.eyeTrack);
  featureState.showOverlays = readBooleanParam(params, ["ShowOverlays", "Showoverlays", "showOverlays", "showoverlays"], featureState.showOverlays);
  featureState.showUI = readBooleanParam(params, ["ShowUI", "Showui", "showUI", "showui"], featureState.showUI);
  featureState.webcamFlip = readBooleanParam(params, ["Wflip", "Flip", "flip"], featureState.webcamFlip);

  // EyeTrack uses the ML5 FaceMesh model internally, but it does not need to
  // send or draw the full face mesh unless the FaceMesh toggle is also enabled.
  featureState.faceMesh = featureState.faceMeshOutput || featureState.eyeTrack;
  applyRuntimeVisualState();
}

function updateStartupFeatureReadout() {
  const enabled = [];
  if (featureState.emotion) {
    enabled.push("emotion");
  }
  if (featureState.faceMeshOutput) {
    enabled.push(featureState.eyeTrack ? "facemesh+eyetrack" : "facemesh");
  } else if (featureState.eyeTrack) {
    enabled.push("eyetrack");
  }

  const message = enabled.length
    ? `features: ${enabled.join(", ")} | Emotion=${Number(featureState.emotion)} Facemesh=${Number(featureState.faceMeshOutput)} Eyetrack=${Number(featureState.eyeTrack)}`
    : `features: none | Emotion=${Number(featureState.emotion)} Facemesh=${Number(featureState.faceMeshOutput)} Eyetrack=${Number(featureState.eyeTrack)}`;
  ui.modelStatus.textContent = message;
  ui.dominantExpression.textContent = featureState.eyeTrack ? "eyetrack" : featureState.faceMeshOutput ? "facemesh" : "emotion";

  console.log(`ML5 TouchDesigner build: ${BUILD_ID}`);
}

function applyRuntimeVisualState() {
  if (ui.debugOverlay) {
    ui.debugOverlay.style.display = featureState.showUI ? "block" : "none";
  }
}

function readBooleanParam(params, names, fallback) {
  for (const name of names) {
    if (!params.has(name)) {
      continue;
    }

    return parseBoolean(params.get(name), fallback);
  }

  return fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === true || value === false) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "off", "no", "none", "null", "undefined"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function normalizeWebcamValue(value) {
  if (!value) {
    return "";
  }

  const normalized = String(value).trim();
  const lower = normalized.toLowerCase();

  if (
    lower === "false" ||
    lower === "none" ||
    lower === "null" ||
    lower === "undefined" ||
    lower === "default"
  ) {
    return "";
  }

  return normalized;
}

async function getWebcamStream() {
  const baseVideoConstraints = {
    width: { ideal: VIDEO_WIDTH },
    height: { ideal: VIDEO_HEIGHT },
    frameRate: { ideal: webcamState.targetFrameRate },
  };

  const preferredDeviceId = await resolvePreferredDeviceId();

  if (preferredDeviceId) {
    try {
      return await requestWebcamStream({
        ...baseVideoConstraints,
        deviceId: { exact: preferredDeviceId },
      });
    } catch (error) {
      console.warn("Preferred webcam failed, falling back to default camera:", error);
      webcamState.selectedDeviceId = "";
      webcamState.selectedLabel = "";
    }
  }

  return requestWebcamStream(baseVideoConstraints);
}

async function resolvePreferredDeviceId() {
  if (webcamState.selectedDeviceId) {
    return webcamState.selectedDeviceId;
  }

  if (!webcamState.selectedLabel) {
    return "";
  }

  const devices = await getWebcamDevices();
  const selected = findWebcamDevice(devices, webcamState.selectedLabel);

  if (!selected) {
    return "";
  }

  webcamState.selectedDeviceId = selected.deviceId;
  return selected.deviceId;
}

function requestWebcamStream(videoConstraints) {
  return navigator.mediaDevices.getUserMedia({
    video: videoConstraints,
    audio: false,
  });
}

function stopCurrentStream() {
  if (!webcamState.currentStream) {
    return;
  }

  for (const track of webcamState.currentStream.getTracks()) {
    track.stop();
  }

  webcamState.currentStream = null;
}

async function changeWebcam(webcamLabel) {
  webcamState.selectedLabel = normalizeWebcamValue(webcamLabel);

  if (!webcamState.selectedLabel) {
    webcamState.selectedDeviceId = "";
    centerMessage = "Switching webcam to default camera...";

    if (p5Instance) {
      if (video) {
        video.remove();
        video = null;
      }
      emotionReady = false;
      faceMeshReady = false;
      stopFaceMeshPolling();
      cameraStarted = false;
      detections = [];
      faceMeshResults = [];
      await startWebcam(p5Instance);
    }
    return;
  }

  const devices = await getWebcamDevices();
  const selected = findWebcamDevice(devices, webcamState.selectedLabel);

  if (!selected) {
    console.warn("Could not find webcam:", webcamState.selectedLabel);
    emotionSocket.sendJson({ error: "webcamNotFound", webcam: webcamState.selectedLabel });
    return;
  }

  webcamState.selectedDeviceId = selected.deviceId;
  webcamState.selectedLabel = selected.label;
  centerMessage = `Switching webcam to ${selected.label}...`;
  updateWebcamReadout();

  if (p5Instance) {
    if (video) {
      video.remove();
      video = null;
    }
    emotionReady = false;
    faceMeshReady = false;
    stopFaceMeshPolling();
    cameraStarted = false;
    detections = [];
    faceMeshResults = [];
    await startWebcam(p5Instance);
  }
}

function findWebcamDevice(devices, value) {
  const selectedValue = normalizeWebcamValue(value);

  if (!selectedValue) {
    return null;
  }

  const directMatch = devices.find(
    (device) => device.label === selectedValue || device.deviceId === selectedValue
  );

  if (directMatch) {
    return directMatch;
  }

  const numericIndex = Number(selectedValue);
  if (Number.isInteger(numericIndex)) {
    if (numericIndex >= 0 && numericIndex < devices.length) {
      return devices[numericIndex];
    }

    const oneBasedIndex = numericIndex - 1;
    if (oneBasedIndex >= 0 && oneBasedIndex < devices.length) {
      return devices[oneBasedIndex];
    }
  }

  return null;
}

async function getWebcamDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return [];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "videoinput")
    .map((device, index) => ({
      label: device.label || `Camera ${index + 1}`,
      deviceId: device.deviceId,
    }));
}

async function sendWebcamDevices() {
  try {
    const devices = await getWebcamDevices();
    emotionSocket.sendJson({
      type: "webcamDevices",
      devices: devices.map(({ label, deviceId }) => ({ label, deviceId })),
    });
  } catch (error) {
    console.error(error);
  }
}

function handleSocketMessage(message) {
  if (!message || message === "pong") {
    return;
  }

  try {
    const data = JSON.parse(message);
    if (Object.prototype.hasOwnProperty.call(data, "Webcam")) {
      changeWebcam(data.Webcam);
    }

    if (Object.prototype.hasOwnProperty.call(data, "Wflip")) {
      featureState.webcamFlip = parseBoolean(data.Wflip, featureState.webcamFlip);
    }

    if (
      Object.prototype.hasOwnProperty.call(data, "Showoverlays") ||
      Object.prototype.hasOwnProperty.call(data, "ShowOverlays")
    ) {
      const value = Object.prototype.hasOwnProperty.call(data, "Showoverlays")
        ? data.Showoverlays
        : data.ShowOverlays;
      featureState.showOverlays = parseBoolean(value, featureState.showOverlays);
    }

    if (
      Object.prototype.hasOwnProperty.call(data, "Showui") ||
      Object.prototype.hasOwnProperty.call(data, "ShowUI")
    ) {
      const value = Object.prototype.hasOwnProperty.call(data, "Showui")
        ? data.Showui
        : data.ShowUI;
      featureState.showUI = parseBoolean(value, featureState.showUI);
      applyRuntimeVisualState();
    }

    if (
      Object.prototype.hasOwnProperty.call(data, "Emotion") ||
      Object.prototype.hasOwnProperty.call(data, "FaceMesh") ||
      Object.prototype.hasOwnProperty.call(data, "Facemesh") ||
      Object.prototype.hasOwnProperty.call(data, "EyeTrack") ||
      Object.prototype.hasOwnProperty.call(data, "Eyetrack")
    ) {
      window.location.reload();
    }
  } catch (error) {
    console.warn("Ignoring non-JSON websocket message:", message);
  }
}

function onWebcamReady() {
  ui.modelStatus.textContent = "Webcam started. Loading enabled ML models...";
  centerMessage = "Loading enabled ML models...";

  loadModels();
}

async function loadModels() {
  const enabledModels = [];

  try {
    if (featureState.emotion) {
      enabledModels.push("emotion");
      ui.modelStatus.textContent = "Loading emotion model...";
      const modelPath = faceApiState.modelPath;
      faceApi = window.faceapi;
      await Promise.all([
        faceApi.nets.tinyFaceDetector.loadFromUri(modelPath),
        faceApi.nets.faceLandmark68TinyNet.loadFromUri(modelPath),
        faceApi.nets.faceExpressionNet.loadFromUri(modelPath),
      ]);
      emotionReady = true;
      detectFaces();
    }

    if (featureState.faceMesh) {
      enabledModels.push(featureState.faceMeshOutput && featureState.eyeTrack ? "facemesh+eyetrack" : featureState.eyeTrack ? "eyetrack" : "facemesh");
      ui.modelStatus.textContent = featureState.eyeTrack
        ? "Loading EyeTrack model..."
        : "Loading FaceMesh model...";
      await loadFaceMesh();
    }

    if (!enabledModels.length) {
      centerMessage = "No ML features enabled.";
      ui.modelStatus.textContent = centerMessage;
      return;
    }

    ui.modelStatus.textContent = `enabled: ${enabledModels.join(", ")}`;
    centerMessage = "";
  } catch (error) {
    console.error(error);
    centerMessage = `Model load error: ${error.message}`;
    ui.modelStatus.textContent = centerMessage;
  }
}

async function detectFaces() {
  if (!faceApi || !emotionReady) {
    return;
  }

  try {
    const options = new faceApi.TinyFaceDetectorOptions({
      inputSize: faceApiState.options.inputSize,
      scoreThreshold: faceApiState.options.minConfidence,
    });

    const results = await faceApi
      .detectAllFaces(video.elt, options)
      .withFaceLandmarks(true)
      .withFaceExpressions();

    detections = Array.isArray(results) ? results : [];
    lastPayload = buildPayloadFromDetections(detections);
    updateReadout(lastPayload);
  } catch (error) {
    console.error(error);
    ui.modelStatus.textContent = "Detection error. See browser console.";
    window.setTimeout(detectFaces, 250);
    return;
  }

  window.requestAnimationFrame(detectFaces);
}

async function loadFaceMesh() {
  if (!window.ml5?.faceMesh) {
    throw new Error("ml5.faceMesh is not available in the bundled ml5 version.");
  }

  await configureTfBackend();

  faceMeshModel = window.ml5.faceMesh({
    runtime: "tfjs",
    maxFaces: 1,
    refineLandmarks: true,
    flipHorizontal: false,
    detectorModelUrl: `${REFINED_FACEMESH_MODEL_PATH}/detector-short/model.json`,
    landmarkModelUrl: `${REFINED_FACEMESH_MODEL_PATH}/attention-mesh/model.json`,
  });

  await waitForFaceMeshInternalModel();

  faceMeshReady = true;
  startFaceMeshPolling();
  updateFaceMeshReadout(lastFaceMeshPayload);
}

function getFaceMeshInferenceSize() {
  return {
    width: FACEMESH_INFERENCE_WIDTH,
    height: FACEMESH_INFERENCE_HEIGHT,
  };
}

async function configureTfBackend() {
  const tf = window.ml5?.tf;
  if (!tf?.setBackend) {
    return;
  }

  try {
    await tf.setBackend("webgl");
    if (typeof tf.ready === "function") {
      await tf.ready();
    }
  } catch (error) {
    console.warn("Could not switch TensorFlow.js backend to WebGL:", error);
  }
}

async function waitForFaceMeshInternalModel() {
  const startedAt = performance.now();

  if (faceMeshModel?.ready && typeof faceMeshModel.ready.then === "function") {
    faceMeshModel = await faceMeshModel.ready;
  }

  while (!faceMeshModel?.model) {
    if (performance.now() - startedAt > 10000) {
      throw new Error("FaceMesh internal model did not initialize.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

function startFaceMeshPolling() {
  stopFaceMeshPolling();
  faceMeshPollingActive = true;
  lastSentFaceMeshPredictCount = -1;
  lastSentEyeTrackPredictCount = -1;
  lastFaceMeshFpsTime = performance.now();
  faceMeshPollTimer = window.setTimeout(startFaceMeshPollOnce, 0);
}

function stopFaceMeshPolling() {
  faceMeshPollingActive = false;

  if (!faceMeshPollTimer) {
    return;
  }

  window.clearTimeout(faceMeshPollTimer);
  faceMeshPollTimer = null;
}

function scheduleNextFaceMeshPoll(startedAt) {
  if (!faceMeshPollingActive) {
    return;
  }

  const elapsed = performance.now() - startedAt;
  const delay = Math.max(0, FACEMESH_POLL_MS - elapsed);
  faceMeshPollTimer = window.setTimeout(startFaceMeshPollOnce, delay);
}

async function startFaceMeshPollOnce() {
  if (!faceMeshPollingActive) {
    return;
  }

  const startedAt = performance.now();

  if (!faceMeshReady || !faceMeshModel || !video?.elt) {
    scheduleNextFaceMeshPoll(startedAt);
    return;
  }

  if (video.elt.readyState < 2 || !video.elt.videoWidth || !video.elt.videoHeight) {
    scheduleNextFaceMeshPoll(startedAt);
    return;
  }

  try {
    const input = prepareFaceMeshInput();
    const results = await faceMeshModel.detect(input);
    lastFaceMeshDurationMs = Math.round(performance.now() - startedAt);
    faceMeshPredictCount += 1;
    lastFaceMeshPredictTime = performance.now();
    updateFaceMeshFps(lastFaceMeshPredictTime);
    faceMeshResults = scaleFaceMeshResults(Array.isArray(results) ? results : []);
    lastFaceMeshPayload = buildFaceMeshPayload(faceMeshResults, featureState.faceMeshOutput);
    lastEyeTrackPayload = buildEyeTrackPayload(faceMeshResults);
    updateFaceMeshReadout(lastFaceMeshPayload);
  } catch (error) {
    console.error("FaceMesh prediction error:", error);
    ui.modelStatus.textContent = `FaceMesh prediction error: ${error.message}`;
  }

  scheduleNextFaceMeshPoll(startedAt);
}

function prepareFaceMeshInput() {
  const inputSize = getFaceMeshInferenceSize();

  if (
    !faceMeshInputCanvas ||
    faceMeshInputCanvas.width !== inputSize.width ||
    faceMeshInputCanvas.height !== inputSize.height
  ) {
    faceMeshInputCanvas = document.createElement("canvas");
    faceMeshInputCanvas.width = inputSize.width;
    faceMeshInputCanvas.height = inputSize.height;
    faceMeshInputContext = faceMeshInputCanvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    });
  }

  faceMeshInputContext.drawImage(
    video.elt,
    0,
    0,
    inputSize.width,
    inputSize.height
  );

  return faceMeshInputCanvas;
}

function scaleFaceMeshResults(results) {
  if (!results.length) {
    return [];
  }

  const inputSize = getFaceMeshInferenceSize();
  const scaleX = VIDEO_WIDTH / inputSize.width;
  const scaleY = VIDEO_HEIGHT / inputSize.height;
  return results.map((face) => scaleFaceMeshResult(face, scaleX, scaleY));
}

function scaleFaceMeshResult(face, scaleX, scaleY) {
  if (!face || typeof face !== "object") {
    return face;
  }

  return {
    ...face,
    keypoints: scalePointList(face.keypoints, scaleX, scaleY),
    scaledMesh: scalePointList(face.scaledMesh, scaleX, scaleY),
    mesh: scalePointList(face.mesh, scaleX, scaleY),
    annotations: scaleAnnotations(face.annotations, scaleX, scaleY),
    leftEye: scaleNestedKeypoints(face.leftEye, scaleX, scaleY),
    rightEye: scaleNestedKeypoints(face.rightEye, scaleX, scaleY),
    leftIris: scaleNestedKeypoints(face.leftIris, scaleX, scaleY),
    rightIris: scaleNestedKeypoints(face.rightIris, scaleX, scaleY),
  };
}

function scaleNestedKeypoints(value, scaleX, scaleY) {
  if (!value || typeof value !== "object") {
    return value;
  }

  return {
    ...value,
    keypoints: scalePointList(value.keypoints, scaleX, scaleY),
  };
}

function scaleAnnotations(annotations, scaleX, scaleY) {
  if (!annotations || typeof annotations !== "object") {
    return annotations;
  }

  const scaled = {};
  for (const key of Object.keys(annotations)) {
    scaled[key] = scalePointList(annotations[key], scaleX, scaleY);
  }
  return scaled;
}

function scalePointList(points, scaleX, scaleY) {
  if (!Array.isArray(points)) {
    return points;
  }

  return points.map((point) => scalePoint(point, scaleX, scaleY));
}

function scalePoint(point, scaleX, scaleY) {
  if (Array.isArray(point)) {
    const x = (Number(point[0]) || 0) * scaleX;
    return [
      mirrorVideoX(x),
      (Number(point[1]) || 0) * scaleY,
      Number(point[2]) || 0,
    ];
  }

  if (!point || typeof point !== "object") {
    return point;
  }

  const x = (Number(point.x) || 0) * scaleX;
  return {
    ...point,
    x: mirrorVideoX(x),
    y: (Number(point.y) || 0) * scaleY,
    z: Number(point.z) || 0,
  };
}

function mirrorVideoX(x) {
  return featureState.webcamFlip ? VIDEO_WIDTH - x : x;
}

function mirrorVideoBox(box) {
  if (!featureState.webcamFlip || !box) {
    return box;
  }

  return {
    ...box,
    x: VIDEO_WIDTH - box.x - box.width,
  };
}

function updateFaceMeshFps(now) {
  faceMeshFpsCounter += 1;

  const elapsed = now - lastFaceMeshFpsTime;
  if (elapsed < 1000) {
    return;
  }

  faceMeshFps = (faceMeshFpsCounter * 1000) / elapsed;
  faceMeshFpsCounter = 0;
  lastFaceMeshFpsTime = now;
}

function sendEnabledPayloads() {
  if (featureState.emotion) {
    emotionSocket.sendJson(buildSendPayload(lastPayload));
  }

  if (featureState.faceMeshOutput) {
    if (faceMeshPredictCount !== lastSentFaceMeshPredictCount) {
      lastSentFaceMeshPredictCount = faceMeshPredictCount;
      emotionSocket.sendJson({
        ...lastFaceMeshPayload,
        timestamp: Date.now(),
      });
    }
  }

  if (featureState.eyeTrack) {
    if (faceMeshPredictCount !== lastSentEyeTrackPredictCount) {
      lastSentEyeTrackPredictCount = faceMeshPredictCount;
      emotionSocket.sendJson({
        ...lastEyeTrackPayload,
        timestamp: Date.now(),
      });
    }
  }
}

function buildPayloadFromDetections(results) {
  if (!results.length) {
    const heldPayload = buildHeldFacePayload();
    if (heldPayload) {
      return heldPayload;
    }

    return buildNoFacePayload();
  }

  const primaryFace = results[0];
  const expressions = normalizeExpressions(primaryFace.expressions);
  const dominant = getDominantExpression(primaryFace.expressions);

  const payload = {
    type: "ml5_face_expression",
    timestamp: Date.now(),
    hasFace: true,
    faceCount: results.length,
    dominantExpression: dominant.dominantExpression,
    dominantValue: dominant.dominantValue,
    dominantConfidence: dominant.dominantConfidence,
    expressions,
    box: getBox(primaryFace),
  };

  lastFacePayload = payload;
  lastFaceTime = performance.now();
  return payload;
}

function buildHeldFacePayload() {
  if (!lastFaceTime) {
    return null;
  }

  const elapsed = performance.now() - lastFaceTime;
  if (elapsed >= NO_FACE_GRACE_MS) {
    return null;
  }

  return {
    ...lastFacePayload,
    timestamp: Date.now(),
    heldFace: true,
    heldFaceAgeMs: Math.round(elapsed),
  };
}

function buildNoFacePayload() {
  return {
    type: "ml5_face_expression",
    timestamp: Date.now(),
    hasFace: false,
    faceCount: 0,
    dominantExpression: "none",
    dominantValue: -1,
    dominantConfidence: 0,
    expressions: emptyExpressions(),
    box: null,
  };
}

function buildNoFaceMeshPayload() {
  return {
    type: "ml5_facemesh",
    timestamp: Date.now(),
    hasFace: false,
    flipped: featureState.webcamFlip,
    faceCount: 0,
    modelReady: faceMeshReady,
    predictCount: faceMeshPredictCount,
    msSincePredict: lastFaceMeshPredictTime ? Math.round(performance.now() - lastFaceMeshPredictTime) : -1,
    videoReadyState: video?.elt?.readyState ?? 0,
    videoWidth: video?.elt?.videoWidth ?? 0,
    videoHeight: video?.elt?.videoHeight ?? 0,
    box: null,
    keypoints: [],
  };
}

function buildFaceMeshPayload(results, includeKeypoints = true) {
  if (!results.length) {
    return buildNoFaceMeshPayload();
  }

  const face = results[0];
  const keypoints = includeKeypoints
    ? getFaceMeshKeypoints(face).map((point, index) => ({
        index,
        x: point.x,
        y: point.y,
        z: point.z || 0,
      }))
    : [];

  return {
    type: "ml5_facemesh",
    timestamp: Date.now(),
    hasFace: true,
    flipped: featureState.webcamFlip,
    faceCount: results.length,
    modelReady: faceMeshReady,
    predictCount: faceMeshPredictCount,
    msSincePredict: 0,
    videoReadyState: video?.elt?.readyState ?? 0,
    videoWidth: video?.elt?.videoWidth ?? 0,
    videoHeight: video?.elt?.videoHeight ?? 0,
    box: getFaceMeshBounds(getFaceMeshKeypoints(face)),
    keypoints,
  };
}

function buildNoEyeTrackPayload() {
  return {
    type: "ml5_eye_tracking",
    timestamp: Date.now(),
    hasFace: false,
    flipped: featureState.webcamFlip,
    faceCenterX: 0,
    faceCenterY: 0,
    faceBoxX: 0,
    faceBoxY: 0,
    faceBoxWidth: 0,
    faceBoxHeight: 0,
    leftEyeX: 0,
    leftEyeY: 0,
    rightEyeX: 0,
    rightEyeY: 0,
    eyeAvgX: 0,
    eyeAvgY: 0,
    leftIrisCenterX: 0,
    leftIrisCenterY: 0,
    rightIrisCenterX: 0,
    rightIrisCenterY: 0,
    leftIrisRadius: 0,
    rightIrisRadius: 0,
    irisLandmarksFound: 0,
  };
}

function buildEyeTrackPayload(results) {
  if (!results.length) {
    return buildNoEyeTrackPayload();
  }

  const eyeData = getEyeData(results[0]);
  const leftEye = getIrisTarget(eyeData.leftEye, eyeData.leftIris);
  const rightEye = getIrisTarget(eyeData.rightEye, eyeData.rightIris);
  const faceBox = getFaceMeshBounds(getFaceMeshKeypoints(results[0]));

  if (!leftEye || !rightEye) {
    return buildNoEyeTrackPayload();
  }

  const irisLandmarksFound = leftEye.source === "iris" && rightEye.source === "iris";

  return {
    type: "ml5_eye_tracking",
    timestamp: Date.now(),
    hasFace: true,
    flipped: featureState.webcamFlip,
    faceCenterX: faceBox ? clamp01((faceBox.x + faceBox.width / 2) / VIDEO_WIDTH) : 0,
    faceCenterY: faceBox ? clamp01((faceBox.y + faceBox.height / 2) / VIDEO_HEIGHT) : 0,
    faceBoxX: faceBox ? clamp01(faceBox.x / VIDEO_WIDTH) : 0,
    faceBoxY: faceBox ? clamp01(faceBox.y / VIDEO_HEIGHT) : 0,
    faceBoxWidth: faceBox ? clamp01(faceBox.width / VIDEO_WIDTH) : 0,
    faceBoxHeight: faceBox ? clamp01(faceBox.height / VIDEO_HEIGHT) : 0,
    leftEyeX: leftEye.normalized.x,
    leftEyeY: leftEye.normalized.y,
    rightEyeX: rightEye.normalized.x,
    rightEyeY: rightEye.normalized.y,
    eyeAvgX: (leftEye.normalized.x + rightEye.normalized.x) / 2,
    eyeAvgY: (leftEye.normalized.y + rightEye.normalized.y) / 2,
    leftIrisCenterX: clamp01(leftEye.center.x / VIDEO_WIDTH),
    leftIrisCenterY: clamp01(leftEye.center.y / VIDEO_HEIGHT),
    rightIrisCenterX: clamp01(rightEye.center.x / VIDEO_WIDTH),
    rightIrisCenterY: clamp01(rightEye.center.y / VIDEO_HEIGHT),
    leftIrisRadius: clamp01(leftEye.radius / VIDEO_WIDTH),
    rightIrisRadius: clamp01(rightEye.radius / VIDEO_WIDTH),
    irisLandmarksFound: irisLandmarksFound ? 1 : 0,
  };
}

function buildSendPayload(payload) {
  if (payload && payload.hasFace === false) {
    const heldPayload = buildHeldFacePayload();
    if (heldPayload) {
      payload = heldPayload;
    }
  }

  return {
    ...payload,
    timestamp: Date.now(),
    expressions: { ...payload.expressions },
    box: payload.box ? { ...payload.box } : null,
  };
}

function getBox(detection) {
  const box =
    detection?.detection?.box ||
    detection?.alignedRect?._box ||
    detection?.detection?._box ||
    null;

  if (!box) {
    return null;
  }

  return mirrorVideoBox({
    x: readBoxNumber(box, ["x", "_x", "left"]),
    y: readBoxNumber(box, ["y", "_y", "top"]),
    width: readBoxNumber(box, ["width", "_width"]),
    height: readBoxNumber(box, ["height", "_height"]),
  });
}

function readBoxNumber(box, keys) {
  for (const key of keys) {
    const value = Number(box[key]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function drawDetectionOverlay(p, results) {
  if (!results.length) {
    return;
  }

  const primaryFace = results[0];
  const box = getBox(primaryFace);

  if (box) {
    const canvasBox = scaleBoxToCanvas(box, p);
    p.noFill();
    p.stroke(41, 255, 154);
    p.strokeWeight(3);
    p.rect(canvasBox.x, canvasBox.y, canvasBox.width, canvasBox.height);

    p.noStroke();
    p.fill(41, 255, 154);
    p.rect(canvasBox.x, Math.max(0, canvasBox.y - 28), 210, 28, 4);
    p.fill(6, 14, 18);
    p.textSize(14);
    p.text(
      `${lastPayload.dominantExpression} ${lastPayload.dominantConfidence.toFixed(3)}`,
      canvasBox.x + 8,
      Math.max(18, canvasBox.y - 10)
    );
  }

  drawLandmarks(p, primaryFace);
}

function drawFaceMeshOverlay(p, results) {
  if (!featureState.faceMesh || !results.length) {
    return;
  }

  const points = getFaceMeshKeypoints(results[0]);
  if (!points.length) {
    return;
  }

  const scale = Math.max(p.width / VIDEO_WIDTH, p.height / VIDEO_HEIGHT);
  const drawWidth = VIDEO_WIDTH * scale;
  const drawHeight = VIDEO_HEIGHT * scale;
  const drawX = (p.width - drawWidth) / 2;
  const drawY = (p.height - drawHeight) / 2;

  if (featureState.faceMeshOutput) {
    p.noStroke();
    p.fill(80, 180, 255);

    for (const point of points) {
      p.circle(drawX + point.x * scale, drawY + point.y * scale, 2);
    }
  }

  if (featureState.eyeTrack) {
    const eyeData = getEyeData(results[0]);
    drawEyeTarget(p, eyeData.leftEye, eyeData.leftIris, drawX, drawY, scale);
    drawEyeTarget(p, eyeData.rightEye, eyeData.rightIris, drawX, drawY, scale);
  }
}

function drawEyeTarget(p, eye, iris, drawX, drawY, scale) {
  const target = getIrisTarget(eye, iris);
  if (!target) {
    return;
  }

  const x = drawX + target.center.x * scale;
  const y = drawY + target.center.y * scale;
  const radius = Math.max(5, target.radius * scale);
  const crosshairSize = Math.max(8, radius * 1.25);

  p.noFill();
  p.stroke(255, 75, 190);
  p.strokeWeight(3);
  p.circle(x, y, radius * 2);

  p.stroke(40, 255, 120);
  p.strokeWeight(2);
  p.line(x - crosshairSize, y, x + crosshairSize, y);
  p.line(x, y - crosshairSize, x, y + crosshairSize);
}

function drawVideoCover(p) {
  if (!video?.elt?.videoWidth || !video?.elt?.videoHeight) {
    return;
  }

  const sourceWidth = video.elt.videoWidth;
  const sourceHeight = video.elt.videoHeight;
  const scale = Math.max(p.width / sourceWidth, p.height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const drawX = (p.width - drawWidth) / 2;
  const drawY = (p.height - drawHeight) / 2;
  const context = p.drawingContext;

  if (featureState.webcamFlip) {
    context.save();
    context.translate(drawX + drawWidth, drawY);
    context.scale(-1, 1);
    context.drawImage(video.elt, 0, 0, drawWidth, drawHeight);
    context.restore();
    return;
  }

  context.drawImage(video.elt, drawX, drawY, drawWidth, drawHeight);
}

function scaleBoxToCanvas(box, p) {
  const scale = Math.max(p.width / VIDEO_WIDTH, p.height / VIDEO_HEIGHT);
  const drawWidth = VIDEO_WIDTH * scale;
  const drawHeight = VIDEO_HEIGHT * scale;
  const drawX = (p.width - drawWidth) / 2;
  const drawY = (p.height - drawHeight) / 2;

  return {
    x: drawX + box.x * scale,
    y: drawY + box.y * scale,
    width: box.width * scale,
    height: box.height * scale,
    scale,
    drawX,
    drawY,
  };
}

function drawLandmarks(p, detection) {
  const positions = detection?.landmarks?.positions || detection?.landmarks?.positions || [];
  if (!positions.length) {
    return;
  }

  p.noStroke();
  p.fill(255, 238, 126);
  const scale = Math.max(p.width / VIDEO_WIDTH, p.height / VIDEO_HEIGHT);
  const drawWidth = VIDEO_WIDTH * scale;
  const drawHeight = VIDEO_HEIGHT * scale;
  const drawX = (p.width - drawWidth) / 2;
  const drawY = (p.height - drawHeight) / 2;

  for (const point of positions) {
    const x = drawX + mirrorVideoX(point._x ?? point.x) * scale;
    const y = drawY + (point._y ?? point.y) * scale;
    p.circle(x, y, 3);
  }
}

function drawWaitingMessage(p) {
  if (!featureState.showUI) {
    return;
  }

  const enabledReady =
    (!featureState.emotion || emotionReady) &&
    (!featureState.faceMesh || faceMeshReady);

  if (enabledReady && cameraStarted) {
    return;
  }

  p.noStroke();
  p.fill(255);
  p.textSize(16);
  p.textAlign(p.CENTER, p.CENTER);
  p.text(centerMessage || "Waiting for camera/model...", p.width / 2, p.height / 2);
  p.textAlign(p.LEFT, p.BASELINE);
}

function updateReadout(payload) {
  ui.dominantExpression.textContent = payload.dominantExpression;
  ui.dominantConfidence.textContent = payload.dominantConfidence.toFixed(3);
  ui.faceCount.textContent = `faces: ${payload.faceCount}`;
}

function updateFaceMeshReadout(payload) {
  if (!featureState.faceMesh || featureState.emotion) {
    return;
  }

  ui.dominantExpression.textContent = featureState.eyeTrack ? "eyetrack" : "facemesh";
  ui.dominantConfidence.textContent = payload.hasFace ? "1.000" : "0.000";
  const label = featureState.faceMeshOutput ? "facemesh" : "eyetrack";
  ui.faceCount.textContent = `${label} faces: ${payload.faceCount} | mesh fps: ${faceMeshFps.toFixed(1)} | ${lastFaceMeshDurationMs}ms`;
}

function getFaceMeshKeypoints(face) {
  return getRawFaceMeshPoints(face)
    .map(normalizePoint)
    .filter(Boolean);
}

function getFaceMeshBounds(points) {
  if (!points || !points.length) {
    return null;
  }

  const xs = points.map((point) => point.x).filter(Number.isFinite);
  const ys = points.map((point) => point.y).filter(Number.isFinite);
  if (!xs.length || !ys.length) {
    return null;
  }

  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  return {
    x: xMin,
    y: yMin,
    width: Math.max(...xs) - xMin,
    height: Math.max(...ys) - yMin,
  };
}

function getEyeData(face) {
  const annotations = face?.annotations || {};

  const indexedEyeData = getIndexedEyeData(face);
  if (indexedEyeData) {
    return indexedEyeData;
  }

  if (face?.leftEye?.keypoints || face?.rightEye?.keypoints) {
    return {
      leftEye: boundsFromPoints(face.leftEye?.keypoints || []),
      rightEye: boundsFromPoints(face.rightEye?.keypoints || []),
      leftIris: normalizePoints(face.leftIris?.keypoints || []),
      rightIris: normalizePoints(face.rightIris?.keypoints || []),
    };
  }

  if (annotations.leftEyeUpper0 || annotations.rightEyeUpper0) {
    return {
      leftEye: boundsFromPoints([
        ...(annotations.leftEyeUpper0 || []),
        ...(annotations.leftEyeLower0 || []),
      ]),
      rightEye: boundsFromPoints([
        ...(annotations.rightEyeUpper0 || []),
        ...(annotations.rightEyeLower0 || []),
      ]),
      leftIris: normalizePoints(annotations.leftEyeIris || []),
      rightIris: normalizePoints(annotations.rightEyeIris || []),
    };
  }

  const points = getFaceMeshKeypoints(face);
  return {
    leftEye: boundsFromIndices(points, LEFT_EYE_INDICES),
    rightEye: boundsFromIndices(points, RIGHT_EYE_INDICES),
    leftIris: pointsFromIndices(points, LEFT_IRIS_INDICES),
    rightIris: pointsFromIndices(points, RIGHT_IRIS_INDICES),
  };
}

function getIndexedEyeData(face) {
  const rawPoints = getRawFaceMeshPoints(face);
  if (!rawPoints.length) {
    return null;
  }

  const leftEye = pointsFromRawIndices(rawPoints, LEFT_EYE_INDICES);
  const rightEye = pointsFromRawIndices(rawPoints, RIGHT_EYE_INDICES);
  const leftIris = pointsFromRawIndices(rawPoints, LEFT_IRIS_INDICES);
  const rightIris = pointsFromRawIndices(rawPoints, RIGHT_IRIS_INDICES);

  return {
    leftEye: boundsFromPoints(leftEye),
    rightEye: boundsFromPoints(rightEye),
    leftIris,
    rightIris,
  };
}

function getRawFaceMeshPoints(face) {
  return face?.scaledMesh || face?.mesh || face?.keypoints || [];
}

function boundsFromIndices(points, indices) {
  return boundsFromPoints(pointsFromIndices(points, indices));
}

function pointsFromIndices(points, indices) {
  return indices.map((index) => points[index]).filter(Boolean);
}

function pointsFromRawIndices(rawPoints, indices) {
  return indices
    .map((index) => normalizePoint(rawPoints[index]))
    .filter(Boolean);
}

function boundsFromPoints(points) {
  if (!points || !points.length) {
    return null;
  }

  const normalized = normalizePoints(points);
  const xs = normalized.map((point) => Number(point.x)).filter(Number.isFinite);
  const ys = normalized.map((point) => Number(point.y)).filter(Number.isFinite);

  if (!xs.length || !ys.length) {
    return null;
  }

  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;

  return { x, y, width, height, points: normalized };
}

function centerOfPoints(points) {
  if (!points || !points.length) {
    return null;
  }

  const normalized = normalizePoints(points);
  const valid = normalized.filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));

  if (!valid.length) {
    return null;
  }

  return {
    x: valid.reduce((sum, point) => sum + Number(point.x), 0) / valid.length,
    y: valid.reduce((sum, point) => sum + Number(point.y), 0) / valid.length,
  };
}

function getIrisTarget(eye, iris) {
  if (!eye || !eye.width || !eye.height) {
    return null;
  }

  const irisCenter = centerOfPoints(iris);
  const center = irisCenter || {
    x: eye.x + eye.width / 2,
    y: eye.y + eye.height / 2,
  };

  const radius = irisCenter
    ? radiusFromPoints(iris, irisCenter, Math.min(eye.width, eye.height) * 0.5)
    : Math.max(3, Math.min(eye.width, eye.height) * 0.45);

  return {
    center,
    radius,
    normalized: {
      x: clamp01((center.x - eye.x) / eye.width),
      y: clamp01((center.y - eye.y) / eye.height),
    },
    source: irisCenter ? "iris" : "eye-contour",
  };
}

function radiusFromPoints(points, center, fallback) {
  const normalized = normalizePoints(points);
  const distances = normalized
    .map((point) => Math.hypot(Number(point.x) - center.x, Number(point.y) - center.y))
    .filter(Number.isFinite);

  if (!distances.length) {
    return fallback;
  }

  return Math.max(3, distances.reduce((sum, distance) => sum + distance, 0) / distances.length);
}

function normalizePoints(points) {
  if (!points || !points.length) {
    return [];
  }

  return points
    .map(normalizePoint)
    .filter(Boolean);
}

function normalizePoint(point) {
  if (!point) {
    return null;
  }

  const normalized = Array.isArray(point)
    ? {
        x: Number(point[0]),
        y: Number(point[1]),
        z: Number(point[2]) || 0,
      }
    : {
        x: Number(point.x),
        y: Number(point.y),
        z: Number(point.z) || 0,
      };

  if (!Number.isFinite(normalized.x) || !Number.isFinite(normalized.y)) {
    return null;
  }

  return normalized;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function updateWebcamReadout() {
  return;
}

function updateFpsReadout(p, now) {
  if (!ui.fpsStatus) {
    return;
  }

  let videoLive = false;

  if (video?.elt) {
    const currentTime = video.elt.currentTime || 0;

    if (currentTime !== lastVideoTime) {
      lastVideoTime = currentTime;
      lastVideoFrameChangeTime = now;
      videoLive = true;
    } else if (now - lastVideoFrameChangeTime > 1000) {
      videoLive = false;
    } else {
      videoLive = true;
    }
  }

  const faceMeshStatus = featureState.faceMesh
    ? ` | mesh fps: ${faceMeshFps.toFixed(1)} | mesh ms: ${lastFaceMeshDurationMs}`
    : "";
  ui.fpsStatus.textContent = `draw fps: ${p.frameRate().toFixed(1)}${videoLive ? "" : " | stalled"}${faceMeshStatus}`;
}

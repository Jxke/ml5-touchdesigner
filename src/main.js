import "./style.css";
import { EmotionWebSocket } from "./websocket.js";
import {
  emptyExpressions,
  getDominantExpression,
  normalizeExpressions,
} from "./emotionMapping.js";
import { faceApiState, outputState, webcamState } from "./state.js";

const VIDEO_WIDTH = webcamState.width;
const VIDEO_HEIGHT = webcamState.height;
const SEND_FPS = outputState.sendFps;
const SEND_INTERVAL_MS = 1000 / SEND_FPS;

const ui = {
  modelStatus: document.getElementById("model-status"),
  socketStatus: document.getElementById("socket-status"),
  dominantExpression: document.getElementById("dominant-expression"),
  dominantConfidence: document.getElementById("dominant-confidence"),
  faceCount: document.getElementById("face-count"),
  fpsStatus: document.getElementById("fps-status"),
  webcamStatus: document.getElementById("webcam-status"),
};

let faceApi = null;
let detections = [];
let modelReady = false;
let video = null;
let lastPayload = buildNoFacePayload();
let lastSendTime = 0;
let cameraStarted = false;
let centerMessage = "Starting camera...";
let p5Instance = null;
let lastVideoTime = -1;
let lastVideoFrameChangeTime = 0;

handleQueryParams();

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

    drawDetectionOverlay(p, detections);
    drawWaitingMessage(p);

    const now = performance.now();
    updateFpsReadout(p, now);

    if (now - lastSendTime >= SEND_INTERVAL_MS) {
      lastSendTime = now;
      emotionSocket.sendJson(buildSendPayload(lastPayload));
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
      modelReady = false;
      cameraStarted = false;
      detections = [];
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
    modelReady = false;
    cameraStarted = false;
    detections = [];
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
  } catch (error) {
    console.warn("Ignoring non-JSON websocket message:", message);
  }
}

function onWebcamReady() {
  ui.modelStatus.textContent = "Webcam started. Loading local face expression models...";
  centerMessage = "Loading local face expression models...";

  loadModels();
}

async function loadModels() {
  try {
    const modelPath = faceApiState.modelPath;
    faceApi = window.faceapi;
    await Promise.all([
      faceApi.nets.tinyFaceDetector.loadFromUri(modelPath),
      faceApi.nets.faceLandmark68TinyNet.loadFromUri(modelPath),
      faceApi.nets.faceExpressionNet.loadFromUri(modelPath),
    ]);

    modelReady = true;
    ui.modelStatus.textContent = "local face expression models ready";
    centerMessage = "";
    detectFaces();
  } catch (error) {
    console.error(error);
    centerMessage = `Model load error: ${error.message}`;
    ui.modelStatus.textContent = centerMessage;
  }
}

async function detectFaces() {
  if (!faceApi || !modelReady) {
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

function buildPayloadFromDetections(results) {
  if (!results.length) {
    return buildNoFacePayload();
  }

  const primaryFace = results[0];
  const expressions = normalizeExpressions(primaryFace.expressions);
  const dominant = getDominantExpression(primaryFace.expressions);

  return {
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

function buildSendPayload(payload) {
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

  return {
    x: readBoxNumber(box, ["x", "_x", "left"]),
    y: readBoxNumber(box, ["y", "_y", "top"]),
    width: readBoxNumber(box, ["width", "_width"]),
    height: readBoxNumber(box, ["height", "_height"]),
  };
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

  p.image(video, drawX, drawY, drawWidth, drawHeight);
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
    const x = drawX + (point._x ?? point.x) * scale;
    const y = drawY + (point._y ?? point.y) * scale;
    p.circle(x, y, 3);
  }
}

function drawWaitingMessage(p) {
  if (modelReady && cameraStarted) {
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

function updateWebcamReadout() {
  if (!ui.webcamStatus) {
    return;
  }

  const label = webcamState.selectedLabel || "default";
  const device = webcamState.selectedDeviceId ? webcamState.selectedDeviceId.slice(0, 12) : "auto";
  ui.webcamStatus.textContent = `webcam: ${label} (${device})`;
}

function updateFpsReadout(p, now) {
  if (!ui.fpsStatus) {
    return;
  }

  let videoStatus = "waiting";

  if (video?.elt) {
    const currentTime = video.elt.currentTime || 0;

    if (currentTime !== lastVideoTime) {
      lastVideoTime = currentTime;
      lastVideoFrameChangeTime = now;
      videoStatus = "live";
    } else if (now - lastVideoFrameChangeTime > 1000) {
      videoStatus = "stalled";
    } else {
      videoStatus = "live";
    }
  }

  ui.fpsStatus.textContent = `draw fps: ${p.frameRate().toFixed(1)} | video: ${videoStatus}`;
}

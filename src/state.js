// Runtime settings grouped in one place, following the broad state-module
// pattern used by Torin's TouchDesigner browser bridge.

export const webcamState = {
  // Change these if you need a different camera/canvas size.
  width: 640,
  height: 480,
  targetFrameRate: 30,
  selectedLabel: "",
  selectedDeviceId: "",
  currentStream: null,
};

export const outputState = {
  // Keep this in the 10-20 FPS range to avoid flooding TouchDesigner.
  sendFps: 15,
};

export const featureState = {
  emotion: true,
  // faceMesh means the ML5 FaceMesh model is running internally.
  // faceMeshOutput means send/draw the full FaceMesh point cloud.
  faceMesh: false,
  faceMeshOutput: false,
  eyeTrack: false,
  showOverlays: true,
  showUI: true,
  webcamFlip: false,
};

export const faceApiState = {
  // Local model folder. This mirrors Torin's local model packaging approach:
  // source files live under src/, and Vite copies them into _mpdist for tox packaging.
  modelPath: "./src/faceapi/models",
  options: {
    withLandmarks: true,
    withExpressions: true,
    withDescriptors: false,
    minConfidence: 0.5,
    inputSize: 512,
  },
};

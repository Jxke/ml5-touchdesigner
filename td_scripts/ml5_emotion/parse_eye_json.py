"""
Parser helper for ml5 eye tracking JSON messages.

Paste into a TouchDesigner Text DAT named parse_eye_json, or keep this file
next to the other ml5_emotion scripts while building the tox.
"""

import json


EYE_ROWS = [
    "flipped",
    "faceCenterX",
    "faceCenterY",
    "faceBoxX",
    "faceBoxY",
    "faceBoxWidth",
    "faceBoxHeight",
    "leftEyeX",
    "leftEyeY",
    "rightEyeX",
    "rightEyeY",
    "eyeAvgX",
    "eyeAvgY",
    "leftIrisCenterX",
    "leftIrisCenterY",
    "rightIrisCenterX",
    "rightIrisCenterY",
    "leftIrisRadius",
    "rightIrisRadius",
    "irisLandmarksFound",
    "hasFace",
]


def parse_eye_payload(payload: str) -> dict:
    result = {name: 0.0 for name in EYE_ROWS}
    result["hasFace"] = 0

    try:
        data = json.loads(payload)
    except Exception:
        return result

    if data.get("type") != "ml5_eye_tracking":
        return result

    for name in EYE_ROWS:
        if name in ("hasFace", "irisLandmarksFound", "flipped"):
            result[name] = 1 if data.get("hasFace") else 0
            if name == "irisLandmarksFound":
                result[name] = 1 if data.get("irisLandmarksFound") else 0
            elif name == "flipped":
                result[name] = 1 if data.get("flipped") else 0
            continue

        result[name] = _clamp01(data.get(name, 0.0))

    return result


def _clamp01(value):
    try:
        number = float(value)
    except Exception:
        number = 0.0

    if number < 0.0:
        return 0.0
    if number > 1.0:
        return 1.0
    return number

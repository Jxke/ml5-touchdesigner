"""
Parser helper for ml5 FaceMesh JSON messages.

Paste into a TouchDesigner Text DAT named parse_face_json, or keep this file
next to the other ml5_emotion scripts while building the tox.
"""

import json


def parse_facemesh_payload(payload: str) -> dict:
    result = {
        "hasFace": 0,
        "faceCount": 0,
        "flipped": 0,
        "box": None,
        "keypoints": [],
    }

    try:
        data = json.loads(payload)
    except Exception:
        return result

    if data.get("type") != "ml5_facemesh":
        return result

    result["hasFace"] = 1 if data.get("hasFace") else 0
    result["flipped"] = 1 if data.get("flipped") else 0
    result["box"] = data.get("box") if isinstance(data.get("box"), dict) else None

    try:
        result["faceCount"] = int(data.get("faceCount", 0))
    except Exception:
        result["faceCount"] = 0

    keypoints = data.get("keypoints") or []
    if not isinstance(keypoints, list):
        keypoints = []

    parsed_keypoints = []
    for index, point in enumerate(keypoints):
        if not isinstance(point, dict):
            continue

        parsed_keypoints.append(
            {
                "index": _safe_int(point.get("index", index)),
                "x": _safe_float(point.get("x")),
                "y": _safe_float(point.get("y")),
                "z": _safe_float(point.get("z")),
            }
        )

    result["keypoints"] = parsed_keypoints
    return result


def _safe_float(value):
    try:
        return float(value)
    except Exception:
        return 0.0


def _safe_int(value):
    try:
        return int(value)
    except Exception:
        return 0

"""
Parser helper for ml5 Emotion Recognition JSON messages.

This file is plain Python so it can be pasted into a TouchDesigner Text DAT
or imported from another DAT with mod('parse_emotion_json').
"""

import json


EXPRESSION_NAMES = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "fearful",
    "disgusted",
    "surprised",
]


def _empty_result():
    result = {name: 0.0 for name in EXPRESSION_NAMES}
    result.update(
        {
            "dominantValue": -1,
            "dominantConfidence": 0.0,
            "hasFace": 0,
        }
    )
    return result


def parse_emotion_payload(payload: str) -> dict:
    """
    Convert one browser WebSocket JSON message into TouchDesigner channel values.

    Returns:
        {
            "neutral": float,
            "happy": float,
            "sad": float,
            "angry": float,
            "fearful": float,
            "disgusted": float,
            "surprised": float,
            "dominantValue": int,
            "dominantConfidence": float,
            "hasFace": int
        }
    """
    result = _empty_result()

    try:
        data = json.loads(payload)
    except Exception:
        return result

    if data.get("type") != "ml5_face_expression":
        return result

    expressions = data.get("expressions") or {}
    for name in EXPRESSION_NAMES:
        try:
            result[name] = float(expressions.get(name, 0.0))
        except Exception:
            result[name] = 0.0

    try:
        result["dominantValue"] = int(data.get("dominantValue", -1))
    except Exception:
        result["dominantValue"] = -1

    try:
        result["dominantConfidence"] = float(data.get("dominantConfidence", 0.0))
    except Exception:
        result["dominantConfidence"] = 0.0

    result["hasFace"] = 1 if data.get("hasFace") else 0
    return result

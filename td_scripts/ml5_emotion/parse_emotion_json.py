"""
Parser helper for ml5 Emotion Recognition JSON messages.

This file is plain Python so it can be pasted into a TouchDesigner Text DAT
or imported from another DAT with mod('parse_emotion_json').
"""

import json
import time


EXPRESSION_NAMES = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "fearful",
    "disgusted",
    "surprised",
]

EXPRESSION_ALIASES = {
    "fear": "fearful",
    "fearful": "fearful",
    "disgust": "disgusted",
    "disgusted": "disgusted",
    "surprise": "surprised",
    "surprised": "surprised",
}

EXPRESSION_VALUE_MAP = {
    "neutral": 0,
    "happy": 1,
    "sad": 2,
    "angry": 3,
    "fearful": 4,
    "disgusted": 5,
    "surprised": 6,
}

NO_FACE_HOLD_SECONDS = 2.0
_last_face_result = None
_last_face_time = 0.0


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


def _clamp01(value):
    try:
        number = float(value)
    except Exception:
        return 0.0

    if number < 0.0:
        return 0.0
    if number > 1.0:
        return 1.0
    return number


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

    global _last_face_result
    global _last_face_time

    if data.get("type") != "ml5_face_expression":
        return result

    if not data.get("hasFace"):
        if _last_face_result is not None and time.time() - _last_face_time < NO_FACE_HOLD_SECONDS:
            return dict(_last_face_result)
        return result

    expressions = data.get("expressions") or {}
    for raw_name, raw_value in expressions.items():
        name = EXPRESSION_ALIASES.get(raw_name, raw_name)
        if name not in EXPRESSION_NAMES:
            continue

        result[name] = _clamp01(raw_value)

    try:
        result["dominantValue"] = int(data.get("dominantValue", -1))
    except Exception:
        result["dominantValue"] = -1

    try:
        result["dominantConfidence"] = _clamp01(data.get("dominantConfidence", 0.0))
    except Exception:
        result["dominantConfidence"] = 0.0

    if result["dominantValue"] == -1 and data.get("hasFace"):
        dominant_name = EXPRESSION_ALIASES.get(data.get("dominantExpression"), data.get("dominantExpression"))
        if dominant_name in EXPRESSION_VALUE_MAP:
            result["dominantValue"] = EXPRESSION_VALUE_MAP[dominant_name]

    if data.get("hasFace"):
        dominant_from_values = max(EXPRESSION_NAMES, key=lambda name: result.get(name, 0.0))
        dominant_from_values_confidence = float(result.get(dominant_from_values, 0.0))

        if result["dominantConfidence"] == 0.0:
            result["dominantConfidence"] = dominant_from_values_confidence

        if result["dominantValue"] == -1 and dominant_from_values_confidence > 0:
            result["dominantValue"] = EXPRESSION_VALUE_MAP[dominant_from_values]

    result["hasFace"] = 1
    _last_face_result = dict(result)
    _last_face_time = time.time()
    return result

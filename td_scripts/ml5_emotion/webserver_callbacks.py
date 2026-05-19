# Web Server DAT callbacks for the ml5 TouchDesigner component.
#
# Place this script in the Web Server DAT callbacks DAT. It mirrors Torin's
# pattern: serve files from _mpdist during development, otherwise serve the
# same files from the component Virtual File System.

import json
import mimetypes
import os
from pathlib import Path


clients = {}


def _get_virtual_file_operator():
    return op("virtualFile")


def _request_to_vfs_name(uri):
    request_path = uri.split("?", 1)[0]
    if request_path in ("", "/"):
        request_path = "/index.html"

    if request_path.startswith("/"):
        request_path = request_path[1:]

    return "#" + request_path.replace("/", "#")


def _request_to_dist_path(uri):
    request_path = uri.split("?", 1)[0]
    if request_path in ("", "/"):
        request_path = "/index.html"

    if request_path.startswith("/"):
        request_path = request_path[1:]

    return Path(os.getcwd()) / "_mpdist" / request_path


def _set_content_type(response, file_name):
    mime_type = mimetypes.guess_type(file_name, strict=False)[0]

    if file_name.endswith(".js"):
        mime_type = "application/javascript"
    elif file_name.endswith(".css"):
        mime_type = "text/css"
    elif file_name.endswith(".json"):
        mime_type = "application/json"
    elif mime_type is None:
        mime_type = "application/octet-stream"

    response["Content-Type"] = mime_type
    response["Permissions-Policy"] = "camera=(self), microphone=()"
    response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response["Pragma"] = "no-cache"
    response["Expires"] = "0"


def _write_webcam_list(webcam_list_dat, devices):
    if webcam_list_dat is None:
        return

    # Match Torin-style flow: webcam_list stores raw JSON text.
    # A downstream JSON/table DAT named webcam_menu parses it for tdu.TableMenu.
    webcam_list_dat.text = json.dumps(devices)


def _write_text_dat(name, text):
    dat = op(name)
    if dat is not None:
        dat.text = str(text)


def _parse_emotion_payload(data):
    for module_name in ("parse_emotion_json", "text1"):
        try:
            module = mod(module_name)
            if module is not None:
                return module.parse_emotion_payload(data)
        except Exception:
            pass

    raise Exception("Could not find parse_emotion_json Text DAT")


def _parse_facemesh_payload(data):
    module = mod("parse_face_json")
    return module.parse_facemesh_payload(data)


def _parse_eye_payload(data):
    module = mod("parse_eye_json")
    return module.parse_eye_payload(data)


def _write_emotion_values(values):
    table = op("emotion_table")
    if table is None:
        raise Exception("Could not find emotion_table")

    try:
        mod("websocket_callbacks").write_values_to_table(table, values)
        return
    except Exception:
        pass

    table.clear()
    table.appendRow(["name", "value"])
    channel_rows = (
        "neutral",
        "happy",
        "sad",
        "angry",
        "fearful",
        "disgusted",
        "surprised",
        "dominantValue",
        "dominantConfidence",
        "hasFace",
    )

    for channel_name in channel_rows:
        table.appendRow([channel_name, _format_emotion_value(channel_name, values.get(channel_name, 0))])


def _format_emotion_value(channel_name, value):
    if channel_name in (
        "neutral",
        "happy",
        "sad",
        "angry",
        "fearful",
        "disgusted",
        "surprised",
        "dominantConfidence",
    ):
        try:
            number = float(value)
        except Exception:
            number = 0.0

        if number < 0.0:
            number = 0.0
        elif number > 1.0:
            number = 1.0

        return "{:.6f}".format(number)

    if channel_name in ("dominantValue", "hasFace"):
        try:
            return int(value)
        except Exception:
            return 0

    return value


def _write_facemesh_values(values):
    table = op("face_table")
    if table is None:
        return

    try:
        mod("websocket_callbacks").write_facemesh_to_table(table, values)
        return
    except Exception:
        pass

    table.clear()
    table.appendRow(["index", "x", "y", "z"])
    for point in values.get("keypoints", []):
        table.appendRow(
            [
                point.get("index", 0),
                _format_table_float(point.get("x", 0.0)),
                _format_table_float(point.get("y", 0.0)),
                _format_table_float(point.get("z", 0.0)),
            ]
        )


def _write_eye_values(values):
    table = op("eye_table")
    if table is None:
        return

    try:
        mod("websocket_callbacks").write_eye_to_table(table, values)
        return
    except Exception:
        pass

    table.clear()
    table.appendRow(["name", "value"])
    for name in (
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
    ):
        value = int(values.get(name, 0)) if name in ("hasFace", "irisLandmarksFound", "flipped") else _format_table_float(values.get(name, 0.0))
        table.appendRow([name, value])


def _format_table_float(value):
    try:
        return "{:.6f}".format(float(value))
    except Exception:
        return "0.000000"


def onHTTPRequest(webServerDAT, request, response):
    uri = request["uri"]
    dist_path = _request_to_dist_path(uri)
    file_name = dist_path.name
    file_content = None

    if dist_path.exists() and dist_path.is_file():
        print("Serving from _mpdist:", uri)
        file_content = dist_path.read_bytes()
    else:
        print("Serving from VFS:", uri)
        vfs_name = _request_to_vfs_name(uri)
        vfs_op = _get_virtual_file_operator()

        try:
            vfs_file = vfs_op.vfs[vfs_name]
        except Exception:
            vfs_file = None

        if not vfs_file:
            me.parent().addScriptError(
                "ML5 browser file not found. Run yarn build and import _mpdist into virtualFile VFS."
            )
            response["statusCode"] = 404
            response["statusReason"] = "Not Found"
            response["data"] = "ML5 browser file not found: " + uri
            return response

        file_content = vfs_file.byteArray
        file_name = vfs_file.name

    me.parent().clearScriptErrors(recurse=False, error="ML5 browser file not found*")
    _set_content_type(response, file_name)
    response["statusCode"] = 200
    response["statusReason"] = "OK"
    response["data"] = file_content
    return response


def onWebSocketOpen(webServerDAT, client, uri):
    clients[client] = True
    print("ML5 websocket client connected:", client, uri)
    return


def onWebSocketClose(webServerDAT, client):
    if client in clients:
        del clients[client]
    return


def onWebSocketReceiveText(webServerDAT, client, data):
    if not data or data in ("ping", "pong"):
        return

    _write_text_dat("ml5_last_message", data[:2000])

    try:
        parsed = json.loads(data)
        _write_text_dat("ml5_status", "received type: " + str(parsed.get("type")))
    except Exception as e:
        parsed = {}
        _write_text_dat("ml5_status", "json parse error: " + str(e))

    if parsed.get("type") == "webcamDevices":
        try:
            _write_webcam_list(op("webcam_list"), parsed.get("devices", []))
            _write_text_dat("ml5_status", "updated webcam_list")
        except Exception as e:
            print("Error updating webcam list:", e)
            _write_text_dat("ml5_status", "webcam list error: " + str(e))
        return

    if parsed.get("type") == "ml5_face_expression":
        try:
            values = _parse_emotion_payload(data)
            _write_emotion_values(values)
            _write_text_dat("ml5_status", "updated emotion_table")
        except Exception as e:
            print("Error parsing ml5 emotion payload:", e)
            _write_text_dat("ml5_status", "emotion parse/update error: " + str(e))
        return

    if parsed.get("type") == "ml5_facemesh":
        try:
            _write_text_dat("facemesh_results", data)
            _write_facemesh_values(_parse_facemesh_payload(data))
            _write_text_dat("ml5_status", "updated facemesh_results")
        except Exception as e:
            print("Error parsing ml5 facemesh payload:", e)
            _write_text_dat("ml5_status", "facemesh parse/update error: " + str(e))
        return

    if parsed.get("type") == "ml5_eye_tracking":
        try:
            _write_text_dat("eye_tracking_results", data)
            _write_eye_values(_parse_eye_payload(data))
            _write_text_dat("ml5_status", "updated eye_tracking_results")
        except Exception as e:
            print("Error parsing ml5 eye tracking payload:", e)
            _write_text_dat("ml5_status", "eye parse/update error: " + str(e))
        return

    # Forward unrelated messages to other browser clients.
    for key in clients.keys():
        if key != client:
            webServerDAT.webSocketSendText(key, data)
    return


def send_webcam_selection(webcam_value):
    send_text_to_clients(json.dumps({"Webcam": webcam_value}))


def send_text_to_clients(message):
    webserver = op("webserver1")
    for client in list(clients.keys()):
        webserver.webSocketSendText(client, message)


def onWebSocketReceiveBinary(webServerDAT, client, data):
    webServerDAT.webSocketSendBinary(client, data)
    return


def onWebSocketReceivePing(webServerDAT, client, data):
    webServerDAT.webSocketSendPong(client, data=data)
    return


def onWebSocketReceivePong(webServerDAT, client, data):
    return


def onServerStart(webServerDAT):
    mimetypes.add_type("application/octet-stream", ".bin")
    print("ML5 web server started")
    return


def onServerStop(webServerDAT):
    print("ML5 web server stopped")
    return

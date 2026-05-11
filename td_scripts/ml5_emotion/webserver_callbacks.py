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


def _write_webcam_list(webcam_list_dat, devices):
    if webcam_list_dat is None:
        return

    # Match Torin's MediaPipe flow: webcam_list stores raw JSON text.
    # A downstream JSON/table DAT named webcam_menu parses it for tdu.TableMenu.
    webcam_list_dat.text = json.dumps(devices)


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

    try:
        parsed = json.loads(data)
    except Exception:
        parsed = {}

    if parsed.get("type") == "webcamDevices":
        try:
            _write_webcam_list(op("webcam_list"), parsed.get("devices", []))
        except Exception as e:
            print("Error updating webcam list:", e)
        return

    if parsed.get("type") == "ml5_face_expression":
        try:
            values = mod("parse_emotion_json").parse_emotion_payload(data)
            mod("websocket_callbacks").write_values_to_table(op("emotion_table"), values)
        except Exception as e:
            print("Error parsing ml5 emotion payload:", e)
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

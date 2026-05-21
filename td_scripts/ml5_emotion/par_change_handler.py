"""
DAT Execute callbacks for a Torin-style parameter table.

Attach a DAT Execute DAT to a Table DAT named parameter1 with rows like:

name          value
Ml5port      9981
Webcam       FaceTime HD Camera
Wwidth       640
Wheight      480
Wflip        0

When a cell changes, this sends the changed key/value over the Web Server DAT
WebSocket and rebuilds current_url for webBrowser.
"""

import json
import urllib.parse


NO_RELOAD_PARS = [
    "Webcam",
    "Wflip",
    "Autoport",
    "Showoverlays",
    "Showui",
]


def _port_from_parameter_table(dat):
    # Prefer the ML5 component parameter and actual Web Server DAT port.
    # Do not fall back to old external model rows here, because a stale
    # parameter table can rewrite webBrowser to a closed port and cause
    # ERR_CONNECTION_REFUSED.
    try:
        return str(parent().par.Ml5port.eval())
    except Exception:
        pass

    try:
        return str(op("webserver1").par.port.eval())
    except Exception:
        pass

    try:
        value = dat["Ml5port", 1]
        if value is not None:
            return str(value)
    except Exception:
        pass

    return "9981"


def _send_text_to_web_clients(message):
    # Preferred path for this project: Web Server DAT handles WebSocket clients.
    try:
        mod("webserver_callbacks").send_text_to_clients(message)
        return
    except Exception:
        pass

    # Compatibility fallback if you build a separate WebSocket DAT.
    try:
        op("websocket1").sendText(message)
    except Exception as e:
        print("Could not send websocket parameter change:", e)


def _web_browser_comp():
    return op("webBrowser") or op("webBrowser1")


def _build_url(dat):
    url = "http://localhost:" + _port_from_parameter_table(dat) + "/index.html?"
    dat_params = {}

    for i in range(dat.numRows):
        key = str(dat[i, 0])
        if key and key not in ("name", "Ml5port", "Mediapipeport", "Movenetport", "Port"):
            if key == "Webcam":
                # Torin-style URL contract: the custom Webcam parameter value
                # is sent as webcamId, usually a browser deviceId.
                dat_params["webcamId"] = dat[i, 1]
            else:
                dat_params[key] = dat[i, 1]

    if _truthy(dat_params.get("Facemesh")) or _truthy(dat_params.get("Eyetrack")):
        dat_params["Emotion"] = 0

    return url + urllib.parse.urlencode(dat_params)


def _truthy(value):
    return str(value).strip().lower() in ("1", "true", "on", "yes")


def onTableChange(dat):
    return


def onRowChange(dat, rows):
    return


def onColChange(dat, cols):
    return


def onCellChange(dat, cells, prev):
    cell = cells[0]
    key = str(dat[cell.row, 0])
    value = str(cell)

    if key in ("name", ""):
        return

    reload_required = key not in NO_RELOAD_PARS and not key.startswith("Scolor")

    data = {key: value}
    message = json.dumps(data)
    _send_text_to_web_clients(message)
    print("data change send ws", data)

    final_url = _build_url(dat)
    op("current_url").text = final_url

    web_browser = _web_browser_comp()
    if web_browser is None:
        print("Could not find webBrowser or webBrowser1")
        return

    if reload_required:
        web_browser.par.Address = final_url

    web_browser.allowCooking = 1
    return


def onSizeChange(dat):
    return


def send_webcam_change(label):
    _send_text_to_web_clients(json.dumps({"Webcam": label}))

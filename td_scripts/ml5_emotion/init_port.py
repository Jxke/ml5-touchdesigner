# Execute DAT callbacks for assigning the local ML5 Web Server DAT port.
#
# This mirrors Torin's init_port pattern: on component creation, find a free
# local port, assign it to webserver1, and start the server. If you want a fixed
# release port, set parent().par.Autoport to off and parent().par.Ml5port to
# your preferred port before this runs.


def get_free_port():
    import socket

    sock = socket.socket()
    sock.bind(("", 0))
    free_port = sock.getsockname()[1]
    sock.close()
    return free_port


def _parent_par_exists(name):
    try:
        return getattr(parent().par, name) is not None
    except Exception:
        return False


def _selected_port():
    if _parent_par_exists("Autoport") and int(parent().par.Autoport.eval()) == 0:
        if _parent_par_exists("Ml5port"):
            return int(parent().par.Ml5port.eval())

    return get_free_port()


def _set_parent_port(port):
    if _parent_par_exists("Ml5port"):
        parent().par.Ml5port = port


def _web_browser_comp():
    return op("webBrowser") or op("webBrowser1")


def _update_current_url(port):
    current_url = op("current_url")

    webcam = ""
    if _parent_par_exists("Webcam"):
        webcam = str(parent().par.Webcam.eval())

    emotion = int(parent().par.Emotion.eval()) if _parent_par_exists("Emotion") else 1
    facemesh = int(parent().par.Facemesh.eval()) if _parent_par_exists("Facemesh") else 0
    eyetrack = int(parent().par.Eyetrack.eval()) if _parent_par_exists("Eyetrack") else 0
    wflip = int(parent().par.Wflip.eval()) if _parent_par_exists("Wflip") else 0
    showoverlays = int(parent().par.Showoverlays.eval()) if _parent_par_exists("Showoverlays") else 1
    showui = int(parent().par.Showui.eval()) if _parent_par_exists("Showui") else 1

    url = "http://localhost:{}/index.html?webcamId={}&Emotion={}&Facemesh={}&Eyetrack={}&Wflip={}&Showoverlays={}&Showui={}".format(
        port,
        webcam,
        emotion,
        facemesh,
        eyetrack,
        wflip,
        showoverlays,
        showui,
    )

    if current_url is not None:
        current_url.text = url

    webBrowserCOMP = _web_browser_comp()
    if webBrowserCOMP is not None:
        webBrowserCOMP.par.Address = url
        webBrowserCOMP.allowCooking = 1

    return url


def configure_server():
    webServerDAT = op("webserver1")
    if webServerDAT is None:
        print("init_port: webserver1 not found")
        return

    webServerDAT.par.active = 0
    thisPort = _selected_port()
    print("Using ML5 port " + str(thisPort))
    webServerDAT.par.port = thisPort
    _set_parent_port(thisPort)
    webServerDAT.par.active = 1
    url = _update_current_url(thisPort)

    if url:
        print("ML5 browser URL " + url)
    return


def onStart():
    configure_server()
    return


def onCreate():
    configure_server()
    return


def onExit():
    return


def onFrameStart(frame):
    return


def onFrameEnd(frame):
    return


def onPlayStateChange(state):
    return


def onDeviceChange():
    return


def onProjectPreSave():
    return


def onProjectPostSave():
    return

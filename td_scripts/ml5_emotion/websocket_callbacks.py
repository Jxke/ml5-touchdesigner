"""
TouchDesigner receiver example.

Suggested network:
1. WebSocket DAT named websocket1, configured as a server on port 9980.
2. Table DAT named emotion_table.
3. Text DAT named parse_emotion_json containing parse_emotion_json.py.
4. DAT Execute DAT attached to websocket1, with onReceiveText enabled.

Paste this file into the DAT Execute DAT callbacks, or copy the functions you need.
"""


CHANNEL_ROWS = [
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
]


EXPRESSION_ROWS = [
    "neutral",
    "happy",
    "sad",
    "angry",
    "fearful",
    "disgusted",
    "surprised",
    "dominantConfidence",
]


def _format_value(channel_name, value):
    if channel_name in EXPRESSION_ROWS:
        try:
            number = float(value)
        except Exception:
            number = 0.0

        if number < 0.0:
            number = 0.0
        elif number > 1.0:
            number = 1.0

        # Avoid scientific notation in Table DATs, e.g. 4.2e-8.
        return "{:.6f}".format(number)

    if channel_name in ("dominantValue", "hasFace"):
        try:
            return int(value)
        except Exception:
            return 0

    return value


def ensure_emotion_table(table_dat):
    """Create the expected name/value rows if the table is empty or malformed."""
    if table_dat.numRows == len(CHANNEL_ROWS) + 1 and table_dat[0, 0].val == "name":
        existing_names = [table_dat[row, 0].val for row in range(1, table_dat.numRows)]
        if existing_names == CHANNEL_ROWS:
            return

    table_dat.clear()
    table_dat.appendRow(["name", "value"])
    for channel_name in CHANNEL_ROWS:
        table_dat.appendRow([channel_name, 0])


def write_values_to_table(table_dat, values):
    ensure_emotion_table(table_dat)

    row_by_name = {
        table_dat[row, 0].val: row
        for row in range(1, table_dat.numRows)
    }

    for channel_name in CHANNEL_ROWS:
        row_index = row_by_name[channel_name]
        table_dat[row_index, 0] = channel_name
        table_dat[row_index, 1] = _format_value(channel_name, values.get(channel_name, 0))


def _parse_emotion_payload(message):
    for module_name in ("parse_emotion_json", "text1"):
        try:
            module = mod(module_name)
            if module is not None:
                return module.parse_emotion_payload(message)
        except Exception:
            pass

    raise Exception("Could not find parse_emotion_json Text DAT")


# DAT Execute callback for WebSocket DAT text messages.
# me - this DAT Execute DAT
# dat - the DAT that received a message
# rowIndex - the row number the message was placed into
# message - a unicode representation of the text frame
def onReceiveText(dat, rowIndex, message):
    if not message or message in ("ping", "pong"):
        return

    values = _parse_emotion_payload(message)
    write_values_to_table(op("emotion_table"), values)
    return


def onConnect(dat):
    print("ml5 emotion browser connected")
    return


def onDisconnect(dat):
    print("ml5 emotion browser disconnected")
    return


def onReceiveBinary(dat, contents):
    return


def onReceivePing(dat, contents):
    dat.sendPong(contents)
    return


def onReceivePong(dat, contents):
    return


def onMonitorMessage(dat, message):
    return

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


def ensure_emotion_table(table_dat):
    """Create the expected name/value rows if the table is empty or malformed."""
    if table_dat.numRows == len(CHANNEL_ROWS) + 1 and table_dat[0, 0].val == "name":
        return

    table_dat.clear()
    table_dat.appendRow(["name", "value"])
    for channel_name in CHANNEL_ROWS:
        table_dat.appendRow([channel_name, 0])


def write_values_to_table(table_dat, values):
    ensure_emotion_table(table_dat)

    for row_index, channel_name in enumerate(CHANNEL_ROWS, start=1):
        table_dat[row_index, 0] = channel_name
        table_dat[row_index, 1] = values.get(channel_name, 0)


# DAT Execute callback for WebSocket DAT text messages.
# me - this DAT Execute DAT
# dat - the DAT that received a message
# rowIndex - the row number the message was placed into
# message - a unicode representation of the text frame
def onReceiveText(dat, rowIndex, message):
    if not message or message in ("ping", "pong"):
        return

    values = mod("parse_emotion_json").parse_emotion_payload(message)
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

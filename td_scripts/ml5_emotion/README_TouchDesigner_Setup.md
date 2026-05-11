# TouchDesigner Setup

This project sends browser-side ml5 face expression data to TouchDesigner as JSON over the same local Web Server DAT that serves the browser files. This matches Torin's MediaPipe component pattern.

## Network Setup

1. Create a Web Server DAT named `webserver1`.
2. Set the listening port to `9981`.
3. Enable WebSocket support on the Web Server DAT.
4. Create a Table DAT named `emotion_table`.
5. Create a Text DAT named `parse_emotion_json` and paste in `td_scripts/ml5_emotion/parse_emotion_json.py`.
6. Create a Text DAT named `websocket_callbacks` and paste in `td_scripts/ml5_emotion/websocket_callbacks.py`.
7. Create a Text DAT named `webserver_callbacks` and paste in `td_scripts/ml5_emotion/webserver_callbacks.py`.
8. Create a Text DAT named `par_change_handler` and paste in `td_scripts/ml5_emotion/par_change_handler.py`.
9. Create a Text DAT named `init_port` and paste in `td_scripts/ml5_emotion/init_port.py`.
10. Create a Text DAT named `rebuild_custom_pars` and paste in `td_scripts/ml5_emotion/rebuild_custom_pars.py`.
11. Create a Text DAT named `current_url`; set its expression to the contents of `td_scripts/ml5_emotion/current_url_expression.txt`.
12. Create a Text DAT named `webcam_list`. It stores the browser webcam device list as raw JSON.
13. Create a JSON/table conversion DAT named `webcam_menu` from `webcam_list`, so it outputs table columns including `deviceId` and `label`.
14. Create a Parameter DAT named `parameter1` watching the ML5 component custom parameters.
15. Create a DAT Execute DAT watching `parameter1`, with `onCellChange` enabled, using `par_change_handler`.
16. Set the Web Server DAT callbacks parameter to `webserver_callbacks`.

## Web Server Setup

Torin's project serves the browser page with Web Server DAT callbacks. Use the same pattern here.

1. Start the Web Server DAT.
2. Open `http://localhost:9981/index.html` in an external browser first.

The callback serves files from `_mpdist` during development. If `_mpdist` is not present, it serves the same paths from the `virtualFile` VFS operator.

## Webcam Selection

The browser enumerates webcams after permission is granted and sends the list to TouchDesigner. `webserver_callbacks.py` stores the raw JSON in a Text DAT named `webcam_list`.

For the closest Torin-style setup:

1. Run `rebuild_custom_pars` once to create the `ML5` custom parameter page.
2. Start the Web Server DAT and Web Browser COMP once so the browser can ask for camera access.
3. After `webcam_list` is populated, run `rebuild_custom_pars` again so the `Webcam` menu uses real camera labels and device IDs.
4. Point `webBrowser.par.Address` at `op("current_url").text`.

The browser also supports Torin/MoveNet-style URL selection:

```text
http://localhost:9981/index.html?webcamId=<deviceId>
```

To switch cameras from TouchDesigner, send a WebSocket message back to the browser:

```python
mod("webserver_callbacks").send_webcam_selection("browser-device-id")
```

For a Torin-style menu parameter, create a custom menu parameter named `Webcam`. `rebuild_custom_pars.py` creates it as a Menu parameter and sets its source to `tdu.TableMenu(me.findChildren(name='webcam_menu')[0])`. This expects `webcam_menu` to be the parsed table output from the JSON stored in `webcam_list`.

For a Torin-style parameter table, set `parameter1` rows like:

| name | value |
| --- | --- |
| Ml5port | 9981 |
| Webcam | browser-device-id |
| Wwidth | 640 |
| Wheight | 480 |
| Wflip | 0 |

Attach a DAT Execute DAT to `parameter1` and use `par_change_handler.py`. When the `Webcam` cell changes, it sends `{"Webcam": "browser-device-id"}` to the browser without reloading the page, and rebuilds the browser URL as `?webcamId=browser-device-id`.

## Expected Table

`emotion_table` will be written with two columns:

| name | value |
| --- | --- |
| neutral | 0.0 |
| happy | 0.0 |
| sad | 0.0 |
| angry | 0.0 |
| fearful | 0.0 |
| disgusted | 0.0 |
| surprised | 0.0 |
| dominantValue | -1 |
| dominantConfidence | 0.0 |
| hasFace | 0 |

## CHOP Output Option

If you want CHOP channels, add a DAT to CHOP after `emotion_table`.

Recommended DAT to CHOP settings:

- First row is names: off, because names are in the first column.
- First column is names: on.
- Select only the `value` column.

You can also drive a Constant CHOP manually from the table if your network requires fixed channel names.

## Browser Test

If you are testing from source, run the browser project first:

```sh
corepack enable
yarn install
yarn dev
```

Open:

```text
http://localhost:5173
```

Allow webcam permission. Once TouchDesigner is listening on port `9981`, the browser status should change to connected and `emotion_table` should update.

If you are using a packaged tox, the tox should serve the built browser files from TouchDesigner's Virtual File System, so users should not need Yarn or Vite.

## Importing Built Files Into VFS

The VFS import script does not run the web build. Build first from Terminal:

```sh
cd /Users/jaketan/Documents/GitHub/ml5-touchdesigner
corepack yarn build
```

Then run `td_scripts/ml5_emotion/import_vfs.py` from a Text DAT inside the main ML5 component. The script copies `_mpdist` into the component's `virtualFile` VFS while preserving paths.

## Port Mismatch

The browser connects to the same host and port as the loaded page by default. For example, `http://localhost:9981/index.html` connects to `ws://localhost:9981`.

To change the browser port, edit `src/websocket.js`.

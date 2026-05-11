# ml5-touchdesigner

Browser-based facial expression recognition for TouchDesigner using `ml5.js`, `p5.js`, and a local WebSocket JSON stream.

The browser opens the webcam, runs `ml5.faceApi` with expression detection, draws a simple preview, and sends expression values to TouchDesigner. TouchDesigner receives the JSON with a WebSocket DAT and converts it into DAT/CHOP-friendly channels.

## Architecture

This follows the same broad pattern as Torin Blankensmith's MediaPipe TouchDesigner project:

1. A Vite-served browser page runs the webcam and browser ML model.
2. TouchDesigner hosts or launches that page through Chromium/Web Render, or you test it in an external browser.
3. The browser sends JSON to TouchDesigner over a local WebSocket.
4. TouchDesigner-side scripts parse JSON into DAT/CHOP-friendly values.

This project does not run ml5 inside TouchDesigner Python. The ML runtime belongs in the browser.

The browser assets are stored locally in `src/vendor/` and the face-expression model files are stored locally in `src/faceapi/models/`. That mirrors Torin's clean release approach: the tox build can embed the built web page and model files into TouchDesigner's Virtual File System, so non-technical users can open the tox without running command-line build steps.

## Do You Need Install And Build?

End users should not need this section if you ship a built tox. They should download/open the tox.

For source development/testing, install Node.js first, then use Corepack to run the pinned Yarn version:

```sh
corepack enable
yarn install
yarn dev
```

Open:

```text
http://localhost:5173
```

For day-to-day testing, you do not need `yarn build`.

`yarn build` is only for packaging static browser files, for example when you later embed the built page into a tox/release workflow. Torin's project also uses this model: Vite for development and a production build when bundling assets into the TouchDesigner component/release.

```sh
yarn build
```

The build output goes to `_mpdist/`, matching Torin's build-output convention.

## Project Layout

```text
ml5-touchdesigner/
  README.md
  package.json
  package-lock.json
  vite.config.js
  index.html
  src/
    main.js
    state.js
    websocket.js
    emotionMapping.js
    style.css
    vendor/
      p5.min.js
      ml5.min.js
      face-api.min.js
    faceapi/
      models/
  td_scripts/
    ml5_emotion/
      README_TouchDesigner_Setup.md
      webserver_callbacks.py
      websocket_callbacks.py
      parse_emotion_json.py
```

No tox files are included here. The browser assets, local model files, and parser pieces are ready for tox packaging.

## TouchDesigner Setup

1. Add a Web Server DAT, using the callbacks in `td_scripts/ml5_emotion/webserver_callbacks.py`.
2. Configure it to listen on port `9981`.
3. Use the same Web Server DAT for HTTP file serving and WebSocket messages, matching Torin's project.
4. Open `http://localhost:9981/index.html` in an external browser first for testing.
5. After testing, optionally load the page in TouchDesigner's Web Render TOP or browser component.
6. Use the scripts in `td_scripts/ml5_emotion/` to update a Table DAT named `emotion_table`.

See `td_scripts/ml5_emotion/README_TouchDesigner_Setup.md` for the TouchDesigner network setup.

## Expression Channels

The browser sends these seven confidence channels every send interval:

| Channel | Meaning |
| --- | --- |
| `neutral` | Neutral expression confidence |
| `happy` | Happy expression confidence |
| `sad` | Sad expression confidence |
| `angry` | Angry expression confidence |
| `fearful` | Fearful expression confidence |
| `disgusted` | Disgusted expression confidence |
| `surprised` | Surprised expression confidence |

Each value is a float, usually from `0.0` to `1.0`.

## Expression Mapping

Dominant expression IDs:

| Expression | Value |
| --- | ---: |
| `neutral` | 0 |
| `happy` | 1 |
| `sad` | 2 |
| `angry` | 3 |
| `fearful` | 4 |
| `disgusted` | 5 |
| `surprised` | 6 |
| `none` | -1 |

Change this mapping in `src/emotionMapping.js` if your TouchDesigner network expects different values.

## JSON Payload

When a face is detected:

```json
{
  "type": "ml5_face_expression",
  "timestamp": 1710000000000,
  "hasFace": true,
  "faceCount": 1,
  "dominantExpression": "happy",
  "dominantValue": 1,
  "dominantConfidence": 0.93,
  "expressions": {
    "neutral": 0.01,
    "happy": 0.93,
    "sad": 0.01,
    "angry": 0,
    "fearful": 0.01,
    "disgusted": 0,
    "surprised": 0.04
  },
  "box": {
    "x": 100,
    "y": 80,
    "width": 160,
    "height": 160
  }
}
```

When no face is detected:

```json
{
  "type": "ml5_face_expression",
  "timestamp": 1710000000000,
  "hasFace": false,
  "faceCount": 0,
  "dominantExpression": "none",
  "dominantValue": -1,
  "dominantConfidence": 0,
  "expressions": {
    "neutral": 0,
    "happy": 0,
    "sad": 0,
    "angry": 0,
    "fearful": 0,
    "disgusted": 0,
    "surprised": 0
  },
  "box": null
}
```

## WebSocket Settings

Default browser WebSocket target:

```text
ws://localhost:9981
```

Change host or port at the top of `src/websocket.js`.

If the connection drops, the browser preview keeps running and reconnects every second.

## Troubleshooting

Yarn version mismatch:

This repo pins Yarn through `packageManager`. If your global `yarn` is version 1, run `corepack enable`, then run `yarn install` again.

npm permission error:

You do not need `npm install --global yarn` if Corepack is available. If npm reports root-owned cache files, fix the cache ownership with `sudo chown -R $(id -u):$(id -g) ~/.npm`.

Camera permission blocked:

Allow camera access in the browser's site settings, then reload the page.

WebSocket not connected:

Start the TouchDesigner Web Server DAT and confirm it is listening on port `9981` with WebSocket support enabled.

Model still loading:

Wait for the status line to say `local face expression models ready`.

No face detected:

Check lighting, camera framing, and whether another application is using the webcam.

TouchDesigner port mismatch:

The browser uses the same host and port as the loaded page by default. For example, `http://localhost:9981/index.html` connects to `ws://localhost:9981`.

HTTPS/camera permission issues:

Browsers allow camera access on `localhost` over HTTP. If hosting elsewhere, use HTTPS or camera access may be blocked.

## Acceptance Test

1. Run `yarn install`.
2. Run `yarn dev`.
3. Open `http://localhost:5173`.
4. Allow webcam access.
5. Confirm the webcam preview appears.
6. Confirm all seven expression values update in the browser UI.
7. Start the TouchDesigner Web Server listener on port `9981`.
8. Confirm JSON messages arrive in the WebSocket DAT.
9. Confirm `emotion_table` updates with expression values.

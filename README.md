# LeetCode Template Generator

Local Chrome (MV3) + VS Code extensions that:

1. **Generate** a templated solution file in VS Code from the current LeetCode
   problem page (Chrome popup → VS Code bridge).
2. **Push** the code back from VS Code into the LeetCode Monaco editor, with an
   optional Run/Submit (VS Code sidebar → Chrome → LeetCode tab).

## Structure

```text
chrome-extension/
  manifest.json
  popup.html
  options.html
  styles/styles.css
  src/
    config.js              bridge port
    http.js                HTTP client (generate / settings / pull / push-result)
    leetcodeUrl.js         URL validation + normalization
    popup.js               popup controller
    options.js             options-form controller
    options.defaults.js    default settings + constants
    background.js          MV3 service-worker entry (keep-alive + poll loop)
    bg/
      poller.js            long-poll loop
      pusher.js            focus/open a single tab and paste
      inject.js            MAIN-world functions (paste + readiness probe)

vscode-extension/
  config.json              bridge port only
  package.json
  resources/leetcode.svg   activity-bar icon (monochrome, currentColor)
  src/
    extension.js           activation + command/view wiring
    config.js
    server.js              HTTP routing + CORS + body parsing
    pushQueue.js           reverse-push job queue + long-poll state
    leetcode.js            LeetCode GraphQL fetch + slug/language helpers
    render.js              template rendering helpers
    generator.js           builds + writes the solution file and its .lch metadata
    settingsStore.js       settings + path resolution (clears missing paths)
    validate.js            settings sanitization
    defaultSettings.js
    metaStore.js           per-file .lch metadata (cph-style)
    codeExtract.js         "code section only" detection
    pushView.js            "Push to LeetCode" sidebar provider
    pushViewHtml.js        sidebar webview HTML
```

## Bridge routes

```text
POST /generate            create a solution file (+ .lch metadata) from a problem URL
GET  /settings            read generator settings
POST /settings            validate + save settings
POST /choose-destination  open a folder picker in VS Code
GET  /pull                long-poll for a queued push (reverse flow)
POST /push-result         Chrome reports a push result (ok / error / opening)
```

## Two flows

### Generate (Chrome → VS Code)

The popup reads the active LeetCode tab URL and `POST`s it to `/generate`. VS Code
fetches the problem via GraphQL, writes a templated solution file, and writes a
`.lch` metadata file (see below).

### Push (VS Code → LeetCode)

Open the **LeetCode Generator** activity-bar icon → **Push to LeetCode** view. With a
linked file active you can:

- toggle **Copy code section only** (see "Code section detection"),
- choose an **After paste** action (Do nothing / Run / Submit),
- **Push to LeetCode**, or **Reset to template** (overwrites the file after a
  confirmation).

The Chrome background worker long-polls `GET /pull`. On a push it targets **one** tab:
if the problem is already open it focuses that tab and pastes; otherwise it opens the
problem in a new active tab (telling the bridge it is "opening" so the bridge waits
longer), waits for Monaco to load, then pastes and optionally clicks Run/Submit. The
result (with the push job id) is reported to `POST /push-result`.

## Metadata (.lch files)

At generation time a JSON metadata file with a `.lch` extension is written into a
`.lch/` folder, one file per solution (e.g. `.lch/0001-two-sum.lch`). It stores the
problem URL, the template, the LeetCode starter snippet, the generated content, and
the solution path — everything needed to push or reset later.

The `.lch/` folder is created inside the **Metadata folder** setting, or the VS Code
**workspace root** if that setting is empty or points to a missing folder. Both path
settings (solution folder and metadata folder) are **cleared from storage** when they
point to a folder that no longer exists, so the options page shows an empty field and
the problem is easy to spot.

## Code section detection

When "Copy code section only" is on, VS Code sends just the code — not the
header/imports/notes:

1. Take the starter snippet from the `.lch` metadata; skip its leading comments; the
   first real line (e.g. `class Solution {`) is the anchor. Remember the leading
   comments.
2. Find that anchor line in your file and copy from it to the last `}` (or EOF for
   brace-less languages like Python).
3. Prepend the snippet's leading comments to the copied code.
4. If the anchor is not found, a message is shown and the **entire file** is sent.

## Why long-polling instead of WebSocket

The LeetCode page is served over HTTPS. An insecure `ws://` to the local bridge from
that page is blocked by mixed-content, and the bridge only speaks plain HTTP on
loopback. Running everything from the extension's own context (the MV3 background
worker) over HTTP long-polling avoids mixed-content and reuses the popup's transport.

- `GET /pull` is held open up to 25s and returns immediately when a push is queued.
- The worker retries on error (5s) and is kept alive by a 1-minute `chrome.alarms`
  re-kick plus `onInstalled`/`onStartup` bootstrap.

## Build & install

### VS Code extension

No bundling is required to run it in development:

```text
1. cd vscode-extension
2. npm install            # installs devDependencies (none required to run)
3. Open the folder in VS Code and press F5
4. In the Extension Development Host, open your coding workspace
5. Use the LeetCode Generator activity-bar icon for the Push view
```

To build an installable package:

```text
1. npm install -g @vscode/vsce
2. cd vscode-extension && vsce package        # produces a .vsix
3. VS Code → Extensions → "..." → Install from VSIX...
```

The bridge starts at `http://127.0.0.1:8765` unless you change
`vscode-extension/config.json`.

### Chrome extension

The Chrome extension uses native ES modules and needs **no build step**:

```text
1. Open chrome://extensions
2. Enable Developer mode
3. Click "Load unpacked" and select the chrome-extension/ folder
4. Open a LeetCode problem page
5. Click the extension to generate, or use the VS Code Push view to push
```

Edit generator settings from the Chrome options page (language, solution folder,
metadata folder, filename pattern, pad ID, template, and headers). It validates every
field before saving.

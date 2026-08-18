# LeetCode Template Generator Helper (VS Code)

Starts the local browser bridge used by the Chrome extension, generates templated
solution files (+ `.lch` metadata) from LeetCode problem URLs, and pushes code from
the active file back into the LeetCode Monaco editor.

## Modules

```text
config.json        bridge port only
src/config.js      reads config.json
src/extension.js   activation, commands, and the sidebar view wiring
src/server.js      HTTP routing + CORS + JSON body parsing
src/pushQueue.js   reverse-push job queue + long-poll state
src/leetcode.js    LeetCode GraphQL fetch + slug/language helpers
src/render.js      template rendering helpers
src/generator.js   builds + writes the solution file and its .lch metadata
src/settingsStore.js  settings + path resolution (clears missing paths)
src/validate.js    settings sanitization
src/defaultSettings.js
src/metaStore.js   per-file .lch metadata (cph-style) + { file -> meta } map
src/codeExtract.js "code section only" detection
src/pushView.js    "Push to LeetCode" sidebar provider
src/pushViewHtml.js sidebar webview HTML
resources/leetcode.svg  activity-bar icon (monochrome, currentColor)
```

## Routes

```text
POST /generate            create a solution file (+ .lch metadata)
GET  /settings            read settings
POST /settings            validate + save settings
POST /choose-destination  folder picker
GET  /pull                long-poll used by the Chrome background worker
POST /push-result         Chrome reports a push result (ok / error / opening)
```

## Metadata (.lch)

Each generated file gets a JSON metadata file with a `.lch` extension inside a `.lch/`
folder (one file per solution). It stores the problem URL, template, LeetCode starter
snippet, generated content, and the solution path.

The `.lch/` folder lives inside the **Metadata folder** setting, or the workspace root
if that setting is empty or missing. Both the solution folder and the metadata folder
settings are cleared from storage when they point to a folder that no longer exists,
so the options page shows an empty field for easy debugging.

## Push flow (VS Code → LeetCode)

The **Push to LeetCode** view (activity-bar container `leetcodeGenerator`) shows the
active file, a **Copy code section only** checkbox, an **After paste** action
(none / run / submit), a **Push** button, and a **Reset to template** button. If the
active file has no `.lch` metadata, the view shows an explanatory message instead. The
problem URL is intentionally not shown.

The bridge queues a push job with an incrementing id and resolves it via
`POST /push-result`:

- `opening:true` → the browser is opening a fresh tab; the job window is extended
  (loading can be slow).
- `ok:true` → the job resolves with a success message ("Code pushed", "…and Run
  clicked", "…but the Run/Submit button was not found", or, for a Submit, the read
  verdict: "Submitted — Accepted." / "Submitted — Wrong Answer." — shown in the
  sidebar, with non-Accepted verdicts styled as a warning).
- `judging:true` → a Submit was clicked and the browser is reading the verdict; the
  window is extended and the sidebar shows "waiting for the verdict…".
- `ok:false` → the job rejects with the reported error.
- window elapses → "No response from the browser…".

**Reset** re-renders the original generated content from `.lch` metadata into the
active file, after a modal confirmation, overwriting current edits.

### Why long-polling, not WebSocket

The LeetCode page is HTTPS; an insecure `ws://` to the loopback bridge is blocked by
mixed-content, and the bridge only speaks plain HTTP. All traffic therefore runs from
the extension's own context (the MV3 background worker) over HTTP long-polling.

## Build & install

Run in development (no build needed):

```text
1. cd vscode-extension
2. npm install
3. Open the folder in VS Code and press F5
4. In the Extension Development Host, open your coding workspace
```

Package an installable `.vsix`:

```text
1. npm install -g @vscode/vsce
2. cd vscode-extension && vsce package
3. VS Code → Extensions → "..." → Install from VSIX...
```

## Destination

Solution destination mode is either `workspace` or `selected`. Workspace mode writes
into the first workspace folder detected when the bridge starts. Selected mode stores
a full folder path chosen through VS Code, and falls back to workspace mode if that
path is missing. Difficulty grouping creates `Easy`, `Medium`, and `Hard` folders under
the chosen root; otherwise files are created directly in the root.

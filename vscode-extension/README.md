# LeetCode Template Generator Helper (VS Code)

Starts the local browser bridge used by the Chrome extension, generates templated
solution files (+ `.lch` metadata) from LeetCode problem URLs, and pushes code from
the active file back into the LeetCode Monaco editor.

## Modules

```text
config.json        bridge port only
src/config.js      reads config.json
src/extension.js   activation, commands, and the sidebar view wiring
src/server.js      HTTP routing, idempotency, CORS, and port-owner recovery
src/protocol.js    bridge version, request headers, and advertised capabilities
src/pairingStore.js shared-token creation, persistence, rotation, and fingerprint
src/diagnostics.js local connection/workspace diagnostic report builder
src/pushQueue.js   reverse-push job queue + long-poll state
src/leetcode.js    cached/retried LeetCode GraphQL fetch + slug/language helpers
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
POST /generate            create a solution file; body: { url, requestId }
GET  /health              protocol/capability/authentication handshake
POST /pair                automatic token bootstrap for the known Chrome origin
GET  /settings            read settings
POST /settings            validate + save settings
POST /choose-destination  folder picker
GET  /pull                long-poll used by the Chrome background worker
POST /push-result         Chrome reports receipt, progress, or the final push result
```

## Metadata (.lch)

Each generated file gets a JSON metadata file with a `.lch` extension inside a `.lch/`
folder (one file per solution). It stores the problem URL, template, LeetCode starter
snippet, generated content, and the solution path.

The `.lch/` folder lives inside the **Metadata folder** setting, or the workspace root
if that setting is empty or missing. Both the solution folder and the metadata folder
settings are cleared from storage when they point to a folder that no longer exists,
so the options page shows an empty field for easy debugging.

Generation request IDs are retained for 60 seconds. Repeating the same request while it
is running or after a response is lost returns the same result without generating twice.
Successful LeetCode problem data is cached for ten minutes, and transient GraphQL
network/429/5xx failures receive two bounded retries.

## Pairing and protocol compatibility

On first activation, the extension creates a random 256-bit token in VS Code global
state. Chrome obtains it automatically from `POST /pair`. That bootstrap route requires
bridge protocol version `3` and the exact stable Chrome extension origin derived from
the public `key` in `manifest.json`. Chrome saves the token in extension-local storage
and retries the interrupted request. Missing, cleared, or rotated tokens repair
themselves without user involvement.

Every operational route requires the token and matching protocol. The bridge binds only
to `127.0.0.1`; browser requests from other origins are rejected. **Rotate Local
Authentication Token** invalidates the old value, after which Chrome automatically pairs
again. Health and diagnostics never return the secret token.

The health handshake publishes the VS Code extension version, protocol version, and
capabilities. Chrome rejects an incompatible protocol before making protected settings
requests; the server independently rejects every protected request carrying the wrong
version.

`BRIDGE_PROTOCOL_VERSION` is the compatibility number and must match in the Chrome and
VS Code `src/protocol.js` files. It is currently `3`. The extension package versions are
release labels and do not technically need to match, although releasing them together
with the same version is less confusing. A cross-project test verifies both the protocol
number and the manifest-key-derived Chrome extension ID.

Automatic pairing blocks ordinary webpages and unrelated installed extensions; it does
not claim to protect against malicious native software running as the same OS user,
which can spoof HTTP headers. Defending against that stronger threat requires manual
verification or a Chrome Native Messaging host.

## Push flow (VS Code → LeetCode)

The **Push to LeetCode** view (activity-bar container `leetcodeGenerator`) shows the
active file, a **Copy code section only** checkbox, an **After paste** action
(none / run / submit), a **Push** button, and a **Reset to template** button. If the
active file has no `.lch` metadata, the view shows an explanatory message instead. The
problem URL is intentionally not shown.

The bridge queues a push job with an incrementing id and resolves it via
`POST /push-result`:

- `received:true` → Chrome acknowledges the delivered job before touching the page;
  an unacknowledged delivery is offered again instead of being lost.
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

The long-poll stays attached to the outgoing HTTP response until Chrome receives a
job. Multiple pending jobs are kept in order, polling reconnects with bounded backoff,
and result/progress reports are retried if the local bridge briefly drops a connection.

On the page, Chrome waits for a visible solution editor even when the problem tab was
already open. Because LeetCode can mount hidden/plaintext Monaco models alongside the
solution, candidates are ranked by visibility, the `Code editor` accessibility label,
and programming-language model. Code is applied as a Monaco edit and read back after a
short stabilization delay; Run/Submit is attempted only after the exact content is
verified. Transient editor remounts receive bounded retries.

The push job also carries the language recorded in `.lch` metadata. Chrome compares it
with the selected visible Monaco model before writing. A mismatch returns the stable
`language_mismatch` error and leaves the LeetCode editor untouched.

## Diagnostics

Run **LeetCode Helper: Run Diagnostics** to write a local report to the **LeetCode
Helper** Output channel. It includes bridge/port ownership, protocol and capabilities,
the non-secret token fingerprint, Chrome polling freshness, rejected request reason,
queue activity, resolved workspace paths, and active-file metadata/language. Nothing is
sent outside the machine.

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
3. npm test && npm run check
4. Open the folder in VS Code and press F5
5. In the Extension Development Host, open your coding workspace
```

Package an installable `.vsix`:

```text
1. cd vscode-extension
2. npm ci && npm run package
3. VS Code → Extensions → "..." → Install from VSIX...
```

## Destination

Solution destination mode is either `workspace` or `selected`. Workspace mode writes
into the first workspace folder detected when the request arrives. Selected mode stores
a full folder path chosen through VS Code, and falls back to workspace mode if that
path is missing. Difficulty grouping creates `Easy`, `Medium`, and `Hard` folders under
the chosen root; otherwise files are created directly in the root.

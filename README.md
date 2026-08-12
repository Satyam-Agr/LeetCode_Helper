# LeetCode Template Generator

Local Chrome + VS Code extensions for creating LeetCode solution files from the current problem page.

## Structure

```text
chrome-extension/
  manifest.json
  popup.html
  options.html
  src/
  styles/

vscode-extension/
  config.json
  package.json
  src/
```

`vscode-extension/config.json` only stores the bridge port:

```json
{
  "port": 8765
}
```

All generator settings are stored by the VS Code extension and changed through the Chrome extension options page.

## Bridge Routes

```text
POST /generate
GET  /settings
POST /settings
```

`POST /settings` validates and sanitizes posted settings before saving.

## Load VS Code Extension

```text
1. Open vscode-extension in VS Code
2. Press F5
3. In the Extension Development Host, open your coding workspace
```

The bridge starts at `http://127.0.0.1:8765` unless you change `vscode-extension/config.json`.

## Load Chrome Extension

```text
1. Open chrome://extensions
2. Enable Developer mode
3. Click Load unpacked
4. Select chrome-extension
5. Open a LeetCode problem page
6. Click the extension
```

Use the Chrome extension options page to edit generator settings with a form. It validates language, destination, filename pattern, pad ID, template variables, and header snippet sizes before saving.

## Destination Folder

The destination setting is optional because the generator can write directly to the workspace root. There are two destination modes:

- `Workspace root`: files are created in the first workspace folder detected when the VS Code bridge starts. This root does not change while the bridge is running. Restart the VS Code extension or bridge after opening a different workspace to update it.
- `Selected folder`: use the options page folder picker to choose an existing folder. The options page shows the full selected path, and the VS Code bridge verifies the folder still exists before saving.

If the selected folder is missing when settings are saved or when the VS Code extension boots, the extension automatically falls back to `Workspace root`.

When `Group by difficulty` is enabled, files are written under `Easy`, `Medium`, and `Hard` folders inside the chosen root. When it is disabled, files are written directly in the chosen root. The generator no longer creates a `LeetCode` wrapper folder by default.

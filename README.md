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

`POST /settings` currently stores the posted settings as-is.

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

Use the extension options page to edit generator settings.

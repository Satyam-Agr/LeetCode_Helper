# LeetCode Template Generator Helper

This VS Code extension starts the local browser bridge used by the Chrome extension.

## Files

```text
config.json       bridge port only
src/config.js     reads config.json
src/server.js     /generate, /settings, and /choose-destination routes
src/generator.js  file generation
src/leetcode.js   LeetCode GraphQL fetch
src/settingsStore.js
```

## Routes

```text
POST /generate
GET  /settings
POST /settings
POST /choose-destination
```

Settings are stored in VS Code global state. The Chrome extension options page reads and writes them.

Destination mode is either `workspace` or `selected`. Workspace mode writes into the first workspace folder detected when the bridge starts. Selected mode stores a full folder path chosen through VS Code, and the helper falls back to workspace mode if that path is missing during save or extension boot. Difficulty grouping still creates `Easy`, `Medium`, and `Hard` folders under the chosen root; otherwise files are created directly in the root.

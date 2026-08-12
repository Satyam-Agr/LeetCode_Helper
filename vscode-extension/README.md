# LeetCode Template Generator Helper

This VS Code extension starts the local browser bridge used by the Chrome extension.

## Files

```text
config.json       bridge port only
src/config.js     reads config.json
src/server.js     /generate and /settings routes
src/generator.js  file generation
src/leetcode.js   LeetCode GraphQL fetch
src/settingsStore.js
```

## Routes

```text
POST /generate
GET  /settings
POST /settings
```

Settings are stored in VS Code global state. The Chrome extension options page reads and writes them.

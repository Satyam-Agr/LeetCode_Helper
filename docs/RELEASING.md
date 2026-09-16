# Releasing LeetCode Helper

GitHub Releases is the distribution channel for both components. A release is built
from an existing stable `vMAJOR.MINOR.PATCH` tag; the workflow never releases an
untagged branch or local working tree.

## One-time repository settings

In **Settings → Rules → Rulesets**:

1. Protect `main` and require the `Quality (ubuntu-latest)`,
   `Quality (windows-latest)`, `Chrome end-to-end`, and `Package and inspect` checks.
2. Restrict creation and deletion of tags matching `v*` to repository maintainers.
3. Enable immutable releases if it is available for the repository.

These GitHub settings cannot be applied by files committed to the repository. The
workflow itself still reruns every check against the tagged commit before publishing.

## Prepare a stable release

Start from a clean, up-to-date `main` branch. The repository is already prepared as
`1.1.0` for the first automated release because `v1.0.0` exists and must not be reused.
For later releases, replace the example version below with the next stable version.

After the current changes are committed to `main` and CI is green, start the first
automated release with:

```powershell
node scripts/validate-release.mjs --tag v1.1.0
git tag v1.1.0
git push origin v1.1.0
```

For subsequent releases, prepare all package versions together before committing:

```powershell
node scripts/prepare-version.mjs 1.2.0
node scripts/validate-release.mjs
git diff
git add chrome-extension/manifest.json chrome-extension/package.json chrome-extension/package-lock.json vscode-extension/package.json vscode-extension/package-lock.json
git commit -m "Release 1.2.0"
git tag v1.2.0
git push origin main v1.2.0
```

The tag starts the release workflow. It produces:

- `leetcode-helper-chrome.zip`
- `leetcode-helper-vscode.vsix`
- `SHA256SUMS.txt`

The release is created as a draft, populated and verified, and only then published as
the latest stable release. Pre-release versions such as `v1.1.0-beta.1` are rejected.

To add a curated summary, detailed bug report, upgrade steps, or known issues, commit
`.github/release-notes/vX.Y.Z.md` before creating the matching tag. It is prepended to
the automatically generated pull-request changelog. See
[RELEASE_NOTES.md](RELEASE_NOTES.md) for the complete behavior and template.

## Retry a failed draft

Open **Actions → Release → Run workflow** and enter the existing tag. A retry may
replace assets on that tag's draft release. It refuses to modify an already published
release; publish a new patch version instead.

## Distribution limitations

The Chrome ZIP must be extracted and loaded with Chrome's **Load unpacked** action.
GitHub cannot provide Chrome Web Store-style installation or automatic updates on
ordinary Windows and macOS installations. A manually installed VSIX also does not
receive Marketplace updates, so users must install each new VSIX themselves.

Use the named release assets. GitHub's automatically generated “Source code” archives
contain the whole repository and are not installable Chrome extension packages.

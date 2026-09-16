# Custom and Automatic Release Notes

Every stable release receives GitHub-generated notes. You can optionally add a curated
description by committing one Markdown file whose name exactly matches the release tag:

```text
.github/release-notes/vMAJOR.MINOR.PATCH.md
```

For example, release `v1.2.0` reads `.github/release-notes/v1.2.0.md`. The file must be
present in the commit being tagged. Adding it after the tag is pushed is too late for
the automated release.

## Quick workflow

1. Prepare the release version.
2. Copy the template to the exact tag filename.
3. Replace every placeholder and write the user-facing description.
4. Commit the notes with the code and version changes.
5. Validate, tag, and push.

```powershell
node scripts/prepare-version.mjs 1.2.0
Copy-Item .github/release-notes/TEMPLATE.md .github/release-notes/v1.2.0.md
# Edit .github/release-notes/v1.2.0.md
node scripts/validate-release.mjs --tag v1.2.0
git add .github/release-notes/v1.2.0.md
git commit -m "Release 1.2.0"
git tag v1.2.0
git push origin main v1.2.0
```

The validator rejects an empty file, common template placeholders, files larger than
64 KiB, and any tag/package version mismatch. If the version-specific file is absent,
the release remains valid and uses automatic notes only.

## What is automatic

GitHub generates the lower portion of the release description from merged pull
requests since the previous release. `.github/release.yml` controls the categories:

| Pull-request label | Generated section |
| --- | --- |
| `feature`, `enhancement` | Features |
| `bug`, `fix` | Fixes |
| `documentation` | Documentation |
| `dependencies` | Dependencies |
| No matching label | Other Changes |
| `skip-changelog` | Excluded completely |

GitHub also adds contributors and a link to the complete comparison. The workflow
automatically supplies the release title, tag, stable/latest status, three verified
download assets, checksums, and build-provenance attestations.

Automatic notes primarily use pull-request titles. Write a clear PR title and apply the
right label before creating the tag. Put `Fixes #123` in a pull request when it should
close and link an issue.

## What the custom file controls

The complete contents of the version-specific Markdown file are placed at the **top**
of the release description. Use it for:

- A short release summary or announcement.
- Detailed explanations of important bug fixes.
- Upgrade or migration instructions.
- Breaking changes, security notes, and compatibility requirements.
- Known limitations that users should read before updating.
- Links to issues, pull requests, documentation, or migration guides.

The custom content is prepended; it does not replace the automatically generated
changelog. This makes the curated explanation prominent while preserving the mechanical
record of merged work and contributors.

## What it cannot override

The Markdown file cannot change:

- The release tag or synchronized extension version.
- The release title (`LeetCode Helper vX.Y.Z`).
- Stable-only validation or the **Latest** designation.
- Which commit is packaged.
- Asset names or package contents.
- Checksums, attestations, test results, or publication gates.
- The category of an automatically listed pull request.

To change an automatic PR category, change its label before releasing. To remove a PR
from generated notes, apply `skip-changelog`. Writing a different description in the
custom file clarifies the change but does not remove the generated PR entry.

## Draft retries and published releases

If a workflow fails after creating the draft, a retry preserves the draft description
and only resumes asset upload and verification. This avoids overwriting manual edits
made to the draft on GitHub.

After publication, GitHub still allows the title and description to be edited even when
release immutability is enabled. Such edits do not change the committed notes file and
will not modify the immutable tag or assets. For an auditable correction, prefer a new
patch release and explain the correction in that release's notes.

## Recommended structure

Start from `.github/release-notes/TEMPLATE.md`. Keep the most important information near
the top and describe effects from the user's perspective. Do not repeat every pull
request; the automatic section already provides that list.

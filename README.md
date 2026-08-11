# LeetCode Template Generator

A small personal CLI that creates solution files from LeetCode's default code snippets and your own file template.

It takes a LeetCode problem URL, fetches public problem data through LeetCode GraphQL, renders your configured template, and writes the file to your configured destination. Existing files are never overwritten.

## Setup

Requires Python 3.9 or newer. No runtime dependencies are needed.

```bash
pip install -e .
```

Edit `config.json` in the project root. If you run `lcgen` from a directory that also contains `config.json`, that local config is used instead.

## Config Example

```json
{
  "language": "java",
  "destination": "D:/Coding/LeetCode",
  "template": "// Problem: {title}\n// ID: {id}\n// Difficulty: {difficulty}\n\n{code}\n",
  "filename": "{id}-{slug}",
  "pad_id": 4,
  "group_by_difficulty": true
}
```

Supported language examples: `java`, `python`, `cpp`, `javascript`, `c`.

Template variables:

```text
{id}
{title}
{slug}
{difficulty}
{language}
{code}
```

## Usage

```bash
lcgen https://leetcode.com/problems/two-sum/
```

Example output path:

```text
D:/Coding/LeetCode/Easy/0001-two-sum.java
```

## Example Output

```text
Fetching problem...
✓ Two Sum
✓ Problem ID: 1
✓ Difficulty: Easy
✓ Language: Java
✓ Template applied

Creating:
D:/Coding/LeetCode/Easy/0001-two-sum.java

✓ File created successfully
```

If the file already exists, creation is skipped with a clear message.

## Common Issues

`✗ Could not extract LeetCode slug`: pass a full URL like `https://leetcode.com/problems/two-sum/`.

`✗ Unsupported language: rust`: choose one of the configured supported languages.

`✗ Missing language snippet`: the selected problem does not provide a snippet for that language.

`✗ Failed to fetch problem data`: check your internet connection or try again later.

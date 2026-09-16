// LeetCode URL helpers shared by Chrome extension entry points.

// Throws a user-friendly error if `pageUrl` is not a LeetCode problem page.
export function validateLeetCodeProblemUrl(pageUrl) {
  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new Error("This tab does not have a valid URL.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "leetcode.com" && host !== "www.leetcode.com") {
    throw new Error("Open a LeetCode problem page first.");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "problems") {
    throw new Error("This is LeetCode, but not a problem page.");
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parts[1])) {
    throw new Error("Could not extract a valid problem slug.");
  }
}

// Normalize to "leetcode.com/problems/<slug>" (only leetcode.com / www.leetcode.com),
// or null if the URL is not a LeetCode problem page.
export function normalizeProblemUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "leetcode.com" && host !== "www.leetcode.com") {
    return null;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "problems") {
    return null;
  }

  return `leetcode.com/problems/${parts[1].toLowerCase()}`;
}

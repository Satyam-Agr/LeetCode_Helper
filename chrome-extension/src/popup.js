import { generateFile } from "./api.js";

const statusEl = document.querySelector("#status");
const detailsEl = document.querySelector("#details");
const problemEl = document.querySelector("#problem");
const outputEl = document.querySelector("#output");
const retryButton = document.querySelector("#retry");

retryButton.addEventListener("click", run);

run();

async function run() {
  setStatus("Checking current tab...");
  setDetails("", "");
  retryButton.hidden = true;

  try {
    const tab = await getActiveTab();
    if (!tab?.url) {
      throw new Error("Could not read the current tab URL.");
    }

    validateLeetCodeProblemUrl(tab.url);

    setStatus("Sending to VS Code...");
    const result = await generateFile(tab.url);

    setStatus(result.status === "skipped" ? "File already exists." : "File created.");
    setDetails(`${result.problemId}. ${result.title}`, result.path);
  } catch (error) {
    setStatus(error.message || "Something went wrong.");
    retryButton.hidden = false;
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

function setDetails(problem, output) {
  detailsEl.hidden = !problem && !output;
  problemEl.textContent = problem;
  outputEl.textContent = output;
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function validateLeetCodeProblemUrl(pageUrl) {
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

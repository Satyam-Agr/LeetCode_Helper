import { generateFile } from "./http.js";
import { validateLeetCodeProblemUrl } from "./leetcodeUrl.js";

const statusEl = document.querySelector("#status");
const detailsEl = document.querySelector("#details");
const problemEl = document.querySelector("#problem");
const outputEl = document.querySelector("#output");
const retryButton = document.querySelector("#retry");

retryButton.addEventListener("click", run);

run();

async function run() {
  setStatus("Checking current tab...", true);
  setDetails("", "");
  retryButton.hidden = true;

  try {
    const tab = await getActiveTab();
    if (!tab?.url) {
      throw new Error("Could not read the current tab URL.");
    }

    validateLeetCodeProblemUrl(tab.url);

    setStatus("Sending to VS Code...", true);
    const result = await generateFile(tab.url);

    setStatus(result.status === "skipped" ? "File already exists." : "File created.");
    setDetails(`${result.problemId}. ${result.title}`, result.path);
  } catch (error) {
    setStatus(error.message || "Something went wrong.");
    retryButton.hidden = false;
  }
}

function setStatus(message, busy = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("busy", busy);
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

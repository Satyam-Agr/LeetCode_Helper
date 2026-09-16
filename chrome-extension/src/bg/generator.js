export function createGenerationController({ generate, validateUrl, showStatus, createRequestId = defaultRequestId }) {
  const generationByTab = new Map();

  async function handleClick(tab) {
    const tabId = tab?.id;
    if (tabId == null) {
      return null;
    }

    try {
      validateUrl(tab.url);
    } catch (error) {
      await showStatus(tabId, "error", error.message || "Open a LeetCode problem page first.");
      return null;
    }

    const current = generationByTab.get(tabId);
    if (current) {
      await showStatus(tabId, "busy", "Already sending this problem to VS Code...");
      return current;
    }

    const requestId = createRequestId();
    const operation = runGeneration(tabId, tab.url, requestId);
    generationByTab.set(tabId, operation);

    try {
      return await operation;
    } finally {
      if (generationByTab.get(tabId) === operation) {
        generationByTab.delete(tabId);
      }
    }
  }

  async function runGeneration(tabId, url, requestId) {
    await showStatus(tabId, "busy", "Sending problem to VS Code...");

    try {
      const result = await generate(url, requestId);
      const verb = result.status === "skipped" ? "Opened existing file" : "Created file";
      const label = result.problemId && result.title ? `${result.problemId}. ${result.title}` : "LeetCode problem";
      await showStatus(tabId, "success", `${verb}: ${label}`);
      return result;
    } catch (error) {
      await showStatus(tabId, "error", error.message || "Could not send this problem to VS Code.");
      return null;
    }
  }

  return { handleClick };
}

function defaultRequestId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const vscode = require("vscode");

const { getPushViewHtml } = require("./pushViewHtml");

// Sidebar provider for the "Push to LeetCode" webview. Delegates all real work to
// callbacks wired up in extension.js (getPushTarget / pushActiveFile / resetActiveFile).
class PushViewProvider {
  constructor({ getPushTarget, pushActiveFile, resetActiveFile }) {
    this.getPushTarget = getPushTarget;
    this.pushActiveFile = pushActiveFile;
    this.resetActiveFile = resetActiveFile;
    this.view = null;
    this.currentAction = "none";
    this.currentCodeOnly = true;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = getPushViewHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message) {
        return;
      }
      switch (message.type) {
        case "ready":
          this.refresh();
          break;
        case "prefs":
          this.currentAction = message.submitAction || "none";
          this.currentCodeOnly = Boolean(message.codeOnly);
          break;
        case "push":
          this.currentAction = message.submitAction || "none";
          this.currentCodeOnly = Boolean(message.codeOnly);
          await this.push(this.currentAction, this.currentCodeOnly);
          break;
        case "reset":
          await this.reset();
          break;
        default:
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.view = null;
    });

    this.refresh();
  }

  refresh() {
    if (!this.view) {
      return;
    }
    this.view.webview.postMessage({ type: "target", target: this.getPushTarget() });
  }

  // Reveal the sidebar view (used by the auto-open flag). Preserves editor focus.
  reveal() {
    if (this.view) {
      try {
        this.view.show(true);
        return;
      } catch {
        // fall through to the focus command
      }
    }
    vscode.commands.executeCommand("leetcodeGenerator.pushView.focus");
  }

  setStatus(status, state) {
    this.view?.webview.postMessage({ type: "status", status, state });
  }

  async push(submitAction, codeOnly) {
    this.setStatus("Pushing to LeetCode...", "busy");
    const onProgress = (stage) => {
      if (stage === "opening") {
        this.setStatus("Opening the problem in a new tab...", "busy");
      } else if (stage === "judging") {
        this.setStatus("Submitted — waiting for the verdict...", "busy");
      }
    };
    try {
      const result = await this.pushActiveFile(submitAction, codeOnly, onProgress);
      const parts = [];
      if (result?.note) {
        parts.push(result.note);
      }
      parts.push(result?.message || "Code pushed to LeetCode.");
      const state = result?.verdict && !/accepted/i.test(result.verdict) ? "warn" : "ok";
      this.setStatus(parts.join(" "), state);
    } catch (error) {
      this.setStatus(error.message, "error");
    }
  }

  async reset() {
    this.setStatus("Resetting...", "busy");
    try {
      const result = await this.resetActiveFile();
      if (result?.cancelled) {
        this.setStatus("Reset cancelled.", "");
      } else {
        this.setStatus("File reset to the generated template.", "ok");
      }
    } catch (error) {
      this.setStatus(error.message, "error");
    }
  }
}

module.exports = { PushViewProvider };

// Reverse-push job queue + long-poll state, extracted from the HTTP server for clarity.
//
// A "push job" is created when VS Code wants code pasted into LeetCode. The Chrome
// background worker long-polls handlePull() and reports back through handleResult().
//
// Single-tab model (the browser focuses/opens exactly one matching tab):
//   - result.opening === true  -> the browser is opening a fresh tab; extend the wait.
//   - result.ok === true       -> settle (resolve) with a success message.
//   - result.ok === false      -> settle (reject) with the reported error.
//   - window elapses            -> reject ("No response from the browser...").

const PULL_HOLD_MS = 25000; // how long a GET /pull is held open when nothing is queued
const PUSH_WINDOW_MS = 20000; // default job TTL when a matching tab is already open
const OPENING_WINDOW_MS = 60000; // extended TTL once the browser reports it is opening a tab
const VERDICT_WINDOW_MS = 45000; // extended TTL while waiting for a Submit verdict

function createPushQueue() {
  let nextJobId = 1;
  const jobs = new Map(); // id -> { id, resolve, reject, settled, timer }
  let waiter = null; // a single held GET /pull: { send, timer }
  let pending = null; // push queued while no /pull is waiting

  function pushCode({ url, code, submitAction, onProgress }) {
    const id = nextJobId++;
    const push = { id, url, code, submitAction: submitAction || "none" };
    return new Promise((resolve, reject) => {
      const job = {
        id,
        resolve,
        reject,
        settled: false,
        onProgress: typeof onProgress === "function" ? onProgress : null,
      };
      job.timer = setTimeout(() => onTimeout(job), PUSH_WINDOW_MS);
      jobs.set(id, job);
      deliver(push);
    });
  }

  function deliver(push) {
    if (waiter) {
      const current = waiter;
      waiter = null;
      clearTimeout(current.timer);
      try {
        current.send({ ok: true, push });
        return;
      } catch {
        // waiter died; fall through to queue it
      }
    }
    pending = push;
  }

  // `send` writes a JSON body to the held response; `onClose` registers a cleanup cb.
  function handlePull(send, onClose) {
    if (pending) {
      const push = pending;
      pending = null;
      send({ ok: true, push });
      return;
    }

    if (waiter) {
      clearTimeout(waiter.timer);
      try {
        waiter.send({ ok: true, push: null });
      } catch {
        // ignore
      }
      waiter = null;
    }

    const current = { send };
    current.timer = setTimeout(() => {
      if (waiter === current) {
        waiter = null;
      }
      try {
        send({ ok: true, push: null });
      } catch {
        // ignore
      }
    }, PULL_HOLD_MS);

    onClose(() => {
      if (waiter === current) {
        waiter = null;
        clearTimeout(current.timer);
      }
    });

    waiter = current;
  }

  function handleResult(result) {
    if (!result || typeof result.id !== "number") {
      return;
    }
    const job = jobs.get(result.id);
    if (!job || job.settled) {
      return;
    }

    // The browser is opening a fresh tab; loading can be slow, so extend the window
    // and let the caller show an "opening tab..." indicator.
    if (result.opening) {
      clearTimeout(job.timer);
      job.timer = setTimeout(() => onTimeout(job), OPENING_WINDOW_MS);
      if (job.onProgress) {
        job.onProgress("opening");
      }
      return;
    }

    // A Submit was clicked and the browser is now waiting for the judge; extend the
    // window and let the caller show a "waiting for verdict..." indicator.
    if (result.judging) {
      clearTimeout(job.timer);
      job.timer = setTimeout(() => onTimeout(job), VERDICT_WINDOW_MS);
      if (job.onProgress) {
        job.onProgress("judging");
      }
      return;
    }

    if (result.ok === true) {
      settle(job, () => job.resolve({ ok: true, message: successMessage(result), ...result }));
      return;
    }

    settle(job, () => job.reject(new Error(result.error || "The push failed in the browser.")));
  }

  function onTimeout(job) {
    settle(job, () =>
      job.reject(new Error("No response from the browser. Is the Chrome extension installed and running?"))
    );
  }

  function settle(job, run) {
    if (job.settled) {
      return;
    }
    job.settled = true;
    clearTimeout(job.timer);
    jobs.delete(job.id);
    run();
  }

  function successMessage(result) {
    if (result.action === "submit") {
      if (!result.submitted) {
        return "Code pushed, but the Submit button was not found.";
      }
      if (result.verdict) {
        return `Submitted — ${result.verdict}.`;
      }
      return "Code pushed and Submit clicked (verdict not detected).";
    }
    if (result.action === "run") {
      if (!result.submitted) {
        return "Code pushed, but the Run button was not found.";
      }
      if (result.verdict) {
        return `Run — ${result.verdict}.`;
      }
      return "Code pushed and Run clicked (verdict not detected).";
    }
    return "Code pushed to LeetCode.";
  }

  function stop() {
    for (const job of jobs.values()) {
      if (!job.settled) {
        job.settled = true;
        clearTimeout(job.timer);
        job.reject(new Error("Browser bridge stopped before the push completed."));
      }
    }
    jobs.clear();

    if (waiter) {
      clearTimeout(waiter.timer);
      try {
        waiter.send({ ok: true, push: null });
      } catch {
        // ignore
      }
      waiter = null;
    }
    pending = null;
  }

  return { pushCode, handlePull, handleResult, stop };
}

module.exports = { createPushQueue };

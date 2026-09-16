// Reverse-push job queue + long-poll state, extracted from the HTTP server for clarity.
//
// A "push job" is created when VS Code wants code pasted into LeetCode. The Chrome
// background worker long-polls handlePull() and reports back through handleResult().
//
// Single-tab model (the browser focuses/opens exactly one matching tab):
//   - result.received === true -> acknowledge transport receipt; do not redeliver.
//   - result.opening === true  -> the browser is opening a fresh tab; extend the wait.
//   - result.ok === true       -> settle (resolve) with a success message.
//   - result.ok === false      -> settle (reject) with the reported error.
//   - window elapses            -> reject ("No response from the browser...").

const PULL_HOLD_MS = 25000; // how long a GET /pull is held open when nothing is queued
const PUSH_WINDOW_MS = 20000; // default job TTL when a matching tab is already open
const RECEIVED_WINDOW_MS = 30000; // browser acknowledged receipt and is beginning work
const OPENING_WINDOW_MS = 60000; // extended TTL once the browser reports it is opening a tab
const VERDICT_WINDOW_MS = 45000; // extended TTL while waiting for a Submit verdict
const DELIVERY_ACK_MS = 1500; // redeliver if Chrome never acknowledges receipt

function createPushQueue({
  pullHoldMs = PULL_HOLD_MS,
  pushWindowMs = PUSH_WINDOW_MS,
  receivedWindowMs = RECEIVED_WINDOW_MS,
  openingWindowMs = OPENING_WINDOW_MS,
  verdictWindowMs = VERDICT_WINDOW_MS,
  deliveryAckMs = DELIVERY_ACK_MS,
  now = () => Date.now(),
} = {}) {
  let nextJobId = 1;
  const jobs = new Map(); // id -> job state retained until a final browser result
  let waiter = null; // a single held GET /pull: { send, timer }
  const pending = []; // job IDs queued while no /pull is waiting
  const activity = {
    lastEnqueuedAt: null,
    lastDeliveredAt: null,
    lastAcknowledgedAt: null,
    lastSettledAt: null,
  };

  function pushCode({ url, code, language, submitAction, onProgress }) {
    const id = nextJobId++;
    const push = { id, url, code, language: language || null, submitAction: submitAction || "none" };
    return new Promise((resolve, reject) => {
      const job = {
        id,
        push,
        resolve,
        reject,
        settled: false,
        queued: false,
        acknowledged: false,
        deliveryTimer: null,
        onProgress: typeof onProgress === "function" ? onProgress : null,
      };
      job.timer = setTimeout(() => onTimeout(job), pushWindowMs);
      jobs.set(id, job);
      enqueue(job);
    });
  }

  function enqueue(job) {
    if (job.settled || job.acknowledged || job.queued) {
      return;
    }
    job.queued = true;
    pending.push(job.id);
    activity.lastEnqueuedAt = now();
    deliverNext();
  }

  function deliverNext() {
    if (!waiter) {
      return;
    }

    let job = null;
    while (pending.length && !job) {
      const candidate = jobs.get(pending.shift());
      if (candidate && !candidate.settled && !candidate.acknowledged) {
        candidate.queued = false;
        job = candidate;
      }
    }
    if (!job) {
      return;
    }

    const current = waiter;
    waiter = null;
    clearTimeout(current.timer);

    let sent = false;
    try {
      sent = current.send({ ok: true, push: job.push }) !== false;
    } catch {
      sent = false;
    }

    if (!sent) {
      enqueue(job);
      return;
    }

    activity.lastDeliveredAt = now();

    clearTimeout(job.deliveryTimer);
    job.deliveryTimer = setTimeout(() => {
      job.deliveryTimer = null;
      if (!job.settled && !job.acknowledged) {
        enqueue(job);
      }
    }, deliveryAckMs);
    job.deliveryTimer.unref?.();
  }

  // `send` writes a JSON body to the held response; `onClose` tracks the response,
  // not the already-consumed incoming request.
  function handlePull(send, onClose) {
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
    }, pullHoldMs);
    current.timer.unref?.();

    onClose(() => {
      if (waiter === current) {
        waiter = null;
        clearTimeout(current.timer);
      }
    });

    waiter = current;
    deliverNext();
  }

  function handleResult(result) {
    if (!result || typeof result.id !== "number") {
      return;
    }
    const job = jobs.get(result.id);
    if (!job || job.settled) {
      return;
    }

    acknowledge(job);

    // Receipt is a transport acknowledgement, not the final page-operation result.
    // It prevents a job from being lost if the original long-poll response was
    // ambiguous, while allowing the existing push workflow to continue unchanged.
    if (result.received) {
      resetJobTimer(job, receivedWindowMs);
      if (job.onProgress) {
        job.onProgress("received");
      }
      return;
    }

    // The browser is opening a fresh tab; loading can be slow, so extend the window
    // and let the caller show an "opening tab..." indicator.
    if (result.opening) {
      resetJobTimer(job, openingWindowMs);
      if (job.onProgress) {
        job.onProgress("opening");
      }
      return;
    }

    // A Submit was clicked and the browser is now waiting for the judge; extend the
    // window and let the caller show a "waiting for verdict..." indicator.
    if (result.judging) {
      resetJobTimer(job, verdictWindowMs);
      if (job.onProgress) {
        job.onProgress("judging");
      }
      return;
    }

    if (result.ok === true) {
      settle(job, () => job.resolve({ ok: true, message: successMessage(result), ...result }));
      return;
    }

    settle(job, () => {
      const error = new Error(result.error || "The push failed in the browser.");
      error.code = result.code || "browser_push_failed";
      error.retryable = Boolean(result.retryable);
      error.expectedLanguage = result.expectedLanguage || null;
      error.actualLanguage = result.actualLanguage || null;
      job.reject(error);
    });
  }

  function acknowledge(job) {
    job.acknowledged = true;
    job.queued = false;
    clearTimeout(job.deliveryTimer);
    job.deliveryTimer = null;
    activity.lastAcknowledgedAt = now();
  }

  function resetJobTimer(job, timeoutMs) {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => onTimeout(job), timeoutMs);
    job.timer.unref?.();
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
    clearTimeout(job.deliveryTimer);
    jobs.delete(job.id);
    activity.lastSettledAt = now();
    run();
  }

  function successMessage(result) {
    if (result.action === "submit") {
      if (!result.submitted) {
        return result.actionError || "Code pushed, but the Submit button was not found.";
      }
      if (result.verdict) {
        return `Submitted — ${result.verdict}.`;
      }
      return "Code pushed and Submit clicked (verdict not detected).";
    }
    if (result.action === "run") {
      if (!result.submitted) {
        return result.actionError || "Code pushed, but the Run button was not found.";
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
        clearTimeout(job.deliveryTimer);
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
    pending.length = 0;
  }

  function getStats() {
    let acknowledgedJobs = 0;
    for (const job of jobs.values()) {
      if (job.acknowledged) {
        acknowledgedJobs += 1;
      }
    }
    const pendingJobs = pending.reduce((count, id) => {
      const job = jobs.get(id);
      return count + Number(Boolean(job && !job.settled && !job.acknowledged));
    }, 0);
    return {
      activeJobs: jobs.size,
      pendingJobs,
      acknowledgedJobs,
      browserWaiting: Boolean(waiter),
      ...activity,
    };
  }

  return { pushCode, handlePull, handleResult, stop, getStats };
}

module.exports = { createPushQueue };

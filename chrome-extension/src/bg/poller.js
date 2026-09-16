// Long-poll loop: fetch GET /pull forever. Both poll failures and unexpected push
// handler failures are contained so one transient error cannot kill the worker loop.
import { pull } from "../http.js";
import { handlePush } from "./pusher.js";

const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 5000];

export async function pollLoop({
  pullFn = pull,
  handlePushFn = handlePush,
  sleepFn = sleep,
  signal = null,
} = {}) {
  let consecutiveFailures = 0;

  while (!signal?.aborted) {
    let payload;
    try {
      payload = await pullFn();
      consecutiveFailures = 0;
    } catch {
      await sleepFn(retryDelay(consecutiveFailures++));
      continue;
    }

    if (payload && payload.ok && payload.push) {
      try {
        await handlePushFn(payload.push);
      } catch {
        consecutiveFailures += 1;
        await sleepFn(retryDelay(consecutiveFailures - 1));
      }
    }
  }
}

function retryDelay(failureIndex) {
  return RETRY_DELAYS_MS[Math.min(failureIndex, RETRY_DELAYS_MS.length - 1)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

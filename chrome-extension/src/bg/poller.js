// Long-poll loop: fetch GET /pull forever; on network error wait and retry.
import { pull } from "../http.js";
import { handlePush } from "./pusher.js";

const RETRY_DELAY_MS = 5000;

export async function pollLoop() {
  for (;;) {
    let payload;
    try {
      payload = await pull();
    } catch {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    if (payload && payload.ok && payload.push) {
      await handlePush(payload.push);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

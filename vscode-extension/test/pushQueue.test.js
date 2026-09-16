const test = require("node:test");
const assert = require("node:assert/strict");

const { createPushQueue } = require("../src/pushQueue");

function pullOnce(queue) {
  return new Promise((resolve, reject) => {
    // A real long-poll socket keeps the extension host alive. This test has no
    // socket, while the queue intentionally unrefs its hold timer, so retain a
    // guard timer until the simulated pull completes.
    const guard = setTimeout(() => {
      reject(new Error("Timed out waiting for the simulated browser pull."));
    }, 1000);

    queue.handlePull(
      (payload) => {
        clearTimeout(guard);
        resolve(payload);
        return true;
      },
      () => {}
    );
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("an unacknowledged delivery is offered again", async (t) => {
  const queue = createPushQueue({ pullHoldMs: 100, pushWindowMs: 500, deliveryAckMs: 15 });
  t.after(() => queue.stop());

  const firstPull = pullOnce(queue);
  const result = queue.pushCode({ url: "https://leetcode.com/problems/two-sum/", code: "code" });
  const first = await firstPull;

  await wait(25);
  const second = await pullOnce(queue);
  assert.equal(second.push.id, first.push.id);

  queue.handleResult({ id: first.push.id, received: true });
  queue.handleResult({ id: first.push.id, ok: true });
  await result;
});

test("receipt acknowledgement prevents redelivery", async (t) => {
  const queue = createPushQueue({
    pullHoldMs: 20,
    pushWindowMs: 500,
    receivedWindowMs: 500,
    deliveryAckMs: 10,
  });
  t.after(() => queue.stop());

  const firstPull = pullOnce(queue);
  const result = queue.pushCode({ url: "https://leetcode.com/problems/two-sum/", code: "code" });
  const first = await firstPull;
  queue.handleResult({ id: first.push.id, received: true });

  await wait(20);
  const next = await pullOnce(queue);
  assert.equal(next.push, null);

  queue.handleResult({ id: first.push.id, ok: true });
  await result;
});

test("multiple pending pushes are preserved in order", async (t) => {
  const queue = createPushQueue({ pullHoldMs: 100, pushWindowMs: 500, deliveryAckMs: 50 });
  t.after(() => queue.stop());

  const firstResult = queue.pushCode({ url: "https://leetcode.com/problems/one/", code: "one" });
  const secondResult = queue.pushCode({ url: "https://leetcode.com/problems/two/", code: "two" });

  const first = await pullOnce(queue);
  queue.handleResult({ id: first.push.id, received: true });
  queue.handleResult({ id: first.push.id, ok: true });

  const second = await pullOnce(queue);
  queue.handleResult({ id: second.push.id, received: true });
  queue.handleResult({ id: second.push.id, ok: true });

  assert.equal(first.push.code, "one");
  assert.equal(second.push.code, "two");
  await Promise.all([firstResult, secondResult]);
});

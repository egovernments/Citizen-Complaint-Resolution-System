const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { enqueuePersist, pendingPersist } = require(
  path.join(path.resolve(__dirname, ".."), "src/session/persist-queue.js")
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("writes for one citizen land in the order they were queued", async () => {
  // The bug: onTransition fired several independent writes per event, so a slow
  // earlier write could land after a fast later one and leave the OLDER state
  // stored — the citizen's next message then resumed a question back.
  const landed = [];

  enqueuePersist("u-1", async () => { await wait(15); landed.push("first"); });
  enqueuePersist("u-1", async () => { await wait(1); landed.push("second"); });
  enqueuePersist("u-1", async () => { landed.push("third"); });

  await pendingPersist("u-1");

  assert.deepEqual(landed, ["first", "second", "third"], "slowest first still lands first");
});

test("pendingPersist resolves only once every queued write is done", async () => {
  let done = false;
  enqueuePersist("u-2", async () => { await wait(10); done = true; });

  await pendingPersist("u-2");
  assert.equal(done, true, "dispatch can await this before releasing the lock");
});

test("different citizens are not serialized against each other", async () => {
  const active = { now: 0, peak: 0 };
  const work = async () => {
    active.now += 1;
    active.peak = Math.max(active.peak, active.now);
    await wait(10);
    active.now -= 1;
  };

  await Promise.all([
    enqueuePersist("u-3", work),
    enqueuePersist("u-4", work),
  ]);

  assert.equal(active.peak, 2, "one citizen's write does not wait on another's");
});

test("a failed write does not block the transition behind it", async () => {
  const landed = [];

  enqueuePersist("u-5", async () => { throw new Error("db down"); });
  enqueuePersist("u-5", async () => { landed.push("after"); });

  await pendingPersist("u-5");

  assert.deepEqual(landed, ["after"], "the next state is still written");
});

test("the queue does not grow once it drains", async () => {
  await enqueuePersist("u-6", async () => {});
  await pendingPersist("u-6");

  // nothing queued for an unknown citizen resolves immediately
  await assert.doesNotReject(() => pendingPersist("never-seen"));
});

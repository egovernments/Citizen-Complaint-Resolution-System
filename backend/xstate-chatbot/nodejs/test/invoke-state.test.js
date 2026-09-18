const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.DISPATCH_SETTLE_TIMEOUT_MS = "80";

const projectRoot = path.resolve(__dirname, "..");
const { Machine, interpret, State } = require(path.join(projectRoot, "node_modules/xstate"));
const { hasActiveInvoke, waitUntilSettled } = require(path.join(projectRoot, "src/session/invoke-state.js"));

/** Stands in for pgr-machine's confirm -> persistComplaint -> receipt shape. */
function probeMachine({ runs, hang = false, delay = 20 }) {
  return Machine({
    id: "probe",
    initial: "confirm",
    states: {
      confirm: { on: { GO: "submitting" } },
      submitting: {
        invoke: {
          src: () =>
            new Promise((resolve) => {
              runs.count += 1;
              if (!hang) setTimeout(() => resolve("ok"), delay);
            }),
          onDone: "receipt",
        },
      },
      receipt: { on: { GO: "submitting" } },
    },
  });
}

test("an invoke-active state is recognized, a settled one is not", () => {
  const runs = { count: 0 };
  const service = interpret(probeMachine({ runs })).start();
  assert.equal(hasActiveInvoke(service.state), false, "confirm has no invocation");
  service.send("GO");
  assert.equal(hasActiveInvoke(service.state), true, "submitting has one in flight");
});

test("restoring an invoke-active state re-runs the service — the duplicate-complaint mechanism", async () => {
  const runs = { count: 0 };
  const machine = probeMachine({ runs });
  const service = interpret(machine).start();
  service.send("GO");
  const snapshot = JSON.parse(JSON.stringify(service.state));
  assert.equal(runs.count, 1);

  interpret(machine).start(State.create(snapshot));
  assert.equal(runs.count, 2, "this is why invoke-active states must never be persisted");
});

test("waitUntilSettled resolves only after the invocation completes", async () => {
  const runs = { count: 0 };
  const service = interpret(probeMachine({ runs, delay: 30 })).start();
  service.send("GO");

  let settled = false;
  const pending = waitUntilSettled(service).then(() => {
    settled = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(settled, false, "must still be holding the dispatch lock");

  await pending;
  assert.equal(settled, true);
  assert.equal(service.state.value, "receipt");
});

test("waitUntilSettled returns immediately when nothing is in flight", async () => {
  const runs = { count: 0 };
  const service = interpret(probeMachine({ runs })).start();
  await waitUntilSettled(service);
  assert.equal(service.state.value, "confirm");
});

test("a hung invocation releases the lock via the timeout", async () => {
  const runs = { count: 0 };
  const service = interpret(probeMachine({ runs, hang: true })).start();
  service.send("GO");

  const started = Date.now();
  await waitUntilSettled(service);
  const waited = Date.now() - started;

  assert.ok(waited >= 70, `released after ~timeout, waited ${waited}ms`);
  assert.equal(hasActiveInvoke(service.state), true, "the invocation is still pending; we gave up waiting");
});

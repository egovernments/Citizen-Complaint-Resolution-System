// #224 follow-up: a warning before the idle sign-out. Same harness style as
// idleTimer.test.js: injected clock, events and intervals, so every case runs
// instantly.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/libraries/src/services/atoms/Utils/idleTimer.js");
const { outputFiles } = esbuild.buildSync({ entryPoints: [SRC], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018" });
const mod = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports });
const { startIdleTimer, idleWarningMs, DEFAULT_EMPLOYEE_IDLE_WARNING_SECONDS, storageActivityStore } = mod.exports;

const SEC = 1000;
const MIN = 60 * SEC;

const memStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

/** Fake window + clock + several intervals, driven by hand. */
function harness(timeoutMs, warnBeforeMs, { shared = null, start = 1_000_000, clock = null } = {}) {
  const c = clock || { t: start };
  const listeners = new Map();
  const target = {
    addEventListener: (e, fn) => listeners.set(e, [...(listeners.get(e) || []), fn]),
    removeEventListener: (e, fn) => listeners.set(e, (listeners.get(e) || []).filter((f) => f !== fn)),
  };
  const intervals = new Map(); // id -> { fn, ms }
  let nextId = 1;
  const calls = { idle: 0, warn: [], active: 0 };
  const stop = startIdleTimer({
    timeoutMs,
    warnBeforeMs,
    onIdle: () => (calls.idle += 1),
    onWarn: (at) => calls.warn.push(at),
    onActive: () => (calls.active += 1),
    target,
    doc: target,
    now: () => c.t,
    setInterval: (fn, ms) => {
      const id = nextId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
    shared,
  });
  const tickAll = () => [...intervals.values()].forEach(({ fn }) => fn());
  return {
    clock: c,
    calls,
    stop,
    // Advance in 1-second steps so each running interval gets its chance, as in a browser.
    advance: (ms) => {
      for (let done = 0; done < ms; done += SEC) {
        c.t += Math.min(SEC, ms - done);
        tickAll();
      }
    },
    fire: (e) => (listeners.get(e) || []).forEach((fn) => fn()),
    fastIntervals: () => [...intervals.values()].filter((i) => i.ms === SEC).length,
    intervalCount: () => intervals.size,
  };
}

test("warning time: default 60 s, configurable, 0 turns it off, always shorter than the limit", () => {
  assert.strictEqual(DEFAULT_EMPLOYEE_IDLE_WARNING_SECONDS, 60);
  assert.strictEqual(idleWarningMs(undefined, 15 * MIN), 60 * SEC);
  assert.strictEqual(idleWarningMs("", 15 * MIN), 60 * SEC);
  assert.strictEqual(idleWarningMs("nonsense", 15 * MIN), 60 * SEC);
  assert.strictEqual(idleWarningMs(120, 15 * MIN), 120 * SEC);
  assert.strictEqual(idleWarningMs("30", 15 * MIN), 30 * SEC);
  assert.strictEqual(idleWarningMs(0, 15 * MIN), 0);
  assert.strictEqual(idleWarningMs(-5, 15 * MIN), 0);
  assert.strictEqual(idleWarningMs(600, 2 * MIN), 1 * MIN, "capped at half the limit");
  assert.strictEqual(idleWarningMs(60, 0), 0, "no limit, no warning");
});

test("warns once, a minute before the sign-out, with the sign-out time", () => {
  const h = harness(15 * MIN, 60 * SEC);
  h.advance(13 * MIN + 59 * SEC);
  assert.strictEqual(h.calls.warn.length, 0, "not before the warning window");
  h.advance(15 * SEC); // the 15 s check lands inside the window
  assert.strictEqual(h.calls.warn.length, 1);
  assert.strictEqual(h.calls.warn[0], 1_000_000 + 15 * MIN, "reports when the sign-out will happen");
  h.advance(30 * SEC);
  assert.strictEqual(h.calls.warn.length, 1, "never twice");
  assert.strictEqual(h.calls.idle, 0);
});

test("during the warning the clock is checked every second, so the sign-out is on time", () => {
  const h = harness(15 * MIN, 60 * SEC);
  h.advance(14 * MIN + 1 * SEC);
  assert.strictEqual(h.fastIntervals(), 1, "1-second checks while warning");
  h.advance(58 * SEC);
  assert.strictEqual(h.calls.idle, 0);
  h.advance(1 * SEC); // exactly 15:00
  assert.strictEqual(h.calls.idle, 1, "signed out at the limit, not up to 15 s later");
  assert.strictEqual(h.intervalCount(), 0, "every interval stopped after sign-out");
});

test("moving the mouse while the warning is up does not keep the session (the dialog stays usable)", () => {
  const h = harness(15 * MIN, 60 * SEC);
  h.advance(14 * MIN + 15 * SEC);
  assert.strictEqual(h.calls.warn.length, 1);
  h.fire("mousemove");
  h.fire("mousedown");
  assert.strictEqual(h.calls.active, 0, "warning still up");
  h.advance(45 * SEC);
  assert.strictEqual(h.calls.idle, 1, "signed out at the limit");
});

test("keepAlive (Stay signed in) ends the warning and restarts the full limit", () => {
  const h = harness(15 * MIN, 60 * SEC);
  h.advance(14 * MIN + 30 * SEC);
  assert.strictEqual(h.calls.warn.length, 1);
  h.stop.keepAlive();
  assert.strictEqual(h.calls.active, 1, "warning ended");
  assert.strictEqual(h.fastIntervals(), 0, "back to the normal check");
  h.advance(13 * MIN);
  assert.strictEqual(h.calls.idle, 0, "a fresh 15 minutes");
  h.advance(2 * MIN);
  assert.strictEqual(h.calls.warn.length, 2, "warns again before the next limit");
  h.advance(2 * MIN);
  assert.strictEqual(h.calls.idle, 1);
});

test("keepAlive after the limit has passed signs out instead", () => {
  const h = harness(15 * MIN, 60 * SEC);
  h.clock.t += 16 * MIN; // tab asleep, no checks ran
  h.stop.keepAlive();
  assert.strictEqual(h.calls.idle, 1);
});

test("Stay signed in in one tab closes the warning in the other tab", () => {
  const local = memStore();
  const clock = { t: 1_000_000 };
  const a = harness(15 * MIN, 60 * SEC, { shared: storageActivityStore(local), clock });
  const b = harness(15 * MIN, 60 * SEC, { shared: storageActivityStore(local), clock });
  // Both tabs idle into the warning window (one clock, both tabs tick).
  for (let i = 0; i < 14 * 60 + 15; i += 1) {
    clock.t += SEC;
    a.advance(0);
    b.advance(0);
    if (i % 15 === 0) {
      a.fire("focus");
      b.fire("focus");
    }
  }
  assert.strictEqual(a.calls.warn.length, 1);
  assert.strictEqual(b.calls.warn.length, 1);
  a.stop.keepAlive();
  b.fire("focus"); // b's next check reads the shared clock
  assert.strictEqual(b.calls.active, 1, "other tab's warning closed");
  assert.strictEqual(b.calls.idle, 0);
});

test("working in another tab ends this tab's warning", () => {
  const local = memStore();
  const h = harness(15 * MIN, 60 * SEC, { shared: storageActivityStore(local) });
  h.advance(14 * MIN + 15 * SEC);
  assert.strictEqual(h.calls.warn.length, 1);
  storageActivityStore(local).write(h.clock.t); // the employee is busy in another tab
  h.advance(1 * SEC);
  assert.strictEqual(h.calls.active, 1);
  assert.strictEqual(h.calls.idle, 0);
});

test("a tab restored inside the warning window warns straight away", () => {
  const start = 1_000_000;
  const local = memStore({ "Digit.EmployeeLastActivity": String(start - 14 * MIN - 30 * SEC) });
  const h = harness(15 * MIN, 60 * SEC, { shared: storageActivityStore(local), start });
  assert.strictEqual(h.calls.warn.length, 1);
  assert.strictEqual(h.calls.warn[0], start + 30 * SEC);
});

test("no warning configured: behaves exactly as before, mouse moves keep the session", () => {
  const h = harness(15 * MIN, 0);
  h.advance(14 * MIN);
  h.fire("mousemove");
  h.advance(14 * MIN);
  assert.strictEqual(h.calls.warn.length, 0);
  assert.strictEqual(h.calls.idle, 0);
  assert.strictEqual(typeof h.stop.keepAlive, "function");
});

test("an idle limit of 0 returns a stop that also has keepAlive", () => {
  const stop = startIdleTimer({ timeoutMs: 0, onIdle: () => {}, target: {} });
  assert.strictEqual(typeof stop, "function");
  assert.doesNotThrow(() => stop.keepAlive());
});

test("the warning time is a deploy setting in globalConfigs (bundled, ansible and Helm)", () => {
  const fs = require("node:fs");
  for (const f of ["public/globalConfigs.js", "../local-setup/ansible/templates/globalConfigs.js.j2", "../devops/deploy-as-code/charts/urban/digit-ui/files/globalConfigs.js.tpl"]) {
    assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /EMPLOYEE_IDLE_WARNING_SECONDS/, f);
  }
  assert.match(fs.readFileSync(path.join(ROOT, "../devops/deploy-as-code/charts/urban/digit-ui/values.yaml"), "utf8"), /employeeIdleWarningSeconds: 60/);
});

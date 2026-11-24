// #224 follow-up: logging out in one tab signs the employee out of the others.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/libraries/src/services/atoms/Utils/employeeSignOutBroadcast.js");
const { outputFiles } = esbuild.buildSync({ entryPoints: [SRC], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018" });

/** Loads the module fresh, as one browser tab. `bus` links the BroadcastChannels of all tabs. */
function tab(bus, name) {
  const mod = { exports: {} };
  vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports, Date, Math, JSON, Set });
  mod.exports.setTabIdForTest(name);
  return mod.exports;
}

/** A BroadcastChannel stand-in: delivers to every other channel object on the bus. */
function makeBus() {
  const channels = new Set();
  const make = () => {
    const listeners = new Set();
    const ch = {
      postMessage: (data) => channels.forEach((other) => other !== ch && other._deliver(data)),
      addEventListener: (_e, fn) => listeners.add(fn),
      removeEventListener: (_e, fn) => listeners.delete(fn),
      close: () => channels.delete(ch),
      _deliver: (data) => listeners.forEach((fn) => fn({ data })),
    };
    channels.add(ch);
    return ch;
  };
  return { make };
}

/** A window stand-in for storage events. */
function makeWindow() {
  const listeners = new Set();
  return {
    addEventListener: (_e, fn) => listeners.add(fn),
    removeEventListener: (_e, fn) => listeners.delete(fn),
    dispatchStorage: (key, newValue) => listeners.forEach((fn) => fn({ key, newValue })),
    count: () => listeners.size,
  };
}

const memLocal = () => {
  const m = new Map();
  return { setItem: (k, v) => m.set(k, String(v)), getItem: (k) => (m.has(k) ? m.get(k) : null), m };
};

test("another tab hears the sign-out over BroadcastChannel", () => {
  const bus = makeBus();
  const a = tab(bus, "tab-a");
  const b = tab(bus, "tab-b");
  let heard = 0;
  b.onEmployeeSignOut(() => (heard += 1), { channel: bus.make(), target: makeWindow() });
  a.announceEmployeeSignOut({ channel: bus.make(), local: memLocal(), now: 1 });
  assert.strictEqual(heard, 1);
});

test("the tab that signs out ignores its own announcement", () => {
  const bus = makeBus();
  const a = tab(bus, "tab-a");
  let heard = 0;
  a.onEmployeeSignOut(() => (heard += 1), { channel: bus.make(), target: makeWindow() });
  a.announceEmployeeSignOut({ channel: bus.make(), local: memLocal(), now: 1 });
  assert.strictEqual(heard, 0);
});

test("without BroadcastChannel the storage event carries it", () => {
  const a = tab(null, "tab-a");
  const b = tab(null, "tab-b");
  const local = memLocal();
  const win = makeWindow();
  let heard = 0;
  b.onEmployeeSignOut(() => (heard += 1), { channel: null, target: win });
  a.announceEmployeeSignOut({ channel: null, local, now: 7 });
  const stored = local.getItem(b.SIGN_OUT_KEY);
  assert.ok(stored, "announcement written");
  assert.ok(!/token/i.test(stored), "no credential in the announcement");
  win.dispatchStorage(b.SIGN_OUT_KEY, stored); // what the browser does in the other tab
  assert.strictEqual(heard, 1);
});

test("a message arriving on both channels is handled once", () => {
  const bus = makeBus();
  const a = tab(bus, "tab-a");
  const b = tab(bus, "tab-b");
  const local = memLocal();
  const win = makeWindow();
  let heard = 0;
  b.onEmployeeSignOut(() => (heard += 1), { channel: bus.make(), target: win });
  a.announceEmployeeSignOut({ channel: bus.make(), local, now: 42 });
  win.dispatchStorage(b.SIGN_OUT_KEY, local.getItem(b.SIGN_OUT_KEY));
  assert.strictEqual(heard, 1);
});

test("unrelated storage changes and the logout's localStorage.clear() are ignored", () => {
  const b = tab(null, "tab-b");
  const win = makeWindow();
  let heard = 0;
  b.onEmployeeSignOut(() => (heard += 1), { channel: null, target: win });
  win.dispatchStorage("Digit.EmployeeLastActivity", "123");
  win.dispatchStorage(null, null); // clear()
  win.dispatchStorage(b.SIGN_OUT_KEY, null); // key removed
  win.dispatchStorage(b.SIGN_OUT_KEY, "not json");
  win.dispatchStorage(b.SIGN_OUT_KEY, JSON.stringify({ type: "something-else", tab: "x", at: 1 }));
  assert.strictEqual(heard, 0);
});

test("unsubscribe removes the listeners", () => {
  const bus = makeBus();
  const a = tab(bus, "tab-a");
  const b = tab(bus, "tab-b");
  const win = makeWindow();
  let heard = 0;
  const off = b.onEmployeeSignOut(() => (heard += 1), { channel: bus.make(), target: win });
  off();
  assert.strictEqual(win.count(), 0);
  a.announceEmployeeSignOut({ channel: bus.make(), local: memLocal(), now: 1 });
  assert.strictEqual(heard, 0);
});

test("announcing never throws, even with blocked storage and no channel", () => {
  const a = tab(null, "tab-a");
  const blocked = { setItem: () => { throw new Error("blocked"); } };
  assert.doesNotThrow(() => a.announceEmployeeSignOut({ channel: null, local: blocked }));
  const broken = { postMessage: () => { throw new Error("closed"); } };
  assert.doesNotThrow(() => a.announceEmployeeSignOut({ channel: broken, local: null }));
});

test("only the same employee's tabs sign out; a different employee stays signed in", () => {
  const bus = makeBus();
  const a = tab(bus, "tab-a");
  const sameUser = tab(bus, "tab-b");
  const otherUser = tab(bus, "tab-c");
  let same = 0;
  let other = 0;
  sameUser.onEmployeeSignOut(() => (same += 1), { userId: "uuid-alice", channel: bus.make(), target: makeWindow() });
  otherUser.onEmployeeSignOut(() => (other += 1), { userId: "uuid-bob", channel: bus.make(), target: makeWindow() });
  a.announceEmployeeSignOut({ userId: "uuid-alice", channel: bus.make(), local: memLocal(), now: 5 });
  assert.strictEqual(same, 1, "the same employee's other tab signs out");
  assert.strictEqual(other, 0, "a different employee's tab stays signed in");
});

test("the announcement carries a hash, never the user id itself", () => {
  const a = tab(null, "tab-a");
  const local = memLocal();
  a.announceEmployeeSignOut({ userId: "5c0a1b2e-uuid-of-alice", channel: null, local, now: 9 });
  const stored = local.getItem(a.SIGN_OUT_KEY);
  assert.ok(!stored.includes("5c0a1b2e-uuid-of-alice"));
  assert.ok(JSON.parse(stored).user, "a user hash is present");
  assert.strictEqual(a.userKey("x"), a.userKey("x"), "stable");
  assert.notStrictEqual(a.userKey("uuid-alice"), a.userKey("uuid-bob"));
  assert.strictEqual(a.userKey(""), null);
});

test("an announcement without a user (older build) still signs out every employee tab", () => {
  const bus = makeBus();
  const a = tab(bus, "tab-a");
  const b = tab(bus, "tab-b");
  let heard = 0;
  b.onEmployeeSignOut(() => (heard += 1), { userId: "uuid-bob", channel: bus.make(), target: makeWindow() });
  a.announceEmployeeSignOut({ channel: bus.make(), local: memLocal(), now: 3 });
  assert.strictEqual(heard, 1);
});

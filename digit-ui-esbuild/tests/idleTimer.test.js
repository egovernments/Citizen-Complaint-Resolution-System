// #224: an employee left idle is logged out. The timer is plain logic with an
// injected clock, events and interval, so every case below runs instantly.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/libraries/src/services/atoms/Utils/idleTimer.js");
const { outputFiles } = esbuild.buildSync({ entryPoints: [SRC], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018" });
const mod = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports });
const { startIdleTimer, idleTimeoutMs, DEFAULT_EMPLOYEE_IDLE_MINUTES, ACTIVITY_EVENTS, storageActivityStore, markEmployeeActive, LAST_ACTIVITY_KEY } = mod.exports;

const MIN = 60 * 1000;

/** A fake window/document + clock + interval, driven by hand. `shared` = the cross-tab activity store. */
function harness(timeoutMs, { shared = null, start = 1_000_000 } = {}) {
  let t = start;
  const listeners = new Map();
  const target = {
    addEventListener: (e, fn) => listeners.set(e, [...(listeners.get(e) || []), fn]),
    removeEventListener: (e, fn) => listeners.set(e, (listeners.get(e) || []).filter((f) => f !== fn)),
  };
  let tick = null;
  let cleared = false;
  let idleCalls = 0;
  const stop = startIdleTimer({
    timeoutMs,
    onIdle: () => (idleCalls += 1),
    target,
    doc: target,
    now: () => t,
    setInterval: (fn) => ((tick = fn), 1),
    clearInterval: () => (cleared = true),
    shared,
  });
  return {
    now: () => t,
    advance: (ms) => { t += ms; if (tick && !cleared) tick(); },
    sleep: (ms) => { t += ms; }, // time passes with no interval tick (background tab / laptop asleep)
    fire: (e) => (listeners.get(e) || []).forEach((fn) => fn()),
    listenerCount: () => [...listeners.values()].reduce((n, l) => n + l.length, 0),
    idle: () => idleCalls,
    stopped: () => cleared,
    stop,
  };
}

test("default idle limit is 15 minutes", () => {
  assert.strictEqual(DEFAULT_EMPLOYEE_IDLE_MINUTES, 15);
  assert.strictEqual(idleTimeoutMs(undefined), 15 * MIN);
  assert.strictEqual(idleTimeoutMs(""), 15 * MIN);
  assert.strictEqual(idleTimeoutMs("not a number"), 15 * MIN);
});

test("the limit can be configured, and 0 turns idle logout off", () => {
  assert.strictEqual(idleTimeoutMs(30), 30 * MIN);
  assert.strictEqual(idleTimeoutMs("5"), 5 * MIN);
  assert.strictEqual(idleTimeoutMs(0.5), 30 * 1000);
  assert.strictEqual(idleTimeoutMs(0), 0);
  assert.strictEqual(idleTimeoutMs(-1), 0);
});

test("no activity for the full limit logs the user out once", () => {
  const h = harness(15 * MIN);
  h.advance(14 * MIN);
  assert.strictEqual(h.idle(), 0, "not before the limit");
  h.advance(1 * MIN);
  assert.strictEqual(h.idle(), 1);
  h.advance(10 * MIN);
  assert.strictEqual(h.idle(), 1, "never twice");
  assert.ok(h.stopped(), "the timer stops itself after logging out");
});

test("any activity restarts the countdown", () => {
  const h = harness(15 * MIN);
  for (const e of ACTIVITY_EVENTS) {
    h.advance(10 * MIN);
    h.fire(e);
  }
  h.advance(14 * MIN);
  assert.strictEqual(h.idle(), 0);
  h.advance(1 * MIN);
  assert.strictEqual(h.idle(), 1);
});

test("mouse, keyboard, touch and scroll all count as activity", () => {
  for (const e of ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"]) assert.ok(ACTIVITY_EVENTS.includes(e), e);
});

test("coming back after the limit logs out, even if the first thing the user does is move the mouse", () => {
  const h = harness(15 * MIN);
  h.sleep(2 * 60 * MIN); // tab in the background / laptop closed: no interval ticks
  h.fire("mousemove");
  assert.strictEqual(h.idle(), 1, "activity after the limit must not reset it");
});

test("returning to the tab after the limit logs out immediately", () => {
  const h = harness(15 * MIN);
  h.sleep(20 * MIN);
  h.fire("visibilitychange");
  assert.strictEqual(h.idle(), 1);
});

test("returning to the tab within the limit keeps the session", () => {
  const h = harness(15 * MIN);
  h.sleep(5 * MIN);
  h.fire("visibilitychange");
  h.fire("focus");
  assert.strictEqual(h.idle(), 0);
});

test("a disabled timer (0) does nothing and attaches nothing", () => {
  const h = harness(0);
  h.sleep(10 * 60 * MIN);
  h.fire("mousemove");
  assert.strictEqual(h.idle(), 0);
  assert.strictEqual(h.listenerCount(), 0);
});

test("stopping the timer removes every listener (no leak on unmount)", () => {
  const h = harness(15 * MIN);
  assert.ok(h.listenerCount() > 0);
  h.stop();
  assert.strictEqual(h.listenerCount(), 0);
  assert.ok(h.stopped());
});

/* ---------------- shared last-activity (all of the employee's tabs) ---------------- */

const memStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test("activity in ANOTHER tab keeps this tab signed in", () => {
  const local = memStore();
  const shared = storageActivityStore(local);
  const h = harness(15 * MIN, { shared });
  for (let i = 0; i < 4; i += 1) {
    h.advance(10 * MIN);
    shared.write(h.now()); // the employee is working in a different tab
  }
  assert.strictEqual(h.idle(), 0, "40 minutes in, never 15 idle across tabs");
  h.advance(15 * MIN);
  assert.strictEqual(h.idle(), 1, "no tab active for 15 minutes → logged out");
});

test("a restored tab whose last activity is older than the limit logs out as soon as it loads", () => {
  const start = 10_000_000;
  const local = memStore({ [LAST_ACTIVITY_KEY]: String(start - 20 * MIN) }); // closed 20 minutes ago
  const h = harness(15 * MIN, { shared: storageActivityStore(local), start });
  assert.strictEqual(h.idle(), 1, "no fresh 15 minutes for a restored tab");
});

test("a reload within the limit keeps the session and its remaining time", () => {
  const start = 10_000_000;
  const local = memStore({ [LAST_ACTIVITY_KEY]: String(start - 10 * MIN) });
  const h = harness(15 * MIN, { shared: storageActivityStore(local), start });
  assert.strictEqual(h.idle(), 0);
  h.advance(5 * MIN);
  assert.strictEqual(h.idle(), 1, "the countdown continues from the last activity, not from the reload");
});

test("this tab's activity is published to the other tabs", () => {
  const local = memStore();
  const shared = storageActivityStore(local);
  const h = harness(15 * MIN, { shared });
  assert.ok(shared.read(), "a session with nothing recorded publishes 'active now' at start");
  h.advance(3 * MIN);
  h.fire("keydown");
  assert.strictEqual(shared.read(), h.now());
});

test("markEmployeeActive (called at login) resets the shared clock", () => {
  const local = memStore({ [LAST_ACTIVITY_KEY]: "1" });
  markEmployeeActive(local, 5_000_000);
  assert.strictEqual(local.getItem(LAST_ACTIVITY_KEY), "5000000");
});

test("the shared store never throws on blocked storage", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const s = storageActivityStore(blocked);
  assert.strictEqual(s.read(), null);
  assert.doesNotThrow(() => s.write(1));
});

/* ---------------- wiring ---------------- */

test("IdleLogout is mounted in the app next to SessionCollisionNotice", () => {
  const app = fs.readFileSync(path.join(ROOT, "packages/modules/core/src/App.js"), "utf8");
  assert.match(app, /import IdleLogout from "\.\/components\/IdleLogout"/);
  assert.match(app, /<IdleLogout \/>/);
});

test("IdleLogout: employee pages only, DIGIT login only, shared clock, and a tab-only logout", () => {
  const c = fs.readFileSync(path.join(ROOT, "packages/modules/core/src/components/IdleLogout.js"), "utf8");
  assert.match(c, /EMPLOYEE_IDLE_TIMEOUT_MINUTES/);
  assert.match(c, /"employee"/);
  assert.match(c, /EMPLOYEE/);
  assert.match(c, /isKeycloakAuth\(\)/, "Keycloak mode is skipped");
  assert.match(c, /storageActivityStore\(window\.localStorage\)/, "uses the shared last-activity clock");
  assert.match(c, /Digit\.UserService\.logoutUser\(\)/, "ends the login on the server");
  // The automatic paths (idle, signed out in another tab) end only this tab's
  // login; only the user's own "Sign out now" click may run the full logout,
  // exactly as the Logout button does.
  const automatic = (c.match(/const endThisLogin = async \(reason\) => \{([\s\S]*?)\n\};/) || [])[1];
  assert.ok(automatic, "the automatic sign-out helper exists");
  assert.match(automatic, /redirectToLogin\(reason\)/, "clears only this tab's credentials");
  assert.doesNotMatch(automatic, /UserService\.logout\(\)/, "never the full logout, which runs localStorage.clear()");
  assert.match(c, /onIdle: \(\) => endThisLogin\(/, "idle uses the tab-only sign-out");
  assert.match(c, /onEmployeeSignOut\(\(\) => endThisLogin\(/, "a logout in another tab uses the tab-only sign-out");
});

test("the idle limit is a deploy setting in globalConfigs (bundled, ansible and Helm)", () => {
  for (const f of ["public/globalConfigs.js", "../local-setup/ansible/templates/globalConfigs.js.j2", "../devops/deploy-as-code/charts/urban/digit-ui/files/globalConfigs.js.tpl"]) {
    assert.match(fs.readFileSync(path.join(ROOT, f), "utf8"), /EMPLOYEE_IDLE_TIMEOUT_MINUTES/, f);
  }
});

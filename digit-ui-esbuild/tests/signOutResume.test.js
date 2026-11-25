// #224: an app-started sign-out shows its own reason on the login page, and a
// citizen signed out mid-complaint gets their answers back after signing in.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/libraries/src/services/atoms/Utils/authSession.js");
const { outputFiles } = esbuild.buildSync({ entryPoints: [SRC], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018", external: ["../../auth/authSurface"] });

const memStore = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};

/** A fresh copy of authSession.js (its module state included) on a fake window. */
function load({ pathname = "/digit-ui/citizen/pgr/create-complaint/location", session = memStore(), local = memStore() } = {}) {
  const window = { contextPath: "digit-ui", location: { pathname, search: "", href: "" }, sessionStorage: session, localStorage: local };
  const mod = { exports: {} };
  const stubRequire = (id) => {
    if (id.endsWith("authSurface")) return { isKeycloakAuth: () => false };
    throw new Error(`unexpected require ${id}`);
  };
  vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports, require: stubRequire, window, URLSearchParams, encodeURIComponent, JSON, Date });
  return { api: mod.exports, window, session, local };
}

const reasonOf = (href) => new URLSearchParams(href.split("?")[1]).get("reason");

/* ---------------- the reason shown on the login page ---------------- */

test("a failing request alone sends the user to sign in as an expired session", () => {
  const { api, window } = load();
  api.redirectToLogin();
  assert.strictEqual(reasonOf(window.location.href), "expired");
});

test("an idle sign-out keeps its reason even when a failing request redirects first", () => {
  const { api, window } = load();
  api.startSignOut(api.SIGN_OUT_REASONS.IDLE); // IdleLogout, before ending the login on the server
  api.redirectToLogin(); // a request still in flight came back 401
  api.redirectToLogin(api.SIGN_OUT_REASONS.IDLE); // the idle path itself: ignored, one redirect only
  assert.strictEqual(reasonOf(window.location.href), "idle");
  assert.match(window.location.href, /^\/digit-ui\/citizen\/login\?reason=idle&from=/);
});

test("an unknown sign-out reason is ignored", () => {
  const { api, window } = load();
  api.startSignOut("<script>");
  api.redirectToLogin();
  assert.strictEqual(reasonOf(window.location.href), "expired");
});

/* ---------------- coming back to the complaint form ---------------- */

const CREATE = "/digit-ui/citizen/pgr/create-complaint";

test("the sign-out keeps the complaint draft and remembers the form, but not the login", () => {
  const session = memStore({ "Digit.User": "{}", "Citizen.token": "t", "Digit.PGR_CREATE_CITIZEN_DRAFT": '{"value":{"formData":{"street":"x"}}}' });
  const { api } = load({ session });
  api.redirectToLogin();
  assert.strictEqual(session.getItem("Digit.User"), null);
  assert.strictEqual(session.getItem("Citizen.token"), null);
  assert.ok(session.getItem("Digit.PGR_CREATE_CITIZEN_DRAFT"), "the draft survives");
  const mark = JSON.parse(session.getItem("Digit.ResumeAfterSignIn"));
  assert.strictEqual(mark.path, `${CREATE}/location`);
  assert.deepStrictEqual(Object.keys(mark).sort(), ["at", "path"], "a path and a time, nothing else");
});

test("the form takes the way back once", () => {
  const { api } = load();
  api.redirectToLogin();
  assert.strictEqual(api.takeResumeAfterSignIn(CREATE), true);
  assert.strictEqual(api.takeResumeAfterSignIn(CREATE), false, "a later visit starts clean");
});

test("signed out on another page: the form starts clean, and the mark is gone", () => {
  const { api, session } = load({ pathname: "/digit-ui/citizen/pgr/complaints" });
  api.redirectToLogin();
  assert.strictEqual(api.takeResumeAfterSignIn(CREATE), false);
  assert.strictEqual(session.getItem("Digit.ResumeAfterSignIn"), null);
});

test("a mark older than a day (the draft's own lifetime) is not used", () => {
  const { api } = load();
  api.redirectToLogin();
  assert.strictEqual(api.takeResumeAfterSignIn(CREATE, Date.now() + 25 * 60 * 60 * 1000), false);
});

test("blocked or broken storage never throws", () => {
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  const { api } = load({ session: blocked, local: blocked });
  assert.doesNotThrow(() => api.redirectToLogin());
  assert.strictEqual(api.takeResumeAfterSignIn(CREATE), false);
  const { api: api2 } = load({ session: memStore({ "Digit.ResumeAfterSignIn": "not json" }) });
  assert.strictEqual(api2.takeResumeAfterSignIn(CREATE), false);
});

/* ---------------- wiring ---------------- */

test("IdleLogout records its reason before ending the login on the server", () => {
  const c = fs.readFileSync(path.join(ROOT, "packages/modules/core/src/components/IdleLogout.js"), "utf8");
  const body = (c.match(/const endThisLogin = async \(reason\) => \{([\s\S]*?)\n\};/) || [])[1] || "";
  assert.ok(body.indexOf("startSignOut(reason)") > -1 && body.indexOf("startSignOut(reason)") < body.indexOf("logoutUser()"));
});

// This branch's complaint form keeps no draft, so there is nothing to restore after a sign-in.

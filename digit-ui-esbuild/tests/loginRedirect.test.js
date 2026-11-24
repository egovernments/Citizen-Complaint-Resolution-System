// #224 follow-up: the login page shows why the employee was sent there, and
// afterwards returns them to the page they were on — only inside the app.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const vm = require("node:vm");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "packages/libraries/src/services/atoms/Utils/authSession.js");
// authSession imports the Keycloak switch; keep it out of the bundle and hand
// the module a stub, so only this file is under test.
const { outputFiles } = esbuild.buildSync({ entryPoints: [SRC], bundle: true, write: false, format: "cjs", platform: "node", target: "es2018", external: ["../../auth/authSurface"] });
const mod = { exports: {} };
const stubRequire = (id) => {
  if (id.endsWith("authSurface")) return { isKeycloakAuth: () => false };
  throw new Error(`unexpected require ${id}`);
};
vm.runInNewContext(outputFiles[0].text, { module: mod, exports: mod.exports, require: stubRequire, URLSearchParams, encodeURIComponent });
const { loginRedirectUrl, readLoginRedirect, SIGN_OUT_REASONS } = mod.exports;

const CTX = "digit-ui";
const LOGIN = `/${CTX}/employee/user/login`;

test("the redirect carries the reason before the return path", () => {
  const url = loginRedirectUrl({ loginPath: LOGIN, pathname: `/${CTX}/employee/pgr/complaint-details/PG-1`, search: "?createdBy=u1", reason: SIGN_OUT_REASONS.IDLE });
  assert.strictEqual(url, `${LOGIN}?reason=idle&from=${encodeURIComponent(`/${CTX}/employee/pgr/complaint-details/PG-1?createdBy=u1`)}`);
  // Older login code reads everything after "from=": the reason must not end up in the path.
  assert.ok(url.indexOf("reason=") < url.indexOf("from="));
});

test("an unknown reason is left out of the redirect", () => {
  const url = loginRedirectUrl({ loginPath: LOGIN, pathname: `/${CTX}/employee`, reason: "<script>" });
  assert.strictEqual(url, `${LOGIN}?from=${encodeURIComponent(`/${CTX}/employee`)}`);
});

test("reads a return path inside the employee app, with its query", () => {
  const from = `/${CTX}/employee/pgr/complaint-details/PG-1?createdBy=u1`;
  const r = readLoginRedirect(`?reason=idle&from=${encodeURIComponent(from)}`, CTX);
  assert.deepStrictEqual({ ...r }, { from, reason: "idle" });
  assert.strictEqual(readLoginRedirect(`?from=${encodeURIComponent(`/${CTX}/employee`)}`, CTX).from, `/${CTX}/employee`);
});

test("reads every known reason, ignores anything else", () => {
  for (const reason of Object.values(SIGN_OUT_REASONS)) assert.strictEqual(readLoginRedirect(`?reason=${reason}`, CTX).reason, reason);
  assert.strictEqual(readLoginRedirect("?reason=hacked", CTX).reason, null);
  assert.strictEqual(readLoginRedirect("", CTX).reason, null);
  assert.strictEqual(readLoginRedirect(undefined, CTX).reason, null);
});

test("never returns a path outside the employee app", () => {
  const bad = [
    "https://evil.example/phish",
    "//evil.example/phish",
    `/${CTX}/citizen/pgr/complaints`,
    `/${CTX}/employeeX/pgr`,
    "/other-app/employee/pgr",
    `/${CTX}/employee/user/login`, // would loop back to the login page
    `/${CTX}/employee/user/login?from=x`,
    `/${CTX}/employee\\..\\evil`,
    "javascript:alert(1)",
  ];
  for (const from of bad) {
    assert.strictEqual(readLoginRedirect(`?from=${encodeURIComponent(from)}`, CTX).from, null, from);
  }
});

test("missing or broken return path gives no redirect", () => {
  assert.strictEqual(readLoginRedirect("?reason=idle", CTX).from, null);
  assert.strictEqual(readLoginRedirect("?from=%E0%A4%A", CTX).from, null);
});

test("what the redirect writes, the login page reads back", () => {
  const pathname = `/${CTX}/employee/pgr/inbox-v2`;
  const url = loginRedirectUrl({ loginPath: LOGIN, pathname, search: "?page=2", reason: SIGN_OUT_REASONS.OTHER_TAB });
  const r = readLoginRedirect(url.slice(url.indexOf("?")), CTX);
  assert.strictEqual(r.from, `${pathname}?page=2`);
  assert.strictEqual(r.reason, "signed-out-elsewhere");
});

test("the employee login page keeps from and reason when it adds its ts parameter", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(path.join(ROOT, "packages/modules/core/src/pages/employee/Login/index.js"), "utf8");
  assert.match(src, /query\.set\("ts"/, "adds ts to the existing query");
  assert.doesNotMatch(src, /search: `\?ts=\$\{ts\}`/, "never replaces the whole query with ts alone");
});

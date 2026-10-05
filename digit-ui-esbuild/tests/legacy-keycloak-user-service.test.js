const { before, test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// The real UserService, with the auth-adapter registry swapped for a stub so
// the legacy opt-in Keycloak branches can be observed without keycloak-js.
const OUT = path.join(os.tmpdir(), `legacy-keycloak-user-service.cjs.${process.pid}.js`);
let UserService;
before(async () => {
await esbuild.build({
  stdin: {
    contents: `export { UserService } from "./elements/User/index.js";`,
    resolveDir: path.join(__dirname, "../packages/libraries/src/services"),
    sourcefile: "legacy-keycloak-user-service-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: OUT,
  logLevel: "error",
  plugins: [{
    name: "stub-auth-adapter",
    setup(build) {
      build.onResolve({ filter: /auth\/index$/ }, () => ({ path: "auth-index-stub", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
        contents: "export const getAuthAdapter = () => globalThis.__testAuthAdapter;",
        loader: "js",
      }));
    },
  }],
});
global.window = { globalConfigs: { getConfig: () => undefined } };
({ UserService } = require(OUT));
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});

const withLegacyRoute = async (provider, fn) => {
  const calls = [];
  globalThis.__testAuthAdapter = {
    logout: async () => { calls.push("adapter.logout"); },
    login: async (args) => { calls.push(["adapter.login", args]); return { user: { uuid: "u" }, token: "kc-digit-token" }; },
  };
  global.window = {
    location: { pathname: "/digit-ui/citizen/pgr/complaints", origin: "https://example.test", replace: () => calls.push("replace") },
    contextPath: "digit-ui",
    globalConfigs: { getConfig: (key) => (key === "CITIZEN_AUTH_PROVIDER" ? provider : undefined) },
    fetch: async () => { calls.push("fetch"); return { ok: true }; },
    localStorage: { clear: () => calls.push("local") },
    sessionStorage: { clear: () => calls.push("session") },
  };
  global.Digit = { SessionStorage: { get: () => ({ info: { type: "CITIZEN" } }) } };
  try {
    return { result: await fn(), calls };
  } finally {
    delete global.window;
    delete global.Digit;
    delete globalThis.__testAuthAdapter;
  }
};

test("legacy citizen_auth_provider=keycloak logout ends the Keycloak session via the adapter", async () => {
  const { calls } = await withLegacyRoute("keycloak", () => UserService.logout());
  assert.deepEqual(calls, ["adapter.logout"]);
});

test("legacy citizen_auth_provider=keycloak sign-in goes through the adapter", async () => {
  const { result, calls } = await withLegacyRoute("keycloak", () =>
    UserService.authenticate({ username: "a@example.test", password: "pw", tenantId: "pg" }));
  assert.deepEqual(calls, [["adapter.login", { email: "a@example.test", password: "pw", tenantId: "pg" }]]);
  assert.deepEqual(result, { UserRequest: { uuid: "u" }, access_token: "kc-digit-token", token_type: "bearer" });
});

test("default digit provider does not touch the Keycloak adapter on logout", async () => {
  const original = UserService.logoutUser;
  UserService.logoutUser = async () => undefined;
  try {
    const { calls } = await withLegacyRoute(undefined, () => UserService.logout());
    assert.ok(!calls.includes("adapter.logout"));
    assert.ok(calls.includes("local") && calls.includes("replace"));
  } finally { UserService.logoutUser = original; }
});

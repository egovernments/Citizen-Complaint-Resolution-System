const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// Bundle the framework-free adapter core plus the real UserService (for the
// logout path) so the Identity BFF can be stubbed with a fake fetch.
const OUT = path.join(os.tmpdir(), `identity-bff-login.cjs.${process.pid}.js`);
esbuild.buildSync({
  stdin: {
    contents: `
      export * from "./auth/identityBffLogin.js";
      export { UserService } from "./elements/User/index.js";
    `,
    resolveDir: path.join(__dirname, "../packages/libraries/src/services"),
    sourcefile: "identity-bff-login-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: OUT,
  logLevel: "error",
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});

// Some transitively bundled modules read window.globalConfigs at load time.
global.window = { globalConfigs: { getConfig: () => undefined } };
const {
  buildAuthorizeUrl,
  establishIdentityBffSession,
  restrictDestination,
  surfaceBase,
  identityBffLogoutRedirect,
  UserService,
} = require(OUT);
delete global.window;

const TENANT = Object.freeze({
  urlSlug: "bomet-county",
  appBasePath: "bomet-county/digit-ui",
  tenantId: "ke.bomet",
  rootTenantId: "ke",
  name: "Bomet County Government",
});

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Fake BFF: routes "METHOD path" to a response; records every call. */
const stubBff = (routes) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ method, url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const handler = routes[`${method} ${url}`];
    if (!handler) throw new Error(`unexpected BFF call ${method} ${url}`);
    return typeof handler === "function" ? handler() : handler;
  };
  return { calls, fetchImpl };
};

const employeeUser = (tenantId = TENANT.tenantId) => ({
  access_token: "emp-token",
  token_type: "bearer",
  UserRequest: {
    type: "EMPLOYEE",
    tenantId,
    roles: [
      { code: "GRO", tenantId: TENANT.tenantId },
      { code: "GRO", tenantId: "ke.other" },
    ],
  },
});

const citizenUser = (tenantId = TENANT.tenantId, type = "CITIZEN") => ({
  access_token: "cit-token",
  token_type: "bearer",
  expires_in: 3600,
  scope: "read",
  UserRequest: { type, tenantId, uuid: "u-1", mobileNumber: "712345678" },
});

// ---------------------------------------------------------------- authorize

test("employee authorize URL carries surface, tenant slug and password method", () => {
  const url = new URL(
    buildAuthorizeUrl({
      surface: "employee",
      tenant: TENANT,
      pathname: "/bomet-county/digit-ui/employee/user/login",
      destination: "/bomet-county/digit-ui/employee/pgr/inbox",
    }),
    "https://example.test",
  );
  assert.equal(url.pathname, "/identity/v1/authorize");
  assert.equal(url.searchParams.get("surface"), "employee");
  assert.equal(url.searchParams.get("tenantSlug"), "bomet-county");
  assert.equal(url.searchParams.get("method"), "password");
  assert.equal(url.searchParams.get("intent"), "signin");
  assert.equal(
    url.searchParams.get("returnTo"),
    "/bomet-county/digit-ui/employee/user/login?from=%2Fbomet-county%2Fdigit-ui%2Femployee%2Fpgr%2Finbox",
  );
});

test("citizen authorize URL uses phone_otp and a citizen returnTo", () => {
  const url = new URL(
    buildAuthorizeUrl({
      surface: "citizen",
      tenant: TENANT,
      pathname: "/bomet-county/digit-ui/citizen/login",
      destination: surfaceBase(TENANT, "citizen"),
    }),
    "https://example.test",
  );
  assert.equal(url.searchParams.get("surface"), "citizen");
  assert.equal(url.searchParams.get("tenantSlug"), "bomet-county");
  assert.equal(url.searchParams.get("method"), "phone_otp");
  assert.equal(url.searchParams.get("intent"), "signin");
  assert.equal(url.searchParams.get("returnTo"), "/bomet-county/digit-ui/citizen/login");
});

// ------------------------------------------------------------ from restriction

test("`from` is restricted to the same tenant and surface", () => {
  const citizenBase = surfaceBase(TENANT, "citizen");
  assert.equal(citizenBase, "/bomet-county/digit-ui/citizen");
  const ok = [
    "/bomet-county/digit-ui/citizen",
    "/bomet-county/digit-ui/citizen/pgr/complaints",
    "/bomet-county/digit-ui/citizen?x=1",
  ];
  ok.forEach((from) => assert.equal(restrictDestination(from, citizenBase), from));
  const rejected = [
    undefined,
    null,
    { pathname: "/bomet-county/digit-ui/citizen" },
    "https://evil.test/bomet-county/digit-ui/citizen",
    "//evil.test/bomet-county/digit-ui/citizen",
    "/other-county/digit-ui/citizen/pgr",
    "/bomet-county/digit-ui/employee/pgr/inbox",
    "/bomet-county/digit-ui/citizenship",
    "/bomet-county/digit-ui/citizen/../employee",
    "/bomet-county/digit-ui/citizen/%2e%2e/%2E%2E/other/digit-ui/citizen",
    "/bomet-county/digit-ui/citizen/..\\..\\employee",
    "/digit-ui/citizen",
  ];
  rejected.forEach((from) => assert.equal(restrictDestination(from, citizenBase), citizenBase, String(from)));
});

// ------------------------------------------------------------ employee session

test("employee session exchange passes surface=employee and scopes roles to the route tenant", async () => {
  const { calls, fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=employee": json(200, { authenticated: true }),
    "POST /identity/v1/contexts/_select": json(200, employeeUser()),
  });
  const result = await establishIdentityBffSession({ surface: "employee", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "authenticated");
  assert.deepEqual(calls[1].body, { surface: "employee", tenantId: "ke.bomet" });
  assert.equal(calls[1].init.credentials, "include");
  assert.deepEqual(result.user.info.roles.map((r) => r.tenantId), ["ke.bomet"]);
  assert.equal(result.user.access_token, "emp-token");
});

test("employee session rejects a token for a different tenant", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=employee": json(200, { authenticated: true }),
    "POST /identity/v1/contexts/_select": json(200, employeeUser("ke.nairobi")),
  });
  const result = await establishIdentityBffSession({ surface: "employee", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "error");
  assert.equal(result.messageKey, "CORE_IDENTITY_INVALID_SESSION");
});

test("employee 403 from _select is surfaced as forbidden", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=employee": json(200, { authenticated: true }),
    "POST /identity/v1/contexts/_select": json(403, { message: "no" }),
  });
  const result = await establishIdentityBffSession({ surface: "employee", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "forbidden");
  assert.match(result.message, /Bomet County Government/);
});

test("signed-out without an authResult is eligible for a direct Keycloak redirect", async () => {
  const { calls, fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=employee": json(401, null),
  });
  const result = await establishIdentityBffSession({ surface: "employee", tenant: TENANT, fetchImpl });
  assert.deepEqual(result, { status: "signed-out", fromAuthResult: false });
  assert.equal(calls.length, 1);
});

test("signed-out after an authResult round trip does not auto-redirect (no loop)", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/auth-results/r-1": json(200, { status: "succeeded" }),
    "GET /identity/v1/session?surface=employee": json(401, null),
  });
  const result = await establishIdentityBffSession({
    surface: "employee", tenant: TENANT, authResultId: "r-1", fetchImpl,
  });
  assert.equal(result.status, "signed-out");
  assert.equal(result.fromAuthResult, true);
});

test("a failed authResult reports the BFF message", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/auth-results/r-2": json(200, { status: "failed", message: "Wrong tenant" }),
  });
  const result = await establishIdentityBffSession({
    surface: "citizen", tenant: TENANT, authResultId: "r-2", fetchImpl,
  });
  assert.equal(result.status, "signed-out");
  assert.equal(result.messageKey, "CORE_IDENTITY_SIGNIN_FAILED");
  assert.equal(result.message, "Wrong tenant");
});

// ------------------------------------------------------------- citizen session

test("citizen session exchange uses surface=citizen and the citizen _select with an empty body", async () => {
  const { calls, fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=citizen": json(200, { authenticated: true }),
    "POST /identity/v1/contexts/citizen/_select": json(200, citizenUser()),
  });
  const result = await establishIdentityBffSession({ surface: "citizen", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "authenticated");
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    "GET /identity/v1/session?surface=citizen",
    "POST /identity/v1/contexts/citizen/_select",
  ]);
  assert.deepEqual(calls[1].body, {});
  assert.equal(result.user.info.type, "CITIZEN");
  assert.equal(result.user.access_token, "cit-token");
});

test("citizen session rejects a token for another tenant", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=citizen": json(200, { authenticated: true }),
    "POST /identity/v1/contexts/citizen/_select": json(200, citizenUser("ke.nairobi")),
  });
  const result = await establishIdentityBffSession({ surface: "citizen", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "error");
  assert.equal(result.messageKey, "CORE_IDENTITY_INVALID_SESSION");
});

test("citizen session rejects a non-CITIZEN user", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=citizen": json(200, { authenticated: true }),
    "POST /identity/v1/contexts/citizen/_select": json(200, citizenUser(TENANT.tenantId, "EMPLOYEE")),
  });
  const result = await establishIdentityBffSession({ surface: "citizen", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "error");
});

// ---------------------------------------------------------------------- logout

test("logout redirect targets the tenant's login page for the surface", () => {
  assert.equal(identityBffLogoutRedirect(TENANT.appBasePath, "citizen"), "/bomet-county/digit-ui/citizen/login");
  assert.equal(identityBffLogoutRedirect(TENANT.appBasePath, "employee"), "/bomet-county/digit-ui/employee/user/login");
});

const withBrowser = async (pathname, surface, fn) => {
  const calls = [];
  const cleared = [];
  let replacedWith = null;
  global.window = {
    location: {
      pathname,
      origin: "https://example.test",
      replace: (url) => { replacedWith = url; },
    },
    contextPath: TENANT.appBasePath,
    globalConfigs: { getConfig: () => undefined },
    __digitTenantContext: { ...TENANT, surface },
    fetch: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return json(204, null);
    },
    localStorage: { clear: () => cleared.push("local") },
    sessionStorage: { clear: () => cleared.push("session") },
  };
  try {
    await fn();
    return { calls, cleared, replacedWith };
  } finally {
    delete global.window;
  }
};

test("UserService.logout on a citizen tenant route posts surface=citizen and lands on citizen login", async () => {
  const { calls, cleared, replacedWith } = await withBrowser(
    "/bomet-county/digit-ui/citizen/pgr/complaints", "citizen", () => UserService.logout(),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/identity/v1/logout");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "include");
  assert.deepEqual(calls[0].body, { surface: "citizen" });
  assert.deepEqual(cleared.sort(), ["local", "session"]);
  assert.equal(replacedWith, "https://example.test/bomet-county/digit-ui/citizen/login");
});

test("UserService.logout on an employee tenant route posts surface=employee and lands on employee login", async () => {
  const { calls, replacedWith } = await withBrowser(
    "/bomet-county/digit-ui/employee/pgr/inbox", "employee", () => UserService.logout(),
  );
  assert.deepEqual(calls[0].body, { surface: "employee" });
  assert.equal(replacedWith, "https://example.test/bomet-county/digit-ui/employee/user/login");
});

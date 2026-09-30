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

// `/session` for employee/citizen reports the tenant the session is bound to.
const SESSION = Object.freeze({
  authenticated: true,
  tenant: { urlSlug: TENANT.urlSlug, tenantId: TENANT.tenantId, name: TENANT.name },
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
      { code: "SUPERUSER", tenantId: "ke" },
      { code: "GRO", tenantId: "ke.other" },
      { code: "GRO", tenantId: "ke.bometx" },
    ],
  },
});

// egov-user issues citizen tokens at the root (`ke`); the BFF echoes the
// bound route tenant alongside.
const citizenUser = (tenantId = "ke", type = "CITIZEN", tenant = { urlSlug: TENANT.urlSlug, tenantId: TENANT.tenantId }) => ({
  access_token: "cit-token",
  token_type: "bearer",
  expires_in: 3600,
  scope: "read",
  UserRequest: { type, tenantId, uuid: "u-1", mobileNumber: "712345678" },
  ...(tenant && { tenant }),
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

test("citizen authorize URL names no method and uses a citizen returnTo", () => {
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
  assert.equal(url.searchParams.has("method"), false);
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

test("`from` pointing at the surface's own sign-in pages collapses to the base", () => {
  const citizenBase = surfaceBase(TENANT, "citizen");
  const employeeBase = surfaceBase(TENANT, "employee");
  [
    "/bomet-county/digit-ui/citizen/login",
    "/bomet-county/digit-ui/citizen/login/",
    "/bomet-county/digit-ui/citizen/login?from=%2Fbomet-county%2Fdigit-ui%2Fcitizen%2Flogin",
    "/bomet-county/digit-ui/citizen/login/otp",
    "/bomet-county/digit-ui/citizen/register/name",
    "/bomet-county/digit-ui/citizen/select-language",
  ].forEach((from) => assert.equal(restrictDestination(from, citizenBase), citizenBase, from));
  [
    "/bomet-county/digit-ui/employee/user/login",
    "/bomet-county/digit-ui/employee/user/login?from=x",
    "/bomet-county/digit-ui/employee/user/language-selection",
  ].forEach((from) => assert.equal(restrictDestination(from, employeeBase), employeeBase, from));
  // Pages that merely share a prefix are still honoured.
  assert.equal(restrictDestination("/bomet-county/digit-ui/citizen/login-help", citizenBase),
    "/bomet-county/digit-ui/citizen/login-help");
  assert.equal(restrictDestination("/bomet-county/digit-ui/employee/pgr/inbox", employeeBase),
    "/bomet-county/digit-ui/employee/pgr/inbox");
});

// ------------------------------------------------------------ employee session

test("employee session exchange passes surface=employee and scopes roles to the route tenant and its ancestors", async () => {
  const { calls, fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=employee": json(200, SESSION),
    "POST /identity/v1/contexts/_select": json(200, employeeUser()),
  });
  const result = await establishIdentityBffSession({ surface: "employee", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "authenticated");
  assert.deepEqual(calls[1].body, { surface: "employee", tenantId: "ke.bomet" });
  assert.equal(calls[1].init.credentials, "include");
  assert.deepEqual(result.user.info.roles.map((r) => r.tenantId), ["ke.bomet", "ke"]);
  assert.equal(result.user.access_token, "emp-token");
});

test("employee session rejects a token for a different tenant", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=employee": json(200, SESSION),
    "POST /identity/v1/contexts/_select": json(200, employeeUser("ke.nairobi")),
  });
  const result = await establishIdentityBffSession({ surface: "employee", tenant: TENANT, fetchImpl });
  assert.equal(result.status, "error");
  assert.equal(result.messageKey, "CORE_IDENTITY_INVALID_SESSION");
});

test("employee 403 from _select is surfaced as forbidden", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=employee": json(200, SESSION),
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
    "GET /identity/v1/session?surface=citizen": json(200, SESSION),
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
  assert.equal(result.user.info.tenantId, "ke");
  assert.equal(result.user.access_token, "cit-token");
  assert.equal("tenant" in result.user, false, "the echoed route tenant is not a token field");
});

test("citizen tokens are accepted at the root of root and city routes", async () => {
  const routes = [
    { urlSlug: "kenya", appBasePath: "kenya/digit-ui", tenantId: "ke", rootTenantId: "ke", name: "Kenya" },
    TENANT,
    { urlSlug: "bomet-ulb-one", appBasePath: "bomet-ulb-one/digit-ui", tenantId: "ke.bomet.ulb1", rootTenantId: "ke.bomet", name: "ULB" },
  ];
  for (const route of routes) {
    const { fetchImpl } = stubBff({
      "GET /identity/v1/session?surface=citizen": json(200, {
        authenticated: true, tenant: { urlSlug: route.urlSlug, tenantId: route.tenantId, name: route.name },
      }),
      "POST /identity/v1/contexts/citizen/_select": json(200, citizenUser("ke", "CITIZEN", {
        urlSlug: route.urlSlug, tenantId: route.tenantId,
      })),
    });
    const result = await establishIdentityBffSession({ surface: "citizen", tenant: route, fetchImpl });
    assert.equal(result.status, "authenticated", route.tenantId);
    assert.equal(result.user.info.tenantId, "ke", route.tenantId);
  }
});

test("citizen session rejects a token for anything but the route tenant's root", async () => {
  for (const [label, body] of [
    ["city-level token", citizenUser(TENANT.tenantId)],
    ["other root", citizenUser("mz")],
    ["employee token", citizenUser("ke", "EMPLOYEE")],
    ["no bound tenant echoed", citizenUser("ke", "CITIZEN", null)],
    ["other bound tenant", citizenUser("ke", "CITIZEN", { urlSlug: "nairobi", tenantId: "ke.nairobi" })],
    ["other slug", citizenUser("ke", "CITIZEN", { urlSlug: "other", tenantId: TENANT.tenantId })],
  ]) {
    const { fetchImpl } = stubBff({
      "GET /identity/v1/session?surface=citizen": json(200, SESSION),
      "POST /identity/v1/contexts/citizen/_select": json(200, body),
    });
    const result = await establishIdentityBffSession({ surface: "citizen", tenant: TENANT, fetchImpl });
    assert.equal(result.status, "error", label);
    assert.equal(result.messageKey, "CORE_IDENTITY_INVALID_SESSION", label);
  }
});

test("a session bound to another tenant starts a fresh sign-in without selecting", async () => {
  const otherTenant = { authenticated: true, tenant: { urlSlug: "nairobi", tenantId: "ke.nairobi", name: "Nairobi" } };
  for (const surface of ["citizen", "employee"]) {
    const { calls, fetchImpl } = stubBff({
      [`GET /identity/v1/session?surface=${surface}`]: json(200, otherTenant),
    });
    const result = await establishIdentityBffSession({ surface, tenant: TENANT, fetchImpl });
    assert.deepEqual(result, { status: "signed-out", fromAuthResult: false }, surface);
    assert.equal(calls.length, 1, "no _select for a foreign-tenant session");
  }
});

test("a foreign-tenant session after an authResult round trip does not loop", async () => {
  const { calls, fetchImpl } = stubBff({
    "GET /identity/v1/auth-results/r-9": json(200, { status: "succeeded" }),
    "GET /identity/v1/session?surface=citizen": json(200, { authenticated: true, tenant: null }),
  });
  const result = await establishIdentityBffSession({
    surface: "citizen", tenant: TENANT, authResultId: "r-9", fetchImpl,
  });
  assert.equal(result.status, "signed-out");
  assert.equal(result.fromAuthResult, true);
  assert.equal(result.messageKey, "CORE_IDENTITY_TENANT_SESSION_MISMATCH");
  assert.equal(calls.some((call) => call.url.includes("_select")), false);
});

test("citizen session rejects a non-CITIZEN user", async () => {
  const { fetchImpl } = stubBff({
    "GET /identity/v1/session?surface=citizen": json(200, SESSION),
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

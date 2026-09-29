const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `tenant-route.cjs.${process.pid}.js`);
esbuild.buildSync({
  stdin: {
    contents: `
      export * from "./tenant/tenantRoute.js";
      export * from "./auth/authSurface.js";
    `,
    resolveDir: path.join(__dirname, "../packages/libraries/src/services"),
    sourcefile: "tenant-route-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});

const {
  getAuthProvider,
  isIdentityBffAuth,
  isValidTenantSlug,
  legacyMultiRootTenantEnabled,
  mdmsAppId,
  parseTenantRoute,
  rebaseAppUrl,
  resolveTenantRoute,
} = require(OUT);

test("canonical tenant routes disable legacy in-app multi-root selection", () => {
  assert.equal(legacyMultiRootTenantEnabled(true, { tenantId: "ke.bomet" }), false);
  assert.equal(legacyMultiRootTenantEnabled(false, null), false);
  assert.equal(legacyMultiRootTenantEnabled(true, null), true);
});

test("tenant route parser recognizes only the canonical tenant-prefixed mount", () => {
  assert.deepEqual(parseTenantRoute("/bomet-county/digit-ui/employee/user/login"), {
    urlSlug: "bomet-county",
    appBasePath: "bomet-county/digit-ui",
    surface: "employee",
    routeSuffix: "employee/user/login",
  });
  assert.equal(parseTenantRoute("/bomet-county/digit-ui/citizen" ).surface, "citizen");
  assert.equal(parseTenantRoute("/digit-ui/employee/user/login"), null);
  assert.equal(parseTenantRoute("/identity/digit-ui/employee"), null);
});

test("tenant slug validation rejects ambiguous and reserved route values", () => {
  assert.equal(isValidTenantSlug("bomet-county"), true);
  assert.equal(isValidTenantSlug("a-123"), false);
  assert.equal(isValidTenantSlug("Bomet"), false);
  assert.equal(isValidTenantSlug("identity"), false);
});

test("canonical employee routes use the Identity BFF without a global-config toggle", () => {
  global.window = {
    location: { pathname: "/bomet-county/digit-ui/employee/user/login" },
    globalConfigs: { getConfig: () => "digit" },
  };
  assert.equal(getAuthProvider(), "identity-bff");
  assert.equal(isIdentityBffAuth(), true);
  assert.equal(getAuthProvider("/digit-ui/employee/user/login"), "digit");
  delete global.window;
});

test("canonical citizen routes also use the Identity BFF; legacy citizen routes keep their provider", () => {
  global.window = {
    location: { pathname: "/bomet-county/digit-ui/citizen/login" },
    globalConfigs: { getConfig: (key) => (key === "CITIZEN_AUTH_PROVIDER" ? "digit" : undefined) },
  };
  assert.equal(getAuthProvider(), "identity-bff");
  assert.equal(isIdentityBffAuth("/bomet-county/digit-ui/citizen/register"), true);
  assert.equal(getAuthProvider("/digit-ui/citizen/login"), "digit");
  window.globalConfigs = { getConfig: (key) => (key === "AUTH_PROVIDER" ? "keycloak" : undefined) };
  assert.equal(getAuthProvider("/digit-ui/citizen/login"), "keycloak");
  assert.equal(getAuthProvider("/bomet-county/digit-ui/citizen/login"), "identity-bff");
  delete global.window;
});

test("tenant routes without a surface segment do not force the Identity BFF", () => {
  global.window = { location: { pathname: "/" }, globalConfigs: { getConfig: () => undefined } };
  assert.equal(getAuthProvider("/bomet-county/digit-ui/"), "digit");
  delete global.window;
});

test("tenant route resolver keeps the slug separate from the tenant id", async () => {
  const calls = [];
  const resolved = await resolveTenantRoute(
    "/bomet-county/digit-ui/employee",
    async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tenant: {
            urlSlug: "bomet-county",
            tenantId: "ke.bomet",
            rootTenantId: "ke",
            parentTenantId: "ke",
            fallbackTenantIds: ["ke"],
            name: "Bomet County Government",
          },
        }),
      };
    },
  );

  assert.equal(calls[0].url, "/identity/v1/tenant-contexts/bomet-county");
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(resolved.urlSlug, "bomet-county");
  assert.equal(resolved.tenantId, "ke.bomet");
  assert.equal(resolved.parentTenantId, "ke");
  assert.deepEqual(resolved.fallbackTenantIds, ["ke"]);
  assert.equal(resolved.appBasePath, "bomet-county/digit-ui");
});

test("tenant route resolver fails closed for missing and inconsistent mappings", async () => {
  await assert.rejects(
    resolveTenantRoute("/a-123/digit-ui/citizen", async () => {
      throw new Error("invalid slugs must not reach the API");
    }),
    /tenant link is not available/i,
  );
  await assert.rejects(
    resolveTenantRoute("/missing/digit-ui/citizen", async () => ({ ok: false, status: 404 })),
    /tenant link is not available/i,
  );
  await assert.rejects(
    resolveTenantRoute("/bomet/digit-ui/citizen", async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tenant: { urlSlug: "another", tenantId: "ke.bomet", rootTenantId: "ke" } }),
    })),
    /could not be verified/i,
  );
});

test("MDMS app id stays separate from the tenant route base", () => {
  global.window = {
    globalConfigs: { getConfig: (key) => (key === "CONTEXT_PATH" ? "digit-ui" : undefined) },
    __digitTenantContext: { appBasePath: "bomet/digit-ui" },
  };
  try {
    assert.equal(mdmsAppId(), "digit-ui");
    assert.equal(rebaseAppUrl("/digit-ui/citizen/pgr/create-complaint"), "/bomet/digit-ui/citizen/pgr/create-complaint");
    assert.equal(rebaseAppUrl("/digit-ui/citizen?x=1"), "/bomet/digit-ui/citizen?x=1");
    // Already-rebased and foreign URLs are left alone (idempotent on cached MDMS rows).
    assert.equal(rebaseAppUrl("/bomet/digit-ui/citizen/pgr"), "/bomet/digit-ui/citizen/pgr");
    assert.equal(rebaseAppUrl("/digit-uix/citizen"), "/digit-uix/citizen");
    assert.equal(rebaseAppUrl("https://example.test/digit-ui/citizen"), "https://example.test/digit-ui/citizen");
    // Legacy routes (no tenant context) are unchanged.
    assert.equal(rebaseAppUrl("/digit-ui/citizen/pgr", null), "/digit-ui/citizen/pgr");
  } finally {
    delete global.window;
  }
  assert.equal(mdmsAppId(), "digit-ui");
});

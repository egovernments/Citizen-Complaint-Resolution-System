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
  RESERVED_TENANT_SLUGS,
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
  for (const slug of ["citizen", "employee", "user", "pgr-services", "mdms-v2", "novu", "grafana", "keycloak", "filestore"]) {
    assert.equal(isValidTenantSlug(slug), false, slug);
  }
  for (const slug of ["a1", "12", "-bomet", "b".repeat(64)]) assert.equal(isValidTenantSlug(slug), false, slug);
  for (const slug of ["ke", "county-47", "b".repeat(63)]) assert.equal(isValidTenantSlug(slug), true, slug);
});

test("reserved slugs equal the identity-bff contract list (docs §2.4.1)", () => {
  const doc = fs.readFileSync(path.join(__dirname, "../../backend/identity-bff/docs/identity-bff.md"), "utf8");
  const block = /<!-- reserved-url-slugs:begin -->([\s\S]*?)<!-- reserved-url-slugs:end -->/.exec(doc);
  assert.ok(block, "identity-bff.md must keep the reserved-url-slugs block");
  const documented = block[1].split("\n").map((line) => line.trim()).filter((line) => /^[a-z0-9-]+$/.test(line));
  assert.deepEqual([...RESERVED_TENANT_SLUGS].sort(), documented.sort());
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

test("canonical citizen routes also use the Identity BFF; legacy routes ignore the retired provider keys", () => {
  global.window = {
    location: { pathname: "/bomet-county/digit-ui/citizen/login" },
    globalConfigs: { getConfig: (key) => (key === "CITIZEN_AUTH_PROVIDER" || key === "AUTH_PROVIDER" ? "keycloak" : undefined) },
  };
  assert.equal(getAuthProvider(), "identity-bff");
  assert.equal(isIdentityBffAuth("/bomet-county/digit-ui/citizen/register"), true);
  assert.equal(getAuthProvider("/digit-ui/citizen/login"), "digit");
  assert.equal(getAuthProvider("/pgr-ui/employee/pgr/inbox"), "digit");
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

// --- Slug→context cache: used only when the BFF is down (network error or 5xx).

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function tenantReply(name = "Bomet County Government") {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      tenant: {
        urlSlug: "bomet-county",
        tenantId: "ke.bomet",
        rootTenantId: "ke",
        parentTenantId: "ke",
        fallbackTenantIds: ["ke"],
        name,
      },
    }),
  });
}

const ROUTE = "/bomet-county/digit-ui/citizen";
const CACHE_KEY = "Digit.tenantContext.bomet-county";

test("a successful lookup saves the tenant context and returns the live answer", async () => {
  const storage = memoryStorage();
  const resolved = await resolveTenantRoute(ROUTE, tenantReply(), storage);
  assert.equal(resolved.tenantId, "ke.bomet");
  assert.equal(JSON.parse(storage.data.get(CACHE_KEY)).tenant.tenantId, "ke.bomet");
});

test("a successful lookup is used instead of the cache and refreshes it (tenant rename)", async () => {
  const storage = memoryStorage();
  await resolveTenantRoute(ROUTE, tenantReply("Old Name"), storage);
  const resolved = await resolveTenantRoute(ROUTE, tenantReply("Bomet Renamed"), storage);
  assert.equal(resolved.name, "Bomet Renamed");
  assert.equal(JSON.parse(storage.data.get(CACHE_KEY)).tenant.name, "Bomet Renamed");
  // The next outage now falls back to the new name, not the old one.
  const offline = await resolveTenantRoute(ROUTE, async () => { throw new TypeError("Failed to fetch"); }, storage);
  assert.equal(offline.name, "Bomet Renamed");
});

test("a network error falls back to the saved context", async () => {
  const storage = memoryStorage();
  await resolveTenantRoute(ROUTE, tenantReply(), storage);
  const resolved = await resolveTenantRoute(ROUTE, async () => { throw new TypeError("Failed to fetch"); }, storage);
  assert.equal(resolved.tenantId, "ke.bomet");
  assert.equal(resolved.appBasePath, "bomet-county/digit-ui");
  assert.equal(resolved.surface, "citizen");
});

for (const status of [500, 502, 503, 504]) {
  test(`a ${status} from the BFF falls back to the saved context`, async () => {
    const storage = memoryStorage();
    await resolveTenantRoute(ROUTE, tenantReply(), storage);
    const resolved = await resolveTenantRoute(ROUTE, async () => ({ ok: false, status }), storage);
    assert.equal(resolved.tenantId, "ke.bomet");
    assert.ok(storage.data.has(CACHE_KEY));
  });
}

for (const status of [400, 401, 403, 404, 410]) {
  test(`a ${status} never uses the saved context and removes it`, async () => {
    const storage = memoryStorage();
    await resolveTenantRoute(ROUTE, tenantReply(), storage);
    await assert.rejects(
      resolveTenantRoute(ROUTE, async () => ({ ok: false, status }), storage),
      (error) => error.status === status,
    );
    assert.equal(storage.data.has(CACHE_KEY), false);
    // A later outage has nothing to fall back to.
    await assert.rejects(
      resolveTenantRoute(ROUTE, async () => { throw new TypeError("Failed to fetch"); }, storage),
      /temporarily unavailable/i,
    );
  });
}

test("an outage with nothing saved still fails", async () => {
  const storage = memoryStorage();
  await assert.rejects(
    resolveTenantRoute(ROUTE, async () => { throw new TypeError("Failed to fetch"); }, storage),
    /temporarily unavailable/i,
  );
  await assert.rejects(
    resolveTenantRoute(ROUTE, async () => ({ ok: false, status: 503 }), storage),
    /temporarily unavailable/i,
  );
});

test("a reply that fails verification is not treated as an outage", async () => {
  const storage = memoryStorage();
  await resolveTenantRoute(ROUTE, tenantReply(), storage);
  await assert.rejects(
    resolveTenantRoute(ROUTE, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tenant: { urlSlug: "another", tenantId: "ke.bomet", rootTenantId: "ke" } }),
    }), storage),
    /could not be verified/i,
  );
});

test("a saved entry for another slug is ignored", async () => {
  const storage = memoryStorage();
  storage.setItem(CACHE_KEY, JSON.stringify({ tenant: { urlSlug: "other", tenantId: "ke.other" } }));
  await assert.rejects(
    resolveTenantRoute(ROUTE, async () => ({ ok: false, status: 503 }), storage),
    /temporarily unavailable/i,
  );
});

test("broken or blocked storage does not break a live lookup", async () => {
  const throwing = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("blocked"); },
  };
  const resolved = await resolveTenantRoute(ROUTE, tenantReply(), throwing);
  assert.equal(resolved.tenantId, "ke.bomet");
  const corrupt = memoryStorage();
  corrupt.setItem(CACHE_KEY, "{not json");
  await assert.rejects(
    resolveTenantRoute(ROUTE, async () => ({ ok: false, status: 500 }), corrupt),
    /temporarily unavailable/i,
  );
});

// The public dashboard shows the workspace named by its URL, never the
// deployment's state tenant. Run from digit-ui-esbuild/:
//   node --test tests/public-dashboard-tenant.test.js
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `public-dashboard-tenant.cjs.${process.pid}.js`);
esbuild.buildSync({
  stdin: {
    contents: `
      export { resolvePublicDashboardTenant } from "./src/publicDashboardTenant.js";
      export { getTenantId } from "./products/dashboard/src/config/dashboardConfig.js";
      export { configurePublicDashboardRuntime } from "./products/dashboard/src/services/dashboardRuntime.js";
      export { fetchPublicPack } from "./products/dashboard/src/services/analyticsService.js";
    `,
    resolveDir: path.join(__dirname, ".."),
    sourcefile: "public-dashboard-tenant-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
    "process.env.REACT_APP_ANALYTICS_BASE": '""',
  },
});
process.on("exit", () => {
  try { fs.unlinkSync(OUT); } catch (_) { /* already removed */ }
});

// The deployment root is publicly enabled (as `ke` is on Bomet); the workspace
// in the URL is a different root tenant.
const STATE_TENANT = "ke";
const WORKSPACE = {
  urlSlug: "testt-four",
  tenantId: "testtfour",
  rootTenantId: "testtfour",
  parentTenantId: null,
  fallbackTenantIds: [],
};

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function bffReturning(status, body) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

beforeEach(() => {
  global.window = {
    globalConfigs: { getConfig: (key) => (key === "STATE_LEVEL_TENANT_ID" ? STATE_TENANT : undefined) },
    localStorage: memoryStorage(),
    sessionStorage: memoryStorage(),
  };
});

const mod = () => require(OUT);

test("a workspace URL resolves to that workspace, not the deployment state tenant", async () => {
  const { resolvePublicDashboardTenant, getTenantId } = mod();
  const bff = bffReturning(200, { tenant: WORKSPACE });

  const result = await resolvePublicDashboardTenant(
    "/testt-four/digit-ui/public-dashboard", bff.fetchImpl, memoryStorage());

  assert.equal(result.unavailable, false);
  assert.deepEqual(bff.calls, ["/identity/v1/tenant-contexts/testt-four"]);
  assert.equal(getTenantId(), "testtfour");
});

test("the public analytics requests carry the URL's workspace tenant", async () => {
  const { resolvePublicDashboardTenant, getTenantId, configurePublicDashboardRuntime, fetchPublicPack } = mod();
  configurePublicDashboardRuntime();
  await resolvePublicDashboardTenant(
    "/testt-four/digit-ui/public-dashboard", bffReturning(200, { tenant: WORKSPACE }).fetchImpl, memoryStorage());

  const posted = [];
  global.fetch = async (url, init) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ enabled: true, tiles: [] }) };
  };
  try {
    await fetchPublicPack(getTenantId());
  } finally {
    delete global.fetch;
  }

  assert.equal(posted.length, 1);
  assert.match(posted[0].url, /\/public\/packs$/);
  assert.equal(posted[0].body.tenantId, "testtfour");
  assert.equal(posted[0].body.RequestInfo.authToken, undefined);
});

for (const [label, bff] of [
  ["an unknown slug (404)", () => bffReturning(404, {})],
  ["a mapping that fails verification", () => bffReturning(200, { tenant: { ...WORKSPACE, urlSlug: "other" } })],
  ["a BFF outage with no cached context", () => ({ fetchImpl: async () => { throw new Error("down"); } })],
]) {
  test(`${label} makes the page unavailable instead of showing the state tenant`, async () => {
    const { resolvePublicDashboardTenant } = mod();
    window.__digitTenantContext = { tenantId: "stale" };

    const result = await resolvePublicDashboardTenant(
      "/testt-four/digit-ui/public-dashboard", bff().fetchImpl, memoryStorage());

    assert.equal(result.unavailable, true);
    assert.equal(window.__digitTenantContext, undefined);
  });
}

test("only a tenantless dev route keeps the configured state tenant", async () => {
  const { resolvePublicDashboardTenant, getTenantId } = mod();
  const bff = bffReturning(200, { tenant: WORKSPACE });

  const result = await resolvePublicDashboardTenant("/digit-ui/public-dashboard.html", bff.fetchImpl, memoryStorage());

  assert.equal(result.unavailable, false);
  assert.deepEqual(bff.calls, []);
  assert.equal(getTenantId(), STATE_TENANT);
});

test("the public entry resolves the tenant before it renders the dashboard", () => {
  const entry = fs.readFileSync(path.join(__dirname, "../src/public-dashboard.js"), "utf8");
  const resolveAt = entry.indexOf("resolvePublicDashboardTenant(window.location.pathname)");
  const renderAt = entry.indexOf("ReactDOM.render(");
  assert.ok(resolveAt > 0, "public entry must resolve the URL tenant");
  assert.ok(renderAt > resolveAt, "dashboard must not render before the tenant is resolved");
});

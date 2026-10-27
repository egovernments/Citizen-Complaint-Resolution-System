// The public dashboard shows the workspace named by its URL, never the
// deployment's state tenant. Run from digit-ui-esbuild/:
//   node --test tests/public-dashboard-tenant.test.js
const { test, before, beforeEach } = require("node:test");
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

// The real entry, with only the render boundary stubbed: react-dom's render
// records what it was given, AdminDashboard is a marker component, and the
// theme is a no-op. Everything else (tenant resolution, ordering) is the code
// that ships.
const ENTRY_OUT = path.join(os.tmpdir(), `public-dashboard-entry.cjs.${process.pid}.js`);
const stubs = {
  name: "public-entry-stubs",
  setup(build) {
    build.onResolve({ filter: /^react-dom$/ }, () => ({ path: "react-dom", namespace: "stub" }));
    build.onResolve({ filter: /\/AdminDashboard$/ }, () => ({ path: "AdminDashboard", namespace: "stub" }));
    build.onResolve({ filter: /\/theme\/applyTheme$/ }, () => ({ path: "applyTheme", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path: name }) => ({
      loader: "js",
      contents: {
        "react-dom": `export function render(element) {
            globalThis.__renders.push({ element, tenant: globalThis.window.__digitTenantContext });
          }
          export default { render };`,
        AdminDashboard: "export default function AdminDashboard() { return null; }",
        applyTheme: "export function applyTheme() {}",
      }[name],
    }));
  },
};
// Plugins need the async API.
before(() => esbuild.build({
  entryPoints: [path.join(__dirname, "../src/public-dashboard.js")],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  mainFields: ["main", "module"],
  outfile: ENTRY_OUT,
  loader: { ".js": "jsx" },
  plugins: [stubs],
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
  },
  logLevel: "silent",
}));
process.on("exit", () => {
  try { fs.unlinkSync(ENTRY_OUT); } catch (_) { /* already removed */ }
});

async function bootEntry(pathname, respond) {
  const requests = [];
  global.__renders = [];
  window.location = { pathname };
  window.fetch = (url) => {
    requests.push(String(url));
    return respond(String(url));
  };
  global.document = { getElementById: () => ({}) };
  delete require.cache[require.resolve(ENTRY_OUT)];
  require(ENTRY_OUT);
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  return { requests, renders: global.__renders };
}

const rendered = (render) => render.element.props.children.type?.name;

test("the public entry renders nothing and asks nothing else while the workspace lookup is pending", async () => {
  const { requests, renders } = await bootEntry("/testt-four/digit-ui/public-dashboard", () => new Promise(() => {}));

  assert.deepEqual(requests, ["/identity/v1/tenant-contexts/testt-four"]);
  assert.equal(renders.length, 0, "the dashboard must not render before the URL's workspace is resolved");
});

test("the public entry renders the dashboard only once the URL's workspace is installed", async () => {
  const { renders } = await bootEntry("/testt-four/digit-ui/public-dashboard",
    async () => ({ ok: true, status: 200, json: async () => ({ tenant: WORKSPACE }) }));

  assert.equal(renders.length, 1);
  assert.equal(rendered(renders[0]), "AdminDashboard");
  assert.equal(renders[0].tenant?.tenantId, "testtfour");
});

test("the public entry renders the unavailable page, not the dashboard, for an unknown workspace", async () => {
  const { renders } = await bootEntry("/testt-four/digit-ui/public-dashboard",
    async () => ({ ok: false, status: 404, json: async () => ({}) }));

  assert.equal(renders.length, 1);
  assert.equal(rendered(renders[0]), "PublicTenantUnavailable");
  assert.equal(renders[0].tenant, undefined);
});

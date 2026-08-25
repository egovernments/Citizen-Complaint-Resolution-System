// Public analytics transport isolation (#1540).
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/services/publicAnalyticsIsolation.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "analyticsService.js");
const OUT = path.join(os.tmpdir(), `publicAnalyticsIsolation.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
    "process.env.REACT_APP_ANALYTICS_BASE": '"/pgr-services/v2/analytics"',
    "process.env.REACT_APP_DASHBOARD_METRICS": '"false"',
    "process.env.REACT_APP_OTEL_BASE": '"/otel"',
  },
});
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
  }
});

function response({ ok = true, status = 200, json = {} } = {}) {
  return {
    ok,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  };
}

function installBrowser(fetchImpl) {
  let storageReads = 0;
  let storageWrites = 0;
  let expiryEvents = 0;
  global.window = {
    globalConfigs: { getConfig: (key) => key === "STATE_LEVEL_TENANT_ID" ? "ke" : undefined },
    localStorage: {
      getItem: () => {
        storageReads += 1;
        return JSON.stringify("employee-secret-token");
      },
      setItem: () => { storageWrites += 1; },
      removeItem: () => { storageWrites += 1; },
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => { storageWrites += 1; },
      removeItem: () => { storageWrites += 1; },
    },
    dispatchEvent: () => { expiryEvents += 1; },
  };
  global.fetch = fetchImpl;
  return {
    storageReads: () => storageReads,
    storageWrites: () => storageWrites,
    expiryEvents: () => expiryEvents,
  };
}

test("public pack and query never read or send stored employee credentials", async () => {
  const calls = [];
  const observed = installBrowser(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return response({ json: url.endsWith("/_query") || url.endsWith("/_options") ? { results: {} } : { tiles: [] } });
  });
  delete require.cache[require.resolve(OUT)];
  const { fetchPublicPack, fetchPublicCatalog, fetchPublicFilterOptions, runPublicKpiBatch } = require(OUT);

  await fetchPublicPack("ke");
  await fetchPublicCatalog("ke");
  await fetchPublicFilterOptions("ke");
  await runPublicKpiBatch(
    { created: { kpiId: "created", params: { ward: "W1", dateFrom: "2026-07-01", dateTo: "2026-07-31" } } },
    "ke"
  );

  assert.deepEqual(calls.map((call) => call.url), [
    "/pgr-services/v2/analytics/public/packs",
    "/pgr-services/v2/analytics/public/catalog/_search",
    "/pgr-services/v2/analytics/public/_options",
    "/pgr-services/v2/analytics/public/_query",
  ]);
  // The filter params ride the anonymous transport untouched (#1797) — the
  // backend's allow-list, not this layer, decides what is acceptable.
  assert.deepEqual(calls[3].body.queries.created.params,
    { ward: "W1", dateFrom: "2026-07-01", dateTo: "2026-07-31" });
  // The options endpoint takes nothing but the tenant.
  assert.deepEqual(Object.keys(calls[2].body).sort(), ["RequestInfo", "tenantId"]);
  for (const call of calls) {
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.body.RequestInfo.authToken, undefined);
    assert.equal(call.body.RequestInfo.userInfo, undefined);
  }
  assert.equal(observed.storageReads(), 0, "public transport must not inspect employee storage");
  assert.equal(observed.storageWrites(), 0);
  assert.equal(observed.expiryEvents(), 0);
});
test("a public 401 is terminal and never enters employee refresh or teardown", async () => {
  const calls = [];
  const observed = installBrowser(async (url) => {
    calls.push(url);
    return response({ ok: false, status: 401, json: { error: "unauthorized" } });
  });
  delete require.cache[require.resolve(OUT)];
  const { fetchPublicPack } = require(OUT);

  await assert.rejects(fetchPublicPack("ke"), /Public analytics request failed \(401\)/);
  assert.deepEqual(calls, ["/pgr-services/v2/analytics/public/packs"]);
  assert.equal(observed.storageReads(), 0);
  assert.equal(observed.storageWrites(), 0);
  assert.equal(observed.expiryEvents(), 0);
});

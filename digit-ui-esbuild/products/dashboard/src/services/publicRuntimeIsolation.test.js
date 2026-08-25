// Shared auxiliary-service isolation for the public entry (#1540).
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/services/publicRuntimeIsolation.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const OUT = path.join(os.tmpdir(), `publicRuntimeIsolation.cjs.${process.pid}.js`);
const PUBLIC_ENTRY = path.resolve(__dirname, "../../../../public/public-dashboard.html");
const DASHBOARD_LAYOUT = path.resolve(__dirname, "../components/DashboardLayout.jsx");
const ADMIN_DASHBOARD = path.resolve(__dirname, "../AdminDashboard.jsx");
const LOCALE_OUT = path.join(os.tmpdir(), `publicRuntimeIsolation.locale.cjs.${process.pid}.js`);
const DASHBOARD_STYLES = path.resolve(__dirname, "../styles/input.css");
const DASHBOARD_PACKS = path.resolve(
  __dirname,
  "../../../../../ansible/nairobi-mdms/mdms/dss/DashboardPack.json",
);
const KPI_DEFINITIONS = path.resolve(
  __dirname,
  "../../../../../ansible/nairobi-mdms/mdms/dss/KpiDefinition.json",
);
const EN_MESSAGES = path.resolve(
  __dirname,
  "../../../../../local-setup/db/dss-mdms-seed/l10n/en_IN.json",
);
esbuild.buildSync({
  stdin: {
    contents: `
      import { configurePublicDashboardRuntime } from './dashboardRuntime.js';
      import { authFetch, buildRequestInfo } from './authService.js';
      import { fetchComplaintHierarchyRecords } from './complaintHierarchyService.js';
      import { fetchBoundariesByCodes } from './boundaryService.js';
      export { configurePublicDashboardRuntime, authFetch, buildRequestInfo,
               fetchComplaintHierarchyRecords, fetchBoundariesByCodes };
    `,
    resolveDir: __dirname,
    sourcefile: "public-runtime-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
  },
});
esbuild.buildSync({
  stdin: {
    contents: `
      import { configurePublicDashboardRuntime } from './dashboardRuntime.js';
      import { getLanguage, setLanguage, subscribe, translate, PUBLIC_LOCALE_KEY } from '../i18n/localeRuntime.js';
      import { storageKeyFor, publicStorageKeyFor } from '../utils/layoutStore.js';
      import { getFiltersStorageKey, getLayoutStorageKey } from '../config/dashboardConfig.js';
      export { configurePublicDashboardRuntime, getLanguage, setLanguage, subscribe, translate, PUBLIC_LOCALE_KEY,
               storageKeyFor, publicStorageKeyFor, getFiltersStorageKey, getLayoutStorageKey };
    `,
    resolveDir: __dirname,
    sourcefile: "public-locale-test-entry.js",
    loader: "js",
  },
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: LOCALE_OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_STATE_LEVEL_TENANT_ID": '""',
  },
});
process.on("exit", () => {
  for (const f of [OUT, LOCALE_OUT]) {
    try {
      fs.unlinkSync(f);
    } catch (e) {
      /* already gone */
    }
  }
});

test("public runtime makes shared auxiliary requests anonymous and single-shot", async () => {
  let reads = 0;
  let writes = 0;
  let events = 0;
  const calls = [];
  global.window = {
    globalConfigs: { getConfig: () => "ke" },
    localStorage: {
      getItem: () => { reads += 1; return JSON.stringify("employee-secret"); },
      setItem: () => { writes += 1; },
      removeItem: () => { writes += 1; },
    },
    sessionStorage: {
      getItem: () => null,
      setItem: () => { writes += 1; },
      removeItem: () => { writes += 1; },
    },
    dispatchEvent: () => { events += 1; },
  };
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok: false, status: 401 };
  };
  delete require.cache[require.resolve(OUT)];
  const mod = require(OUT);
  mod.configurePublicDashboardRuntime();

  const requestInfo = mod.buildRequestInfo("public-aux");
  assert.equal(requestInfo.authToken, undefined);
  assert.equal(requestInfo.userInfo, undefined);
  const res = await mod.authFetch("/boundary-service/boundary/_search", {
    buildBody: () => ({ RequestInfo: mod.buildRequestInfo("public-boundary") }),
    sessionCritical: false,
  });

  assert.equal(res.status, 401, "caller owns graceful degradation for auxiliary reads");
  assert.equal(calls.length, 1, "no employee refresh replay");
  assert.equal(calls[0].body.RequestInfo.authToken, undefined);
  assert.equal(calls[0].body.RequestInfo.userInfo, undefined);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(events, 0);
});

test("public auxiliary reads (complaint hierarchy, boundaries) never inspect employee storage", async () => {
  const reads = [];
  global.window = {
    globalConfigs: { getConfig: (key) => ({ STATE_LEVEL_TENANT_ID: "ke", MDMS_V1_CONTEXT_PATH: "mdms-v2" })[key] },
    localStorage: { getItem: (k) => { reads.push(k); return JSON.stringify("employee-secret"); }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: (k) => { reads.push(`session:${k}`); return null; }, setItem() {}, removeItem() {} },
    dispatchEvent() {},
  };
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      json: async () => ({ MdmsRes: { "RAINMAKER-PGR": { ComplaintHierarchy: [{ code: "Roads", name: "Roads" }] } }, Boundary: [] }),
    };
  };
  delete require.cache[require.resolve(OUT)];
  const mod = require(OUT);
  mod.configurePublicDashboardRuntime();

  const records = await mod.fetchComplaintHierarchyRecords();
  await mod.fetchBoundariesByCodes(["W1"]);

  assert.ok(Array.isArray(records) && records.length === 1, "hierarchy is readable anonymously");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.body.RequestInfo.authToken, undefined);
    assert.equal(call.body.RequestInfo.userInfo, undefined);
  }
  assert.deepEqual(reads, [], `employee storage touched: ${reads}`);
});

test("public entry resets the standalone browser viewport", () => {
  const html = fs.readFileSync(PUBLIC_ENTRY, "utf8");
  assert.match(html, /html,\s*body,\s*#root\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0;/s);
  assert.match(html, /body\s*\{[^}]*overflow-x:\s*hidden;/s);
});

test("public-only chrome has seeded localization messages", () => {
  const messages = JSON.parse(fs.readFileSync(EN_MESSAGES, "utf8"));
  const byCode = Object.fromEntries(messages.map(({ code, message }) => [code, message]));
  assert.equal(byCode.DASHBOARD_HEADER_PUBLIC_SUBTITLE, "Public view");
  assert.equal(byCode.DASHBOARD_HEADER_LANGUAGE, "Language");
  assert.equal(byCode.DASHBOARD_PUBLIC_NOT_AVAILABLE_TITLE, "Public dashboard is not available");
  assert.equal(
    byCode.DASHBOARD_PUBLIC_NOT_AVAILABLE_DESCRIPTION,
    "This dashboard has not been enabled for this tenant.",
  );
  for (const message of messages.filter(({ code }) => code.startsWith("DASHBOARD_PUBLIC_"))) {
    assert.equal(message.module, "rainmaker-dashboard");
  }
});

test("public entry omits the employee navigation sidebar but keeps the filter bar and controls (#1797)", () => {
  const source = fs.readFileSync(DASHBOARD_LAYOUT, "utf8");
  assert.match(source, /!embedded\s*&&\s*!publicMode\s*&&\s*<Sidebar/);
  assert.match(source, /publicMode\s*\?\s*" dashboard-public"/);
  assert.match(source, /<DashboardHeader/);
  // The filter bar follows readOnly, never publicMode: the public page must
  // not be able to hide it again by mode alone.
  assert.match(source, /\{!readOnly\s*&&\s*\(\s*<DashboardFilters/);
  assert.doesNotMatch(source, /!publicMode\s*&&\s*\(?\s*<DashboardFilters/);
  // The in-page language switcher mounts for every non-embedded shell.
  assert.match(source, /showLanguageMenu=\{!embedded\}/);

  const admin = fs.readFileSync(ADMIN_DASHBOARD, "utf8");
  assert.match(admin, /readOnly=\{false\}/, "public renders Add KPI / Reset / filters like employee");
  assert.doesNotMatch(admin, /readOnly=\{publicMode\}/);
  assert.doesNotMatch(admin, /isDraggable=\{!publicMode\}/);
  assert.match(admin, /useFilterOptions\(\{\s*enabled:\s*true,\s*publicMode\s*\}\)/);
  assert.match(admin, /buildPublicRefs\(tiles,\s*kpis,\s*filters\)/);
});

test("public language switch and persistence never touch employee storage keys", async () => {
  const writes = [];
  const reads = [];
  global.window = {
    globalConfigs: { getConfig: (key) => ({ STATE_LEVEL_TENANT_ID: "ke", HIERARCHY_TYPE: "REVENUE" })[key] },
    localStorage: {
      getItem: (key) => { reads.push(key); return null; },
      setItem: (key, value) => { writes.push([key, value]); },
      removeItem: (key) => { writes.push([key, null]); },
    },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    dispatchEvent: () => {},
  };
  global.document = { documentElement: {} };
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(url);
    return { ok: true, json: async () => ({ messages: [{ code: "DASHBOARD_HEADER_LANGUAGE", message: "Idioma" }] }) };
  };
  delete require.cache[require.resolve(LOCALE_OUT)];
  const mod = require(LOCALE_OUT);
  mod.configurePublicDashboardRuntime();

  assert.equal(mod.getLanguage(), "en_IN");
  let ticks = 0;
  mod.subscribe(() => { ticks += 1; });
  await mod.setLanguage("pt_PT");

  assert.equal(mod.getLanguage(), "pt_PT");
  assert.equal(mod.translate("DASHBOARD_HEADER_LANGUAGE", "Language"), "Idioma");
  assert.ok(ticks >= 2, "subscribers notified on switch and on bundle arrival");
  assert.equal(global.document.documentElement.lang, "pt");
  assert.deepEqual(writes, [[mod.PUBLIC_LOCALE_KEY, "pt_PT"]]);
  assert.ok(!reads.some((k) => /^Employee\./.test(k)), `employee keys read: ${reads}`);
  // Bundle request follows the tenant's boundary hierarchy, and carries no token.
  assert.match(fetched[0], /module=rainmaker-dashboard%2Crainmaker-pgr%2Crainmaker-common%2Crainmaker-boundary-revenue/);
  assert.match(fetched[0], /locale=pt_PT/);

  // Layout / filter slots live in the public namespace, disjoint from every
  // employee slot (which end in a user uuid / carry no suffix).
  assert.equal(mod.publicStorageKeyFor("ke"), "ccrs.dashboard.catalog-layout.v1.ke.public");
  assert.equal(mod.storageKeyFor("ke", null), null);
  assert.match(mod.getFiltersStorageKey(), /-public$/);
  assert.match(mod.getLayoutStorageKey(), /-public$/);
  delete global.document;
});

test("public grid reflows instead of squeezing desktop columns on small screens", () => {
  const css = fs.readFileSync(DASHBOARD_STYLES, "utf8");
  assert.match(css, /\.dashboard-root\.dashboard-public \.dashboard-grid-layout\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*18rem\),\s*1fr\)\);/);
  assert.match(css, /> \.react-grid-item\s*\{[^}]*position:\s*relative\s*!important;[^}]*transform:\s*none\s*!important;/s);
  assert.match(css, /> \.dashboard-kpi-widget\s*\{[^}]*height:\s*auto\s*!important;/s);
  assert.match(css, /> section\.react-grid-item\s*\{[^}]*height:\s*20rem\s*!important;/s);
  assert.match(css, /\.dashboard-root\.dashboard-public \.dashboard-header-controls\s*\{[^}]*width:\s*auto;[^}]*flex-shrink:\s*0;/s);
});

test("public pack includes only aggregate PUBLIC KPIs and their configured layouts", () => {
  const packs = JSON.parse(fs.readFileSync(DASHBOARD_PACKS, "utf8"));
  const definitions = JSON.parse(fs.readFileSync(KPI_DEFINITIONS, "utf8"));
  const publicPack = packs.find(({ data }) => data?.id === "public-default")?.data;
  const expectedTiles = [
    "cl_new_created_count",
    "cl_resolution_rate_count",
    "cl_reopen_rate_count",
    "cl_open_complaints_live",
    "cl_resolved_date_range_count",
    "cl_chart_complaints_by_type",
    "cl_chart_over_time_created_daily",
    "cl_chart_department_resolution_rate",
  ];
  const expectedInsights = expectedTiles.slice(-3);

  assert.ok(publicPack);
  assert.deepEqual(publicPack.tiles, expectedTiles);
  assert.equal(new Set(publicPack.tiles).size, publicPack.tiles.length);
  assert.deepEqual(
    publicPack.layout.map(({ kpiId }) => kpiId),
    publicPack.tiles,
  );

  const definitionsById = new Map(definitions.map(({ data }) => [data.id, data]));
  for (const kpiId of publicPack.tiles) {
    const definition = definitionsById.get(kpiId);
    assert.ok(definition, `${kpiId} must exist in the KPI catalog`);
    assert.equal(definition.viz?.pii, false, `${kpiId} must remain aggregate-only`);
    assert.ok(definition.rbac?.visibleTo?.includes("PUBLIC"), `${kpiId} must remain PUBLIC`);
    if (expectedInsights.includes(kpiId)) {
      const windowParam = definition.params?.find(({ name }) => name === "window");
      assert.equal(definition.query?.window?.name, "last_30d", `${kpiId} query must cover 30 days`);
      assert.equal(windowParam?.default, "last_30d", `${kpiId} default must cover 30 days`);
    }
  }
});

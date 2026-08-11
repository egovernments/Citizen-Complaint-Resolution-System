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
const DASHBOARD_STYLES = path.resolve(__dirname, "../styles/input.css");
const EN_MESSAGES = path.resolve(
  __dirname,
  "../../../../../local-setup/db/dss-mdms-seed/l10n/en_IN.json",
);
esbuild.buildSync({
  stdin: {
    contents: `
      import { configurePublicDashboardRuntime } from './dashboardRuntime.js';
      import { authFetch, buildRequestInfo } from './authService.js';
      export { configurePublicDashboardRuntime, authFetch, buildRequestInfo };
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
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch (e) {
    /* already gone */
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

test("public entry resets the standalone browser viewport", () => {
  const html = fs.readFileSync(PUBLIC_ENTRY, "utf8");
  assert.match(html, /html,\s*body,\s*#root\s*\{[^}]*margin:\s*0;[^}]*padding:\s*0;/s);
  assert.match(html, /body\s*\{[^}]*overflow-x:\s*hidden;/s);
});

test("public-only chrome has seeded localization messages", () => {
  const messages = JSON.parse(fs.readFileSync(EN_MESSAGES, "utf8"));
  const byCode = Object.fromEntries(messages.map(({ code, message }) => [code, message]));
  assert.equal(byCode.DASHBOARD_HEADER_PUBLIC_SUBTITLE, "Public view");
});

test("public entry omits the employee navigation sidebar", () => {
  const source = fs.readFileSync(DASHBOARD_LAYOUT, "utf8");
  assert.match(source, /!embedded\s*&&\s*!publicMode\s*&&\s*<Sidebar/);
  assert.match(source, /publicMode\s*\?\s*" dashboard-public"/);
  assert.match(source, /<DashboardHeader/);
});

test("public grid reflows instead of squeezing desktop columns on small screens", () => {
  const css = fs.readFileSync(DASHBOARD_STYLES, "utf8");
  assert.match(css, /\.dashboard-root\.dashboard-public \.dashboard-grid-layout\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*18rem\),\s*1fr\)\);/);
  assert.match(css, /> \.react-grid-item\s*\{[^}]*position:\s*relative\s*!important;[^}]*transform:\s*none\s*!important;/s);
});

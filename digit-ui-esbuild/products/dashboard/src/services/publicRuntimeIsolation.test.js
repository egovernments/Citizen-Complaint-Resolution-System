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

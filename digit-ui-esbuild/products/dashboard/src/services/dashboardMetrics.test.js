// State-machine smoke test for dashboardMetrics (#1110).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/services/dashboardMetrics.test.js
//
// dashboardMetrics.js is ESM (like the rest of products/), so the test bundles
// it to CJS with the repo's own esbuild (same define set as esbuild.build.js)
// and reloads it per test for fresh module state — the same
// delete-require-cache idiom as src/theme/applyTheme.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "dashboardMetrics.js");
const OUT = path.join(os.tmpdir(), `dashboardMetrics.cjs.${process.pid}.js`);

esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: "cjs",
  platform: "neutral",
  outfile: OUT,
  define: {
    "process.env.NODE_ENV": '"production"',
    "process.env.REACT_APP_DASHBOARD_METRICS": '""',
    "process.env.REACT_APP_OTEL_BASE": '"/otel"',
    "process.env.REACT_APP_ANALYTICS_BASE": '"/pgr-services/v2/analytics"',
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

/* ------------------------------------------------------------------ */
/* Mocked browser environment with a controllable clock               */
/* ------------------------------------------------------------------ */

let FAKE_NOW = 0;
const rafQueue = [];
const fetchCalls = [];

function setNow(ms) {
  FAKE_NOW = ms;
}

/** Drain requestAnimationFrame callbacks (incl. nested double-rAF). */
function flushRaf() {
  while (rafQueue.length) rafQueue.shift()();
}

function installGlobals() {
  rafQueue.length = 0;
  fetchCalls.length = 0;
  global.performance = {
    now: () => FAKE_NOW,
    timeOrigin: 0,
    getEntriesByType: () => [], // no navigation entry -> every load is a soft nav
  };
  global.window = {
    globalConfigs: { getConfig: () => undefined }, // gate default: ON
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    addEventListener: () => {},
  };
  global.document = { addEventListener: () => {}, visibilityState: "visible" };
  global.navigator = { userAgent: "smoke-test", sendBeacon: () => true };
  global.requestAnimationFrame = (cb) => rafQueue.push(cb);
  // Deferred periphery (PerformanceObserver / listeners / 60s timer) must not
  // start in tests: park the idle callback without ever invoking it.
  global.requestIdleCallback = () => {};
  global.PerformanceObserver = class {
    observe() {}
  };
  global.fetch = (url, opts) => {
    fetchCalls.push({ url, body: opts && opts.body });
    return Promise.resolve({ ok: true, status: 200 });
  };
}

function loadFreshModule() {
  installGlobals();
  delete require.cache[require.resolve(OUT)];
  return require(OUT);
}

function histValues(m, name) {
  return m._inspect().pending.hist[name] || [];
}

/* ------------------------------------------------------------------ */
/* Load lifecycle                                                     */
/* ------------------------------------------------------------------ */

test("load marks are one-shot and post-paint; error/'No data' path still marks first widget", () => {
  const m = loadFreshModule();
  setNow(0);
  m.beginLoad();
  m.markBatchStart(1);
  m.markFirstWidgetVisible(); // e.g. an error tile painting
  setNow(400);
  flushRaf();
  m.markFirstWidgetVisible(); // repeat: no-op
  setNow(450);
  flushRaf();
  assert.deepEqual(histValues(m, "dashboard.first_widget_visible.ms"), [400]);

  m.markAllWidgetsReady(2, 1);
  setNow(500);
  flushRaf();
  m.markAllWidgetsReady(9, 1); // repeat: no-op for the load mark
  flushRaf();
  assert.deepEqual(histValues(m, "dashboard.all_widgets_ready.ms"), [500]);
  assert.equal(m._inspect().pending.sums["dashboard.error_widgets.count"], 2);
  assert.equal(m._inspect().load.errorWidgets, 2);
});

test("mark-before-begin buffers and reconciles at beginLoad", () => {
  const m = loadFreshModule();
  setNow(300);
  m.markFirstWidgetVisible(); // no load ctx yet -> buffered
  assert.deepEqual(histValues(m, "dashboard.first_widget_visible.ms"), []);
  setNow(1000);
  m.beginLoad(); // soft nav: t0 = 1000; buffered mark clamps to >= 0
  assert.deepEqual(histValues(m, "dashboard.first_widget_visible.ms"), [0]);
  assert.equal(m._inspect().load.firstWidgetMs, 0);
});

/* ------------------------------------------------------------------ */
/* Interaction-window state machine (R6)                              */
/* ------------------------------------------------------------------ */

/** beginLoad + settle the initial batch so the load one-shots are consumed. */
function settleInitialLoad(m) {
  setNow(0);
  m.beginLoad();
  m.markBatchStart(1);
  m.markAllWidgetsReady(0, 1);
  setNow(100);
  flushRaf();
}

test("intent alone opens no window; expired intent (>5s) is dropped at batch start", () => {
  const m = loadFreshModule();
  settleInitialLoad(m);

  setNow(1000);
  m.markInteraction("filter");
  assert.equal(m._inspect().interactionWindow, null); // intent != window
  assert.equal(m._inspect().pendingIntent.kind, "filter");

  setNow(6100); // 5.1s later — intent expired
  m.markBatchStart(2);
  assert.equal(m._inspect().interactionWindow, null);
  assert.equal(m._inspect().pendingIntent, null); // consumed (dropped)
  m.markAllWidgetsReady(0, 2);
  setNow(6200);
  flushRaf();
  assert.deepEqual(histValues(m, "dashboard.filter_apply.ms"), []);
});

test("window opens on a real new reqId, closes on the SAME reqId, measures from the last intent", () => {
  const m = loadFreshModule();
  settleInitialLoad(m);

  setNow(10000);
  m.markInteraction("filter");
  setNow(10400);
  m.markInteraction("filter"); // repeat intent resets the timestamp
  setNow(11000);
  m.markBatchStart(2);
  const win = m._inspect().interactionWindow;
  assert.equal(win.reqId, 2);
  assert.equal(win.startTs, 10400);

  m.markAllWidgetsReady(0, 999); // wrong reqId: does not close
  flushRaf();
  assert.ok(m._inspect().interactionWindow);

  m.markAllWidgetsReady(0, 2);
  setNow(12900); // post-paint timestamp
  flushRaf();
  assert.equal(m._inspect().interactionWindow, null);
  assert.deepEqual(histValues(m, "dashboard.filter_apply.ms"), [2500]); // 12900 - 10400
  const logs = m._inspect().pending.logs.map((l) => l.body.stringValue);
  assert.ok(logs.includes("dashboard.interaction"));
});

test("a superseding batch discards the open window; its own settle records nothing", () => {
  const m = loadFreshModule();
  settleInitialLoad(m);

  setNow(20000);
  m.markInteraction("filter");
  setNow(20500);
  m.markBatchStart(2); // window opens for reqId 2
  assert.equal(m._inspect().interactionWindow.reqId, 2);

  setNow(21000);
  m.markBatchStart(3); // superseding batch (no pending intent) — discard
  assert.equal(m._inspect().interactionWindow, null);

  m.markAllWidgetsReady(0, 2); // stale batch (real caller is guarded, belt+braces)
  m.markAllWidgetsReady(0, 3); // superseding batch settles
  setNow(21400);
  flushRaf();
  assert.deepEqual(histValues(m, "dashboard.filter_apply.ms"), []);
});

test("dangling window past the 30s absolute expiry is discarded, not recorded", () => {
  const m = loadFreshModule();
  settleInitialLoad(m);

  setNow(30000);
  m.markInteraction("persona");
  setNow(30100);
  m.markBatchStart(2);
  assert.equal(m._inspect().interactionWindow.kind, "persona");

  setNow(61000); // 30.9s after open
  m.markAllWidgetsReady(0, 2);
  flushRaf();
  assert.equal(m._inspect().interactionWindow, null);
  assert.deepEqual(histValues(m, "dashboard.persona_switch.ms"), []);
});

/* ------------------------------------------------------------------ */
/* Tag helpers                                                        */
/* ------------------------------------------------------------------ */

test("uaFamily and recordCountTier bucket correctly", () => {
  const m = loadFreshModule();
  assert.equal(
    m.uaFamily(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0"
    ),
    "Edge"
  );
  assert.equal(
    m.uaFamily("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Chrome"
  );
  assert.equal(m.uaFamily("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0"), "Firefox");
  assert.equal(
    m.uaFamily(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
    ),
    "Safari"
  );
  assert.equal(
    m.uaFamily(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
    ),
    "Chrome+mobile"
  );
  assert.equal(m.uaFamily("curl/8.6.0"), "Other");

  assert.equal(m.recordCountTier(null), "unknown");
  assert.equal(m.recordCountTier(0), "lt10k");
  assert.equal(m.recordCountTier(9999), "lt10k");
  assert.equal(m.recordCountTier(10000), "10k-50k");
  assert.equal(m.recordCountTier(50000), "50k-100k");
  assert.equal(m.recordCountTier(100000), "gt100k");
});

/* ------------------------------------------------------------------ */
/* OTLP envelope shape (via flush)                                    */
/* ------------------------------------------------------------------ */

test("flush sends TWO separate OTLP payloads with delta temporality + datapoint attributes", async () => {
  const m = loadFreshModule();
  settleInitialLoad(m);
  // Give the pending set a log record too (interaction round-trip).
  setNow(1000);
  m.markInteraction("filter");
  setNow(1100);
  m.markBatchStart(2);
  m.markAllWidgetsReady(0, 2);
  setNow(1600);
  flushRaf();

  m.flush("test");
  await new Promise((r) => setTimeout(r, 0)); // let the fetch promises settle
  assert.equal(fetchCalls.length, 2);
  const metricsCall = fetchCalls.find((c) => c.url === "/otel/v1/metrics");
  const logsCall = fetchCalls.find((c) => c.url === "/otel/v1/logs");
  assert.ok(metricsCall && logsCall, "one POST per signal");

  const metrics = JSON.parse(metricsCall.body);
  assert.ok(metrics.resourceMetrics && !metrics.resourceLogs, "metrics payload is resourceMetrics only");
  const rm = metrics.resourceMetrics[0];
  assert.deepEqual(rm.resource.attributes, [
    { key: "service.name", value: { stringValue: "dashboard-web" } },
  ]);
  const all = rm.scopeMetrics[0].metrics;
  const hist = all.find((x) => x.name === "dashboard.all_widgets_ready.ms");
  assert.equal(hist.histogram.aggregationTemporality, 1); // DELTA
  const dp = hist.histogram.dataPoints[0];
  assert.equal(dp.count, "1");
  assert.equal(dp.explicitBounds.length, 9);
  assert.equal(dp.bucketCounts.length, 10);
  const tagKeys = dp.attributes.map((a) => a.key).sort();
  assert.deepEqual(tagKeys, [
    "layout_id",
    "nav_type",
    "persona",
    "record_count_tier",
    "tenant",
    "ua_family",
  ]);
  const filterHist = all.find((x) => x.name === "dashboard.filter_apply.ms");
  assert.equal(filterHist.histogram.dataPoints[0].sum, 600); // paint 1600 - intent 1000

  const logs = JSON.parse(logsCall.body);
  assert.ok(logs.resourceLogs && !logs.resourceMetrics, "logs payload is resourceLogs only");
  const records = logs.resourceLogs[0].scopeLogs[0].logRecords;
  assert.ok(records.some((r) => r.body.stringValue === "dashboard.interaction"));
  const withTrace = records.find((r) => r.traceId);
  assert.match(withTrace.traceId, /^[0-9a-f]{32}$/);

  // successful send clears pending
  assert.deepEqual(m._inspect().pending.logs, []);
  assert.deepEqual(Object.keys(m._inspect().pending.hist), []);
});

/* ------------------------------------------------------------------ */
/* Beacon backstop (pagehide)                                         */
/* ------------------------------------------------------------------ */

/** Settle a load + one interaction so pending holds hist, sums AND logs. */
function seedPendingSignals(m) {
  setNow(0);
  m.beginLoad();
  m.markBatchStart(1);
  m.markAllWidgetsReady(1, 1); // errorCount=1 -> a pending sum too
  setNow(100);
  flushRaf();
  setNow(1000);
  m.markInteraction("filter");
  setNow(1100);
  m.markBatchStart(2);
  m.markAllWidgetsReady(0, 2);
  setNow(1600);
  flushRaf();
}

test("flushWithBeacon restores per payload: metrics delivered + logs failed re-queues ONLY the logs", () => {
  const m = loadFreshModule();
  seedPendingSignals(m);
  assert.ok(Object.keys(m._inspect().pending.hist).length > 0);
  assert.ok(m._inspect().pending.logs.length > 0);

  const beaconCalls = [];
  global.navigator.sendBeacon = (url) => {
    beaconCalls.push(url);
    return url === "/otel/v1/metrics"; // metrics beacon lands, logs beacon fails
  };
  m.flushWithBeacon("pagehide");
  assert.deepEqual(beaconCalls, ["/otel/v1/metrics", "/otel/v1/logs"]);

  // metrics (hist + sums) must NOT come back — they were delivered
  assert.deepEqual(Object.keys(m._inspect().pending.hist), []);
  assert.deepEqual(Object.keys(m._inspect().pending.sums), []);
  // the failed logs payload is restored for the next flush
  assert.ok(m._inspect().pending.logs.length > 0);
});

test("flushWithBeacon restores everything when both beacons fail", () => {
  const m = loadFreshModule();
  seedPendingSignals(m);
  const hist = Object.keys(m._inspect().pending.hist).sort();
  const logsCount = m._inspect().pending.logs.length;

  global.navigator.sendBeacon = () => false;
  m.flushWithBeacon("pagehide");

  assert.deepEqual(Object.keys(m._inspect().pending.hist).sort(), hist);
  assert.equal(m._inspect().pending.logs.length, logsCount);
});

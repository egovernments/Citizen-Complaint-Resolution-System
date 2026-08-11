// Characterizes the legacy KpiTile result adapters after their behavior-neutral extraction.
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/utils/tileResultAdapters.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle(entry) {
  const out = path.join(os.tmpdir(), `${path.basename(entry, ".js")}.cjs.${process.pid}.js`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    format: "cjs",
    platform: "neutral",
    outfile: out,
  });
  process.on("exit", () => {
    try {
      fs.unlinkSync(out);
    } catch (error) {
      /* already gone */
    }
  });
  return require(out);
}

const adapters = bundle("tileResultAdapters.js");

test("column inference preserves typed-column precedence and viz fallbacks", () => {
  const typed = {
    columns: [
      { name: "ward_code", role: "dimension" },
      { name: "total", role: "measure", format: "integer" },
    ],
  };
  const conflictingViz = { dimensionKey: "service_code", measureKey: "count" };
  assert.equal(adapters.primaryDimensionKey(typed, conflictingViz), "ward_code");
  assert.equal(adapters.primaryMeasure(typed, conflictingViz).name, "total");

  // The current backend emits string columns, so the renderer deliberately
  // falls back to the catalog descriptor instead of inferring roles.
  const strings = { columns: ["ward_code", "total"] };
  assert.equal(adapters.primaryDimensionKey(strings, conflictingViz), "service_code");
  assert.equal(adapters.primaryMeasure(strings, conflictingViz).name, "count");
});

test("scalar, prior, percent normalization, delta modes, and threshold boundaries stay exact", () => {
  assert.equal(
    adapters.resolveScalar({
      viz: { valueKey: "total" },
      result: { value: 9, values: { total: 8 }, rows: [{ total: 7 }] },
    }),
    9
  );
  assert.equal(
    adapters.resolveScalar({ viz: { valueKey: "total" }, result: { rows: [{ total: "7" }] } }),
    7
  );
  assert.equal(
    adapters.resolveScalar({
      viz: {
        valueKey: "total",
        compose: { type: "netBacklogDaily", sourceKpiIds: ["in", "out"] },
      },
      result: { value: 99 },
      results: { in: { rows: [{ total: 12 }] }, out: { rows: [{ total: 5 }] } },
    }),
    7,
    "the legacy FE compose result still precedes the pre-shaped scalar"
  );
  assert.equal(
    adapters.resolvePrior({ viz: { priorKey: "previous" }, result: { values: { previous: "4" } } }),
    4
  );
  assert.equal(adapters.normalizePct(0.75), 75);
  assert.equal(adapters.normalizePct(1), 100);
  assert.equal(adapters.normalizePct(1.01), 1.01);
  assert.equal(adapters.computeDelta(0.8, 0.7, "percentOneDecimal"), 10);
  assert.equal(adapters.computeDelta(120, 100, "integer"), 20);
  assert.equal(adapters.computeDelta(120, 0, "integer"), null);
  assert.equal(adapters.computeDelta(172800000, 86400000, "hoursDays", "days"), 1);
  assert.equal(adapters.formatDeltaDisplay(1, "hoursDays", "days"), "▲ 1 day");

  const highGood = { kind: "percent", higherIsBetter: true, onTrack: 85, breaching: 60 };
  assert.equal(adapters.thresholdStatus(highGood, 0.85), "on_track");
  assert.equal(adapters.thresholdStatus(highGood, 0.6), "breaching");
  assert.equal(adapters.thresholdStatus(highGood, 0.7), "normal");
  assert.equal(adapters.resolveTileStatus({ accent: "amber" }, 5), "amber");
});

test("sparkline, bar, histogram, ranked-list, and DOW adapters preserve ordering rules", () => {
  assert.deepEqual(
    adapters.resolveSparkline({
      viz: { dateKey: "created_date", sparklineMeasureKey: "total" },
      result: {
        rows: [
          { created_date: "2026-01-02", total: "2" },
          { created_date: "2026-01-01", total: "1" },
        ],
      },
    }),
    [1, 2]
  );

  const barResult = {
    columns: [
      { name: "bucket", role: "dimension" },
      { name: "pct", role: "measure" },
    ],
    rows: [
      { bucket: "low", pct: 0.1 },
      { bucket: "high", pct: 0.8 },
      { bucket: "mid", pct: 0.4 },
    ],
  };
  assert.deepEqual(
    adapters.adaptBarRows({ viz: { kind: "bar", format: "percent" }, result: barResult }),
    [
      { label: "high", count: 80 },
      { label: "mid", count: 40 },
      { label: "low", count: 10 },
    ]
  );
  assert.deepEqual(
    adapters.adaptBarRows({
      viz: { kind: "histogram", categoryOrder: ["low", "mid", "high"] },
      result: barResult,
    }).map((row) => row.label),
    ["low", "mid", "high"]
  );

  const simple = {
    columns: [
      { name: "label", role: "dimension" },
      { name: "total", role: "measure", format: "integer" },
    ],
    rows: [{ label: "B", total: 2 }, { label: "A", total: 5 }],
  };
  assert.deepEqual(adapters.adaptRanked({ viz: { limit: 1 }, result: simple }).rows, [
    { label: "A", value: 5 },
  ]);
  assert.deepEqual(
    adapters.adaptDow({ viz: {}, result: { ...simple, rows: [{ label: "2", total: "3" }] } }).rows,
    [{ dow: 2, value: 3 }]
  );
});

test("horizontal-bar adapter preserves grouped ratio math, filtering, ascending sort, and limit", () => {
  const result = {
    rows: [
      { department_code: "A", filed: 5, resolved: 2 },
      { department_code: "A", filed: 5, resolved: 3 },
      { department_code: "B", filed: 4, resolved: 1 },
      { department_code: "C", filed: 0, resolved: 2 },
    ],
  };
  const rows = adapters.adaptHorizontalRows({
    viz: {
      dimensionKey: "department_code",
      measureKey: "resolved",
      numeratorKey: "resolved",
      denominatorKey: "filed",
      limit: 2,
    },
    result,
  });
  assert.deepEqual(rows, [
    { label: "B", value: 0.25, resolved: 1, created: 4 },
    { label: "A", value: 0.5, resolved: 5, created: 10 },
  ]);
});

test("stacked and line adapters preserve BE-shaped passthrough and long-form pivots", () => {
  const passthrough = {
    categories: ["A"],
    series: [{ name: "Total", data: [3] }],
    colors: ["red"],
  };
  assert.deepEqual(
    adapters.adaptStacked({ viz: {}, result: passthrough }),
    passthrough
  );

  const pivoted = adapters.adaptStacked({
    viz: {
      dimensionKey: "service_code",
      stackKey: "application_status",
      measureKey: "total",
      stackSeries: [
        { key: "OPEN", label: "Open", color: "orange" },
        { key: "CLOSED", label: "Closed", color: "green" },
      ],
    },
    result: {
      rows: [
        { service_code: "A", application_status: "open", total: 2 },
        { service_code: "A", application_status: "closed", total: 3 },
        { service_code: "B", application_status: "open", total: 6 },
      ],
    },
  });
  assert.deepEqual(pivoted.categories, ["B", "A"]);
  assert.deepEqual(pivoted.series.map((series) => series.data), [[6, 2], [0, 3]]);

  const linePassthrough = { categories: ["d1"], series: [{ name: "Filed", data: [4] }] };
  assert.deepEqual(adapters.adaptLine({ viz: {}, result: linePassthrough }), linePassthrough);
  const computedLine = adapters.adaptLine({
    viz: {
      dimensionKey: "date",
      seriesDefs: [{ name: "Rate", numeratorKey: "resolved", denominatorKey: "filed" }],
    },
    result: { rows: [{ date: "2026-01-02", filed: 4, resolved: 3 }] },
  });
  assert.deepEqual(computedLine.series[0].data, [75]);
});

test("pie channel rollup preserves source taxonomy, colors, zero filtering, and order", () => {
  const data = adapters.adaptPie({
    viz: {
      dimensionKey: "source",
      measureKey: "total",
      channelMap: [
        { id: "web", label: "Web", color: "blue", sources: ["web", "online-portal"] },
        { id: "phone", label: "Phone", color: "green", sources: ["phone"] },
        { id: "other", label: "Other", color: "gray", sources: [] },
      ],
    },
    result: {
      rows: [
        { source: "ONLINE_PORTAL", total: 3 },
        { source: "web", total: 2 },
        { source: "walk_in", total: 4 },
        { source: "phone", total: 0 },
      ],
    },
  });
  assert.deepEqual(data, [
    { label: "Web", count: 5, color: "blue" },
    { label: "Other", count: 4, color: "gray" },
  ]);
});

test("table, SLA-risk, and map adapters preserve their current domain row contracts", () => {
  assert.deepEqual(
    adapters.deriveColumnsFromResult({
      columns: [
        { name: "service_code", role: "dimension", label: "Subtype" },
        { name: "pct", role: "measure", format: "percentOneDecimal" },
      ],
    }),
    [
      { id: "service_code", label: "Subtype", labelKey: undefined, align: "left", type: "text", thresholdKey: undefined },
      { id: "pct", label: "pct", labelKey: undefined, align: "right", type: "percent", thresholdKey: undefined },
    ]
  );

  const riskRows = adapters.adaptSlaRiskRows({
    viz: { limit: 1 },
    result: {
      rows: [
        {
          service_request_id: "CR-1",
          service_code: "road",
          service_group: "works",
          ward_code: "W1",
          application_status: "PENDINGATLME",
          sla_status_bucket: "breached",
          current_assignee_uuid: null,
          open_age_ms: 10800000,
          sla_target_ms: 3600000,
        },
        { service_request_id: "", sla_status_bucket: "breached" },
      ],
    },
  });
  assert.equal(riskRows.length, 1);
  assert.equal(riskRows[0].id, "CR-1");
  assert.equal(riskRows[0].status, "assigned");
  assert.equal(riskRows[0].slaLevel, "breached");
  assert.equal(riskRows[0].breachDurationMs, 7200000);

  const layers = adapters.adaptMapLayers({
    viz: { dimensionKey: "ward_code" },
    result: {
      rows: [
        { ward_code: "W1", filed: 10, open: 4, resolved: 5 },
        { ward_code: null, filed: 2, open: 1, resolved: 1 },
      ],
      pinsStatusKnown: true,
      pinsTruncated: true,
      pins: [
        { id: "o", isOpen: true, isResolved: false },
        { id: "r", isOpen: false, isResolved: true },
      ],
    },
  });
  assert.equal(layers.pinSemantics, "per-layer");
  assert.equal(layers.pinsTruncated, true);
  assert.deepEqual(layers.open.map((row) => row.wardCode), ["W1"]);
  assert.deepEqual(layers.layerTotals, { filed: 10, open: 4, resolved: 5 });
  assert.deepEqual(layers.unmapped, { filed: 2, open: 1, resolved: 1 });
  assert.deepEqual(layers.complaintPinsByLayer.open.map((pin) => pin.id), ["o"]);
  assert.deepEqual(layers.complaintPinsByLayer.resolved.map((pin) => pin.id), ["r"]);
});

test("format and ABAC error-label boundaries remain stable", () => {
  assert.equal(adapters.applyFormat(null, "integer", "en-US"), "—");
  assert.equal(adapters.applyFormat(0.425, "percentOneDecimal", "en-US"), "42.5%");
  assert.equal(adapters.applyFormat(3600000, "hoursDecimal", "en-US"), "1.0h");
  assert.equal(adapters.errorLabel("pii_forbidden"), "Restricted");
  assert.equal(adapters.errorLabel("kpi_forbidden"), "No access");
  assert.equal(adapters.errorLabel("scope_forbidden"), "Out of scope");
  assert.equal(adapters.errorLabel("query_failed"), "query_failed");
});

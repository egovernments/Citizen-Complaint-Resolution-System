// The dashboard export writes what each tile shows (#1977).
//
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/export/dashboardExport.test.js
//
// For every KPI in the catalog (ansible/nairobi-mdms/mdms/dss/KpiDefinition.json)
// it builds a result from the KPI's own query and viz keys, renders the tile
// with ReactDOMServer, builds the export from the same result, and checks:
//   - card values, deltas and subtitles in the export are the text the card shows;
//   - table cells in the export are the text the table shows, in its order;
//   - every numeric cell's Excel format prints its text back;
//   - all of it under no number mask, an English mask and a Portuguese mask.
// It then writes the workbook with the real ExcelJS and reads it back.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");
const ExcelJS = require("exceljs");

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const CATALOG = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "ansible/nairobi-mdms/mdms/dss/KpiDefinition.json"), "utf8")
).map((record) => record.data);

const ENTRY = `
import React from "react";
import ReactDOMServer from "react-dom/server";
import KpiTile from "../components/KpiTile.jsx";
export { buildDashboardExport, sheetName } from "./exportModel";
export { buildWorkbook } from "./writeXlsx";
export { numberCell } from "./exportCells";
export { setNumberFormatMask } from "../utils/numberFormat";
export { resolveTitle, resolveSubtitle } from "../i18n/textResolver";
export const renderTile = (props) =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(KpiTile, props));
`;

// Chart and map libraries need a browser; the parity checks only read card
// and table markup, so they render nothing here. (buildSync takes no
// plugins, hence an alias to a stub package; it also answers
// "leaflet/dist/leaflet.css".)
const STUB = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-export-stub-"));
fs.mkdirSync(path.join(STUB, "dist"));
fs.writeFileSync(path.join(STUB, "index.js"), "module.exports = function Stub() { return null; }; module.exports.default = module.exports;\n");
fs.writeFileSync(path.join(STUB, "dist", "leaflet.css"), "");

function bundle() {
  const out = path.join(os.tmpdir(), `dashboard-export.${process.pid}.cjs.js`);
  esbuild.buildSync({
    stdin: { contents: ENTRY, resolveDir: __dirname, loader: "jsx", sourcefile: "export-entry.jsx" },
    bundle: true,
    format: "cjs",
    platform: "node",
    loader: { ".jsx": "jsx", ".js": "jsx", ".css": "empty" },
    alias: { "react-apexcharts": STUB, leaflet: STUB },
    outfile: out,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  process.on("exit", () => {
    try {
      fs.unlinkSync(out);
      fs.rmSync(STUB, { recursive: true, force: true });
    } catch (e) {
      /* already gone */
    }
  });
  return require(out);
}

const {
  buildDashboardExport,
  sheetName,
  buildWorkbook,
  numberCell,
  setNumberFormatMask,
  resolveTitle,
  resolveSubtitle,
  renderTile,
} = bundle();

// The host i18next the employee app provides: no seeded messages, so every
// label is its English fallback, and the language is fixed. Set after the
// bundle loads: a window present at load sends React's scheduler down its
// browser path, whose MessageChannel keeps node from exiting.
globalThis.window = { i18next: { language: "en_IN", exists: () => false, t: (key) => key } };

/* ------------------------------------------------------------------ */
/* Results built from each KPI's own keys                              */
/* ------------------------------------------------------------------ */

const HOUR = 3600000;
const DAY = 86400000;
const CARD_KINDS = new Set(["number-tile-delta", "scalar", "number-tile", "number-tile-sparkline", "sparkline-card"]);
const TABLE_KINDS = new Set(["table", "data-table"]);

function measureValue(name, i, j = 0) {
  if (name === "sla_target_ms") return [HOUR, HOUR, DAY][i];
  if (/_ms$/.test(name)) return [58391.9, 2.5 * HOUR, 143.3 * DAY][i];
  if (/rate|ratio|pct/.test(name)) return [0.1381, 0.0262, 1][i];
  if (/csat|rating/.test(name)) return [4, 3.5, 4.25][i];
  return [2033, 17, 5][i] + j;
}

function dimensionValue(name, i, viz) {
  if (viz.stackKey === name && viz.stackSeries?.length) return viz.stackSeries[i % viz.stackSeries.length].key;
  if (/date/.test(name)) return `2026-10-0${i + 1}`;
  if (name === "aging_bucket") return (viz.categoryOrder || ["<1d", "1-3d", "3-7d"])[i];
  if (name === "source") return ["web", "app", "ivr"][i];
  if (name === "service_request_id") return `PGR-2026-10-15-00000${i}`;
  if (name === "sla_status_bucket") return ["breached", "approaching", "within"][i];
  if (name === "current_assignee_uuid") return `4f1c2d3e-0000-0000-0000-00000000000${i}`;
  if (name === "application_status") return "PENDINGATLME";
  return `${name.toUpperCase()}_${i + 1}`;
}

/** A card's value and prior, in the unit its format expects. */
function cardValues(format, key) {
  if (/^percent/.test(format)) return [0.1381, 0.0262];
  if (format === "ratingOutOfFive") return [4, 3.5];
  if (format === "decimalTwo") return [1.2345, 1.1];
  if (format === "hoursDays") return /oldest/.test(key) ? [143.3 * DAY, 3 * DAY] : [58391.9, 2.5 * HOUR];
  return [2033, 1800];
}

function keysOf(def) {
  const viz = def.viz || {};
  const query = def.query || {};
  const dims = [...(query.dimensions || [])];
  for (const key of [viz.dimensionKey, viz.stackKey]) if (key && !dims.includes(key)) dims.push(key);
  const measures = new Set((query.measures || []).map((m) => m.name));
  const add = (key) => key && !dims.includes(key) && measures.add(key);
  [viz.measureKey, viz.valueKey, viz.numeratorKey, viz.denominatorKey, ...(viz.measureKeys || [])].forEach(add);
  for (const s of viz.seriesDefs || []) [s.measureKey, s.numeratorKey, s.denominatorKey].forEach(add);
  for (const col of viz.columns || []) if (col.type !== "trend" && !dims.includes(col.id)) add(col.id);
  return { dims, measures: [...measures] };
}

/** The result object AdminDashboard hands KpiTile (assembleResult) for this KPI. */
function resultFor(def) {
  const viz = def.viz || {};
  const { dims, measures } = keysOf(def);
  const columns = [
    ...dims.map((name) => ({ name, role: "dimension" })),
    ...measures.map((name) => ({ name, role: "measure" })),
  ];
  const row = (i, shift = 0) => {
    const r = {};
    dims.forEach((name) => (r[name] = dimensionValue(name, i, viz)));
    measures.forEach((name, j) => (r[name] = measureValue(name, i, j) + shift));
    return r;
  };
  const rows = [0, 1, 2].map((i) => row(i));
  const assembled = { columns, rows, asOf: Date.UTC(2026, 9, 15, 9, 46) };
  if (CARD_KINDS.has(viz.kind)) {
    const [value, prior] = cardValues(viz.format, viz.valueKey || measures[0]);
    assembled.rows = [rows[0]];
    assembled.value = value;
    assembled.prior = prior;
    if (viz.kind.includes("sparkline")) assembled.sparkline = [3, 5, 4];
  }
  if (viz.comparison?.period === "prior") assembled.priorRows = [0, 1, 2].map((i) => row(i, -1));
  return assembled;
}

const KPIS = Object.fromEntries(CATALOG.map((def) => [def.id, def]));
const RESULTS = Object.fromEntries(CATALOG.map((def) => [def.id, resultFor(def)]));
const NOW = Date.UTC(2026, 9, 16, 10, 30);

function exportAll({ errors = {}, loading = false, results = RESULTS } = {}) {
  return buildDashboardExport({
    tiles: CATALOG.map((def) => def.id),
    kpis: KPIS,
    results,
    assemble: (kpiId) => results[kpiId] ?? null,
    errorFor: (kpiId) => errors[kpiId] ?? null,
    loading,
    groupByFor: () => null,
    asOf: Date.UTC(2026, 9, 15, 9, 46),
    filters: { dateFrom: "2026-09-15", dateTo: "2026-10-15", dateRangeActive: true, geography: "all", complaintType: "all" },
    filterOptions: null,
    timeZone: "Africa/Nairobi",
    language: "en_IN",
    tenantId: "acme",
    productLabel: "Complaint Resolution",
    publicMode: false,
    now: NOW,
  });
}

/* ------------------------------------------------------------------ */
/* Reading the rendered tile                                           */
/* ------------------------------------------------------------------ */

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decodeHtml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

/** Body cell texts of a rendered table, row by row. */
function tableCells(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decodeHtml(c[1].replace(/<[^>]+>/g, ""))))
    .filter((cells) => cells.length > 0);
}

const render = (def) => renderTile({ def, result: RESULTS[def.id], results: RESULTS, loading: false });
// Summary rows follow the tile order (two catalog KPIs share a title), and a
// chart's row links its sheet.
const summaryRowFor = (model, def) => model.sheets[0].rows[CATALOG.indexOf(def)];
const sheetFor = (model, def) => model.sheets.find((s) => s.name === summaryRowFor(model, def)[1].sheet);

/** What Excel prints for a value in one of the formats numberCell writes. */
function excelText(value, numFmt, { group, decimal }) {
  const m = numFmt.match(/^(?:"([^"]*)")?(#,##0|0)(?:\.(0+))?(%?)(?:"([^"]*)")?$/);
  assert.ok(m, `unexpected number format ${numFmt}`);
  const [, prefix = "", integer, fraction = "", percent, suffix = ""] = m;
  const n = percent ? value * 100 : value;
  let [int, frac] = Math.abs(n).toFixed(fraction.length).split(".");
  if (integer === "#,##0") int = int.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${prefix}${n < 0 ? "-" : ""}${int}${frac ? decimal + frac : ""}${percent}${suffix}`;
}

/* ------------------------------------------------------------------ */
/* Parity, under each number mask                                      */
/* ------------------------------------------------------------------ */

const MASKS = [
  { name: "no mask", mask: null, seps: { group: ",", decimal: "." } },
  { name: "English mask", mask: "#,##0.00", seps: { group: ",", decimal: "." } },
  { name: "Portuguese mask", mask: "#.##0,00", seps: { group: ".", decimal: "," } },
];

for (const { name, mask, seps } of MASKS) {
  test(`${name}: every catalog KPI is exported, in order, as its tile shows it`, () => {
    setNumberFormatMask(mask);
    try {
      const model = exportAll();
      const summary = model.sheets[0];
      assert.equal(summary.rows.length, CATALOG.length, "one summary row per tile");
      assert.deepEqual(summary.rows.map((r) => r[0].text), CATALOG.map((def) => resolveTitle(def)));
      assert.equal(model.sheets.length, 1 + CATALOG.filter((def) => !CARD_KINDS.has(def.viz.kind)).length);

      for (const def of CATALOG) {
        const kind = def.viz.kind;
        const row = summaryRowFor(model, def);
        if (CARD_KINDS.has(kind)) {
          const html = render(def);
          const [, value, change, description] = row;
          assert.ok(html.includes(`>${escapeHtml(value.text)}<`), `${def.id}: card shows ${value.text}`);
          if (change.text) assert.ok(html.includes(`>${escapeHtml(change.text)}<`), `${def.id}: card shows ${change.text}`);
          const subtitle = resolveSubtitle(def.viz);
          if (kind.includes("sparkline")) {
            assert.equal(description.text, "", `${def.id}: sparkline cards show no subtitle`);
          } else if (subtitle) {
            assert.equal(description.text, subtitle);
            assert.ok(html.includes(`>${escapeHtml(subtitle)}<`), `${def.id}: card shows its subtitle`);
          }
          assert.notEqual(value.numFmt, undefined, `${def.id}: ${value.text} is written as a number`);
          continue;
        }

        const sheet = sheetFor(model, def);
        assert.ok(sheet, `${def.id} has a sheet`);
        assert.deepEqual(row[1], { text: sheet.name, sheet: sheet.name }, `${def.id}: summary links its sheet`);
        assert.ok(!sheet.message, `${def.id}: ${sheet.message}`);
        assert.ok(sheet.rows.length > 0, `${def.id} exports rows`);
        for (const cells of sheet.rows) assert.equal(cells.length, sheet.columns.length, `${def.id}: row width`);

        if (TABLE_KINDS.has(kind) || kind === "sla-risk-table") {
          const shown = tableCells(render(def));
          assert.deepEqual(sheet.rows.map((cells) => cells.map((c) => c.text)), shown, `${def.id}: table cells`);
        }
      }

      for (const sheet of model.sheets) {
        for (const cells of sheet.rows || []) {
          for (const cell of cells) {
            if (cell.numFmt === undefined) continue;
            assert.equal(excelText(cell.value, cell.numFmt, seps), cell.text, `${sheet.name}: ${cell.numFmt}`);
          }
        }
      }
    } finally {
      setNumberFormatMask(null);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Cards in detail                                                     */
/* ------------------------------------------------------------------ */

test("rates, durations and ratings are exported as shown, not as raw values", () => {
  const model = exportAll();
  const cell = (id) => summaryRowFor(model, KPIS[id])[1];
  assert.deepEqual(cell("cl_resolution_rate_count"), { text: "13.8%", value: 0.138, numFmt: "0.0%" });
  assert.deepEqual(cell("cl_avg_resolution_time"), { text: "0 hrs", value: 0, numFmt: '0" hrs"' });
  assert.deepEqual(cell("cl_csat_avg"), { text: "4.0/5", value: 4, numFmt: '0.0"/5"' });
  assert.deepEqual(cell("cl_new_created_count"), { text: "2,033", value: 2033, numFmt: "#,##0" });
});

test("a failed tile exports its error and a loading tile says so", () => {
  const errors = { cl_csat_avg: { code: "kpi_forbidden", message: "Your role can't see this KPI" } };
  const results = { ...RESULTS, cl_reopen_rate_count: undefined, cl_chart_open_by_channel: undefined };
  const model = exportAll({ errors, results, loading: true });
  assert.equal(summaryRowFor(model, KPIS.cl_csat_avg)[1].text, "No access — Your role can't see this KPI");
  const html = renderTile({ def: KPIS.cl_csat_avg, result: RESULTS.cl_csat_avg, error: errors.cl_csat_avg });
  assert.match(html, />No access</);
  assert.equal(summaryRowFor(model, KPIS.cl_reopen_rate_count)[1].text, "Loading…");
  assert.equal(sheetFor(model, KPIS.cl_chart_open_by_channel).message, "Loading…");
});

test("the header block says what the numbers cover", () => {
  const info = Object.fromEntries(exportAll().sheets[0].info);
  assert.equal(info.Workspace, "acme");
  assert.equal(info.Period, "15/09/2026 – 15/10/2026");
  assert.equal(info.Geography, "All wards");
  assert.equal(info["Complaint category"], "All categories");
  assert.equal(info["Time zone"], "Africa/Nairobi");
  assert.match(info.Language, /\(en_IN\)$/);
  assert.ok(info.Updated && info["Exported at"]);
});

test("sheet names follow Excel's rules", () => {
  const used = new Set();
  assert.equal(sheetName("Open complaints by workflow stage and category", used).length, 31);
  assert.equal(sheetName("Rate [a/b]: *now*?", used), "Rate a b now");
  assert.equal(sheetName("Summary", used), "Summary");
  assert.equal(sheetName("summary", used), "summary (2)");
});

test("numberCell reads the number back out of the text", () => {
  assert.deepEqual(numberCell("13,8%"), { text: "13,8%", value: 0.138, numFmt: "0.0%" });
  assert.deepEqual(numberCell("2.033"), { text: "2.033", value: 2033, numFmt: "#,##0" });
  assert.deepEqual(numberCell("143,3 dias"), { text: "143,3 dias", value: 143.3, numFmt: '0.0" dias"' });
  assert.deepEqual(numberCell("+12"), { text: "+12", value: 12, numFmt: '"+"0' });
  assert.deepEqual(numberCell("-5"), { text: "-5", value: -5, numFmt: "0" });
  assert.deepEqual(numberCell("1 234,56 h"), { text: "1 234,56 h", value: 1234.56, numFmt: '#,##0.00" h"' });
  assert.deepEqual(numberCell("—"), { text: "—" });
});

/* ------------------------------------------------------------------ */
/* The workbook                                                        */
/* ------------------------------------------------------------------ */

test("the workbook keeps numbers as numbers, formatted, and links each sheet", async () => {
  const model = exportAll();
  const buffer = await buildWorkbook(ExcelJS, model).xlsx.writeBuffer();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);

  assert.deepEqual(book.worksheets.map((ws) => ws.name), model.sheets.map((s) => s.name));
  const summary = book.worksheets[0];
  // Summary rows start under the title, the info block and a blank row, then the header row.
  const firstRow = 1 + model.sheets[0].info.length + 2 + 1;
  const rowOf = (def) => summary.getRow(firstRow + CATALOG.indexOf(def));
  assert.equal(rowOf(KPIS.cl_resolution_rate_count).getCell(1).value, resolveTitle(KPIS.cl_resolution_rate_count));
  const rate = rowOf(KPIS.cl_resolution_rate_count).getCell(2);
  assert.equal(rate.value, 0.138);
  assert.equal(rate.numFmt, "0.0%");

  const chart = KPIS.cl_chart_open_by_channel;
  const link = rowOf(chart).getCell(2);
  const target = sheetFor(model, chart).name;
  assert.equal(link.value.text, target);
  assert.equal(link.value.hyperlink, `#'${target}'!A1`);
});

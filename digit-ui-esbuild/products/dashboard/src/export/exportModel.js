/**
 * The dashboard export as data (#1977): what each tile shows, in on-screen
 * order, ready for the xlsx writer (export/writeXlsx.js).
 *
 * Every value comes from the same calls the tiles render with
 * (utils/tileDisplay, utils/tableCellText and the chart presentation
 * formatters), so the file says what the screen says: "13,8%" stays 13,8%,
 * a duration stays "143,3 days", and a chart exports the categories and
 * values it draws. A summary sheet lists every tile; each chart, table and
 * map also gets a sheet of its own.
 */

import { isCardKind, isMapKind } from "../utils/queryPlan";
import {
  adaptBarRows,
  adaptDow,
  adaptHorizontalRows,
  adaptLine,
  adaptMapLayers,
  adaptPie,
  adaptRanked,
  adaptSlaRiskRows,
  adaptStacked,
  adaptTable,
  applyFormat,
  computeDelta,
  dowLabels,
  formatDeltaDisplay,
  lineHasStructure,
  primaryDimensionKey,
  resolvePrior,
  resolveScalar,
  stackedHasData,
  tileState,
} from "../utils/tileDisplay";
import { annotateRowsFromThresholds, cellText, columnLabel } from "../utils/tableCellText";
import { sortTableRows } from "../utils/tableSort";
import { formatNumber } from "../utils/numberFormat";
import {
  formatBarChartCount,
  formatBarChartPercentOneDecimal,
  formatFlowRatio,
} from "../config/barChartPresentation";
import { formatStackedBarSegmentValue } from "../config/stackedBarPresentation";
import { formatLineChartValue } from "../config/lineChartPresentation";
import { normalizePieChartData } from "../config/pieChartPresentation";
import { formatCount, formatPct } from "../config/mapHoverPresentation";
import { buildAtRiskColumns } from "../config/complaintsAtRiskPresentation";
import { dimensionKindForName } from "../config/kpiDisplay";
import { COMPLAINT_TYPE_OPTIONS } from "../config/globalFilterGroups";
import {
  dashboardTitle,
  headerGeographyLabel,
  headerPeriodLabel,
} from "../config/dashboardHeaderText";
import { nodeDisplayLabel } from "../components/ComplaintTypeTreeFilter";
import { typeFilterIgnored } from "../components/TypeFilterIgnoredNote";
import { exists, translate as t } from "../i18n/localeRuntime";
import { resolveSubtitle, resolveTitle } from "../i18n/textResolver";
import { linkCell, numberCell, textCell } from "./exportCells";

// Table column types whose text is a number (DashboardTable's formatters).
// Not hoursDays: it switches from hours to days at 48 h, so as bare numbers
// one column would hold 40 for "40 hrs" and 3 for "3 days", and sort and sum
// wrong. Those cells stay text, like the at-risk breach duration.
const NUMERIC_CELL_TYPES = new Set(["integer", "percent", "hours", "rating"]);

// The formats applyFormat prints. Any other format prints String(value),
// whose decimals numberCell can't tell from digit grouping (0.4567 would be
// read as 4,567), so that value is written as it is, with no format.
const APPLY_FORMATS = new Set([
  "integer", "percentInteger", "percentNoDecimal", "percentOneDecimal", "percent", "decimalOne",
  "decimalTwo", "ratingOutOfFive", "hoursDays", "hoursDecimal", "signedInteger", "ordinal",
]);

/** A cell for a value the tile prints with applyFormat. */
function formattedCell(value, format, locale) {
  const text = applyFormat(value, format, locale);
  if (APPLY_FORMATS.has(format)) return numberCell(text);
  return text === "—" ? textCell(text) : { text, value: Number(value) };
}

/** The same, for a column of values: hoursDays stays text (see NUMERIC_CELL_TYPES). */
function formattedColumnCell(value, format, locale) {
  return format === "hoursDays" ? textCell(applyFormat(value, format, locale)) : formattedCell(value, format, locale);
}

// Card kinds KpiTile draws with KpiCard, which shows the subtitle; the
// sparkline cards don't.
const SUBTITLE_CARD_KINDS = new Set(["number-tile-delta", "scalar", "number-tile"]);

/**
 * Build the export.
 *
 * @param {object} input
 * @param {string[]} input.tiles       kpiIds in on-screen order
 * @param {object}   input.kpis        catalog definitions by kpiId
 * @param {object}   input.results     batch results (assembled per tile by `assemble`)
 * @param {function} input.assemble    (kpiId) => the result object KpiTile receives
 * @param {function} input.errorFor    (kpiId) => the tile's error, or null
 * @param {boolean}  input.loading     the batch is still loading
 * @param {function} input.groupByFor  (kpiId) => the tile's { level, label } group-by, or null
 * @param {number}   input.asOf        batch timestamp (ms), shown as "Updated"
 * @param {object}   input.filters     the dashboard filters
 * @param {object}   input.filterOptions
 * @param {string}   input.timeZone
 * @param {string}   input.language    DIGIT locale, e.g. "pt_PT"
 * @param {string}   input.tenantId
 * @param {string}   input.productLabel  DASHBOARD_PRODUCT_LABEL, for the title
 * @param {boolean}  input.publicMode
 * @param {number}   input.now         export time (ms)
 */
export function buildDashboardExport(input) {
  const { tiles, kpis, results, assemble, errorFor, loading, groupByFor, language } = input;
  const locale = language?.replace("_", "-");
  const usedNames = new Set();
  const summaryName = sheetName(t("DASHBOARD_EXPORT_SHEET_SUMMARY", "Summary"), usedNames);

  const summaryRows = [];
  const tileSheets = [];
  for (const kpiId of tiles) {
    const def = kpis[kpiId];
    if (!def) continue;
    const viz = def.viz || {};
    const kind = viz.kind || "scalar";
    const title = resolveTitle(def) || kpiId;
    const result = assemble(kpiId);
    const error = errorFor(kpiId);
    const tileLoading = loading && !result;
    const note = typeFilterIgnored(results?.[kpiId])
      ? t("DASHBOARD_TYPE_FILTER_NOT_APPLIED", "Category filter not applied")
      : "";
    const state = tileState({ error, result, loading: tileLoading });

    if (isCardKind(kind)) {
      summaryRows.push(cardRow({ title, viz, kind, result, results, state, note, locale }));
      continue;
    }

    const groupBy = groupByFor(kpiId);
    const ctx = { def, viz, result, results, title, loading: tileLoading, groupBy, locale };
    const content = state ? { message: stateText(state) } : tileContent(kind, ctx);
    const name = sheetName(title, usedNames);
    // The map draws its own header, without the tile subtitle.
    const subtitle = isMapKind(kind) ? "" : resolveSubtitle(viz) || "";
    tileSheets.push({
      name,
      title,
      subtitle,
      info: infoRows(input, groupBy),
      notes: note ? [note] : [],
      ...content,
    });
    summaryRows.push([textCell(title), linkCell(name, name), textCell(""), textCell(subtitle), textCell(note)]);
  }

  const summary = {
    name: summaryName,
    title: dashboardTitle(t, exists, input.productLabel || "Complaint Resolution") +
      (input.publicMode ? ` · ${t("DASHBOARD_HEADER_PUBLIC_SUBTITLE", "Public view")}` : ""),
    subtitle: "",
    info: infoRows(input, null),
    notes: [],
    columns: [
      t("DASHBOARD_EXPORT_COL_TITLE", "Title"),
      t("DASHBOARD_EXPORT_COL_VALUE", "Value"),
      t("DASHBOARD_EXPORT_COL_CHANGE", "Change vs previous period"),
      t("DASHBOARD_EXPORT_COL_DESCRIPTION", "Description"),
      t("DASHBOARD_EXPORT_COL_NOTE", "Note"),
    ],
    rows: summaryRows,
  };

  return {
    fileName: exportFileName(input.tenantId, input.now, input.timeZone),
    sheets: [summary, ...tileSheets],
  };
}

/* ------------------------------------------------------------------ */
/* Cards                                                               */
/* ------------------------------------------------------------------ */

function cardRow({ title, viz, kind, result, results, state, note, locale }) {
  const subtitle = SUBTITLE_CARD_KINDS.has(kind) ? resolveSubtitle(viz) || "" : "";
  if (state) {
    return [textCell(title), textCell(stateText(state)), textCell(""), textCell(subtitle), textCell(note)];
  }
  const ctx = { viz, result, results };
  const value = resolveScalar(ctx);
  const prior = resolvePrior(ctx);
  const delta = computeDelta(value, prior, viz.format, viz.delta?.mode);
  return [
    textCell(title),
    formattedCell(value, viz.format, locale),
    textCell(formatDeltaDisplay(delta, viz.format, viz.delta?.mode) ?? ""),
    textCell(subtitle),
    textCell(note),
  ];
}

/** The text a tile shows in place of its content. */
function stateText(state) {
  if (state.kind === "error") return `${state.label} — ${state.message}`;
  if (state.kind === "loading") return t("DASHBOARD_COMMON_LOADING", "Loading…");
  return state.label;
}

/* ------------------------------------------------------------------ */
/* Charts, tables and the map                                          */
/* ------------------------------------------------------------------ */

const LOADING = () => t("DASHBOARD_COMMON_LOADING", "Loading…");
const NO_DATA = () => t("DASHBOARD_COMMON_NO_DATA", "No data");

/** { columns, rows } as the tile draws them, or { message } when it draws a placeholder. */
function tileContent(kind, ctx) {
  switch (kind) {
    case "bar":
    case "bar-chart":
    case "histogram":
      return barContent(ctx);
    case "horizontal-bar":
      return horizontalBarContent(ctx);
    case "stacked-bar":
      return stackedContent(ctx);
    case "pie":
    case "pie-chart":
      return pieContent(ctx);
    case "line":
    case "line-chart":
      return lineContent(ctx);
    case "sla-risk-table":
      return atRiskContent(ctx);
    case "choropleth-map":
    case "map":
      return mapContent(ctx);
    case "ranked-list":
    case "rankedList":
      return rankedContent(ctx);
    case "dow":
    case "day-of-week":
      return dowContent(ctx);
    case "table":
    case "data-table":
    default:
      return tableContent(ctx);
  }
}

function placeholder(ctx, hasData) {
  if (hasData) return null;
  return { message: ctx.loading ? LOADING() : NO_DATA() };
}

function barContent(ctx) {
  const data = adaptBarRows(ctx);
  const empty = placeholder(ctx, data.length > 0);
  if (empty) return empty;
  const percent = ctx.viz.format === "percent" || ctx.viz.format === "percentOneDecimal";
  return {
    columns: [dimensionHeader(ctx), percent ? valueHeader() : countHeader()],
    rows: data.map((row) => [
      textCell(row.label),
      numberCell(percent ? formatBarChartPercentOneDecimal(row.count) : formatBarChartCount(row.count)),
    ]),
  };
}

function horizontalBarContent(ctx) {
  const data = adaptHorizontalRows(ctx);
  const empty = placeholder(ctx, data.length > 0);
  if (empty) return empty;
  const withCounts = data.some((row) => row.resolved !== undefined && row.created !== undefined);
  const count = (n) => numberCell(formatNumber(n, { decimals: 0 }) ?? String(n));
  return {
    columns: [
      dimensionHeader(ctx),
      valueHeader(),
      ...(withCounts
        ? [t("DASHBOARD_MAP_HOVER_RESOLVED", "Resolved"), t("DASHBOARD_MAP_HOVER_CREATED", "Created")]
        : []),
    ],
    rows: data.map((row) => [
      textCell(row.label),
      numberCell(formatFlowRatio(row.value)),
      ...(withCounts ? [count(row.resolved), count(row.created)] : []),
    ]),
  };
}

function stackedContent(ctx) {
  const { viz } = ctx;
  const { categories, series } = adaptStacked(ctx);
  const empty = placeholder(ctx, stackedHasData({ categories, series }));
  if (empty) return empty;
  const valueFormat = viz.valueFormat || (viz.valueTransform === "msToHours" ? "hours" : undefined);
  // The chart leaves a zero segment unlabelled (no bar is drawn); the sheet says 0.
  const segment = (v) => numberCell(formatStackedBarSegmentValue(v, valueFormat) || formatBarChartCount(0));
  return {
    columns: [dimensionHeader(ctx), ...series.map((s) => s.name)],
    rows: categories.map((category, i) => [textCell(category), ...series.map((s) => segment(s.data?.[i]))]),
  };
}

function pieContent(ctx) {
  const slices = normalizePieChartData(adaptPie(ctx));
  const empty = placeholder(ctx, slices.length > 0);
  if (empty) return empty;
  // The slice tooltip: "Count : 2,064 (95%)".
  return {
    columns: [dimensionHeader(ctx), countHeader(), t("DASHBOARD_EXPORT_COL_SHARE", "Share")],
    rows: slices.map((slice) => [
      textCell(slice.label),
      numberCell(formatNumber(slice.count, { decimals: 0 }) ?? String(slice.count)),
      numberCell(`${slice.pct}%`),
    ]),
  };
}

function lineContent(ctx) {
  const props = adaptLine(ctx);
  const empty = placeholder(ctx, lineHasStructure(props));
  if (empty) return empty;
  // LineChart opens on defaultPeriod when the backend sends several periods.
  const dataset = props.periods?.[props.defaultPeriod] ?? props;
  const categories = dataset.categories ?? [];
  const series = dataset.series ?? [];
  return {
    columns: [dimensionHeader(ctx, { dates: true }), ...series.map((s) => s.name)],
    rows: categories.map((category, i) => [
      textCell(category),
      ...series.map((s) => numberCell(String(formatLineChartValue(s.data?.[i], s)))),
    ]),
  };
}

function tableContent(ctx) {
  const { viz } = ctx;
  const { columns, rows } = adaptTable(ctx);
  if (ctx.loading && !rows.length) return { message: LOADING() };
  if (!rows.length) return { message: viz.emptyMessage || NO_DATA() };
  // DashboardTable's order before anyone clicks a header: as the rows come.
  const shown = sortTableRows(annotateRowsFromThresholds(rows, columns), columns, { key: null });
  return {
    columns: columns.map(columnLabel),
    rows: shown.map((row) =>
      columns.map((col) => {
        const text = cellText(col, row);
        return NUMERIC_CELL_TYPES.has(col.type) ? numberCell(text) : textCell(text);
      })
    ),
  };
}

function atRiskContent(ctx) {
  const rows = adaptSlaRiskRows(ctx);
  if (ctx.loading && !rows.length) return { message: LOADING() };
  if (!rows.length) return { message: t("DASHBOARD_TABLE_EMPTY_AT_RISK", "No complaints at risk") };
  const columns = buildAtRiskColumns(t);
  // ComplaintsAtRiskTable opens sorted by breach duration, longest first.
  const shown = sortTableRows(rows, columns, { key: "breachDurationMs", direction: "desc" });
  return {
    columns: columns.map((col) => col.label),
    rows: shown.map((row) =>
      columns.map((col) =>
        col.id === "breachDurationMs" ? textCell(row.breachDurationLabel || "—") : textCell(row[col.id])
      )
    ),
  };
}

function mapContent(ctx) {
  const wards = adaptMapLayers(ctx).created || [];
  if (ctx.loading && !wards.length) return { message: t("DASHBOARD_MAP_LOADING", "Loading…") };
  if (!wards.length) return { message: NO_DATA() };
  // The ward hover card's figures.
  return {
    columns: [
      t("DASHBOARD_MAP_AREA", "Area"),
      t("DASHBOARD_MAP_HOVER_CREATED", "Created"),
      t("DASHBOARD_MAP_HOVER_OPEN", "Open"),
      t("DASHBOARD_MAP_HOVER_RESOLVED", "Resolved"),
      t("DASHBOARD_MAP_HOVER_PCT_OPEN", "% Open"),
      t("DASHBOARD_MAP_HOVER_PCT_RESOLVED", "% Resolved"),
    ],
    rows: wards.map((ward) => [
      textCell(ward.label || ward.wardCode),
      numberCell(String(formatCount(ward.created))),
      numberCell(String(formatCount(ward.open))),
      numberCell(String(formatCount(ward.resolved))),
      numberCell(formatPct(ward.openPct)),
      numberCell(formatPct(ward.resolvedPct)),
    ]),
  };
}

function rankedContent(ctx) {
  const { rows, format } = adaptRanked(ctx);
  if (!rows.length) return { message: NO_DATA() };
  return {
    columns: ["#", dimensionHeader(ctx), valueHeader()],
    rows: rows.map((row, i) => [
      numberCell(String(i + 1)),
      textCell(row.label),
      formattedColumnCell(row.value, format, ctx.locale),
    ]),
  };
}

function dowContent(ctx) {
  const { rows, format } = adaptDow(ctx);
  if (!rows.length) return { message: NO_DATA() };
  const labels = dowLabels();
  return {
    columns: [t("DASHBOARD_EXPORT_COL_DATE", "Date"), valueHeader()],
    rows: rows.map((row) => [
      textCell(labels[row.dow] ?? row.dow),
      formattedColumnCell(row.value, format, ctx.locale),
    ]),
  };
}

/* ------------------------------------------------------------------ */
/* Headers, info block, names                                          */
/* ------------------------------------------------------------------ */

const valueHeader = () => t("DASHBOARD_EXPORT_COL_VALUE", "Value");
const countHeader = () => t("DASHBOARD_COMMON_COUNT", "Count");

/** The category column's header, named after what the chart groups by. */
function dimensionHeader(ctx, { dates = false } = {}) {
  const { viz, result } = ctx;
  if (viz.labelFormat === "officer") return t("DASHBOARD_COL_NAME", "Name");
  if (viz.labelFormat === "department") return t("DASHBOARD_COL_DEPT", "Dept");
  if (viz.labelFormat === "date-dow") return t("DASHBOARD_EXPORT_COL_DATE", "Date");
  const dimKey = primaryDimensionKey(result, viz);
  if (ctx.groupBy?.label) return ctx.groupBy.label;
  if (/age/i.test(dimKey) && /bucket/i.test(dimKey)) return t("DASHBOARD_EXPORT_COL_AGE", "Age");
  if (dates || /date|day|week|month|period/i.test(dimKey)) {
    if (!dimensionKindForName(dimKey)) return t("DASHBOARD_EXPORT_COL_DATE", "Date");
  }
  switch (dimensionKindForName(dimKey)) {
    case "complaintType": return t("DASHBOARD_COL_TYPE", "Category");
    case "boundary": return t("DASHBOARD_MAP_AREA", "Area");
    case "department": return t("DASHBOARD_COL_DEPT", "Dept");
    case "slaState": return t("DASHBOARD_COL_SLA_STATUS", "SLA status");
    case "workflowStatus": return t("DASHBOARD_COL_STATUS", "Status");
    case "channel": return t("DASHBOARD_MAP_PIN_CHANNEL", "Channel");
    default: return t("DASHBOARD_EXPORT_COL_ITEM", "Item");
  }
}

/** Label/value rows above every sheet: what the numbers cover. */
function infoRows(input, groupBy) {
  const { filters, filterOptions, timeZone, language, tenantId, asOf, now } = input;
  const rows = [
    [t("DASHBOARD_EXPORT_WORKSPACE", "Workspace"), tenantId || ""],
    [t("DASHBOARD_EXPORT_PERIOD", "Period"), headerPeriodLabel(filters, t, language)],
    [t("DASHBOARD_FILTERS_GEOGRAPHY", "Geography"), headerGeographyLabel(filters, filterOptions, t)],
    [t("DASHBOARD_FILTERS_COMPLAINT_TYPE", "Complaint category"), complaintTypeLabel(filters, filterOptions)],
  ];
  if (groupBy?.label) rows.push([t("DASHBOARD_GROUPBY_LABEL", "Group by"), groupBy.label]);
  rows.push(
    [t("DASHBOARD_EXPORT_TIME_ZONE", "Time zone"), timeZone || ""],
    [t("DASHBOARD_HEADER_LANGUAGE", "Language"), languageName(language)],
  );
  if (asOf != null) rows.push([t("DASHBOARD_COMMON_UPDATED", "Updated"), formatDateTime(asOf, language, timeZone)]);
  rows.push([t("DASHBOARD_EXPORT_EXPORTED_AT", "Exported at"), formatDateTime(now, language, timeZone)]);
  return rows;
}

/** The complaint-category filter as its chip shows it. */
function complaintTypeLabel(filters, filterOptions) {
  const code = filters?.complaintType ?? "all";
  if (code === "all") return t("DASHBOARD_FILTERS_ALL_TYPES", "All categories");
  const tree = filterOptions?.complaintTypeTree;
  if (tree) return nodeDisplayLabel(tree, code);
  const options = filterOptions?.complaintType ?? COMPLAINT_TYPE_OPTIONS;
  return options.find((opt) => opt.id === code)?.label ?? String(code);
}

function languageName(language) {
  if (!language) return "";
  const tag = language.replace("_", "-");
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    return name ? `${name} (${language})` : language;
  } catch (e) {
    return language;
  }
}

function formatDateTime(ms, language, timeZone) {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(language?.replace("_", "-"), {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timeZone || undefined,
    }).format(date);
  } catch (e) {
    return date.toISOString();
  }
}

/**
 * An Excel sheet name for a tile title: at most 31 characters, none of
 * \ / ? * [ ] :, not wrapped in apostrophes, unique ignoring case.
 */
export function sheetName(title, used) {
  const base =
    String(title || "")
      .replace(/[\\/?*[\]:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^'+|'+$/g, "")
      .slice(0, 31)
      .trim() || "Sheet";
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, 31 - suffix.length).trim()}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** dashboard-<workspace>-<yyyy-mm-dd>.xlsx, dated in the dashboard's time zone. */
export function exportFileName(tenantId, now, timeZone) {
  let day;
  try {
    day = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined }).format(new Date(now));
  } catch (e) {
    day = new Date(now).toISOString().slice(0, 10);
  }
  const workspace = String(tenantId || "").replace(/[^A-Za-z0-9._-]+/g, "-");
  return `dashboard${workspace ? `-${workspace}` : ""}-${day}.xlsx`;
}

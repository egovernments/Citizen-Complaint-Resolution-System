import { TABLE_WIDGET_CONFIG } from "../config/dashboardTables";
import { WIDGETS, isKpiWidget } from "../constants/layoutConfig";

function escapeCsv(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function formatCell(row, column) {
  const raw = row[column.id];
  if (raw == null) return "";
  if (column.type === "percent") {
    const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
    return Number.isFinite(pct) ? `${pct.toFixed(1)}%` : "";
  }
  if (column.type === "hours") {
    const hours = Number(raw) / 3600000;
    return Number.isFinite(hours) ? `${hours.toFixed(1)}h` : "";
  }
  if (column.type === "trend") {
    const n = Number(raw);
    if (!Number.isFinite(n)) return "";
    return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  }
  return raw;
}

function tableSection(title, columns, rows) {
  if (!rows?.length) return [`## ${title}`, "(no data)", ""];

  const header = columns.map((col) => escapeCsv(col.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((col) => escapeCsv(formatCell(row, col))).join(",")
  );
  return [`## ${title}`, header, ...lines, ""];
}

function kpiSection(layout, kpiCardData) {
  const lines = ["## KPI Cards", "Title,Value,Context"];
  layout
    .filter((item) => isKpiWidget(item.i))
    .forEach((item) => {
      const card = kpiCardData[item.i];
      if (!card) return;
      lines.push(
        [escapeCsv(card.title), escapeCsv(card.value), escapeCsv(card.context)].join(",")
      );
      if (card.listItems?.length) {
        lines.push("Rank,Label,Value");
        card.listItems.forEach((entry) => {
          lines.push(
            [escapeCsv(entry.rank), escapeCsv(entry.label), escapeCsv(entry.value)].join(",")
          );
        });
      }
    });
  lines.push("");
  return lines;
}

function chartBarSection(title, rows) {
  if (!rows?.length) return [`## ${title}`, "(no data)", ""];
  const lines = [`## ${title}`, "Label,Count"];
  rows.forEach((row) => {
    lines.push([escapeCsv(row.label), escapeCsv(row.count ?? row.value)].join(","));
  });
  lines.push("");
  return lines;
}

function buildExportCsv({ layout, kpiCardData, chartData, filters }) {
  const sections = [
    ["# Dashboard export"],
    [`Generated,${new Date().toISOString()}`],
    filters?.geography ? [`Geography,${escapeCsv(filters.geography)}`] : [],
    filters?.dateFrom && filters?.dateTo
      ? [`Date range,${escapeCsv(filters.dateFrom)} to ${escapeCsv(filters.dateTo)}`]
      : [],
    [""],
    ...kpiSection(layout, kpiCardData),
  ].flat();

  layout.forEach((item) => {
    const meta = WIDGETS[item.i];
    if (!meta) return;

    const tableConfig = TABLE_WIDGET_CONFIG[item.i];
    if (tableConfig) {
      sections.push(
        ...tableSection(meta.metric, tableConfig.columns, chartData[tableConfig.dataKey])
      );
      return;
    }

    if (item.i === "cl-chart-categories") {
      sections.push(...chartBarSection(meta.metric, chartData.categories));
    } else if (item.i === "cl-chart-wards") {
      sections.push(...chartBarSection(meta.metric, chartData.wards));
    } else if (item.i === "cl-chart-dow") {
      sections.push(...chartBarSection(meta.metric, chartData.dow));
    } else if (item.i === "cl-map-complaints") {
      const pins = chartData.mapPins || [];
      sections.push(["## Complaint map pins", "Service code,Status,Count,Lat,Lng"]);
      pins.forEach((pin) => {
        sections.push(
          [
            escapeCsv(pin.serviceCode),
            escapeCsv(pin.status),
            escapeCsv(pin.count),
            escapeCsv(pin.lat),
            escapeCsv(pin.lng),
          ].join(",")
        );
      });
      sections.push("");
    }
  });

  return sections.join("\n");
}

export function downloadDashboardExport(context) {
  const csv = buildExportCsv(context);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dashboard-export-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

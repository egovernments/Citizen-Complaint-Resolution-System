import React from "react";
import {
  DATA_TABLE_STYLES,
  getDataTableTdClass,
  getDataTableThClass,
  getSlaRiskStatusPillClass,
} from "../config/visualizationStyles";

const TrendCell = ({ value }) => {
  const { muted, trendUp, trendDown } = DATA_TABLE_STYLES;
  if (value == null || !Number.isFinite(value)) {
    return <span className={muted}>—</span>;
  }
  if (value === 0) {
    return <span className={muted}>0.0%</span>;
  }
  const up = value > 0;
  return (
    <span className={up ? trendUp : trendDown}>
      {up ? "↑" : "↓"} {Math.abs(value).toFixed(1)}%
    </span>
  );
};

const formatPercent = (value, decimals = 1) => {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(decimals)}%`;
};

const formatHours = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / 3600000;
  const formatted =
    Math.abs(hours - Math.round(hours)) < 0.05
      ? String(Math.round(hours))
      : hours.toFixed(1);
  return `${formatted}h`;
};

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

const formatHoursDays = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const hours = ms / MS_PER_HOUR;
  if (hours < 48) {
    const rounded = Math.round(hours * 10) / 10;
    const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${formatted} ${rounded === 1 ? "hr" : "hrs"}`;
  }
  const days = ms / MS_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${formatted} ${rounded === 1 ? "day" : "days"}`;
};

const formatRating = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number(value).toFixed(1)}/5`;
};

const formatInteger = (value) => {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.round(value));
};

const CELL_RENDERERS = {
  text: (value) => value ?? "—",
  integer: (value) => formatInteger(value),
  percent: (value) => formatPercent(value),
  hours: (value) => formatHours(value),
  hoursDays: (value) => formatHoursDays(value),
  rating: (value) => formatRating(value),
  trend: (value) => <TrendCell value={value} />,
  tags: (value) => value,
};

function resolveCellToneClass(tone, styles) {
  if (tone === "breach") return styles.thresholdCell;
  if (tone === "watch") return styles.thresholdWatch;
  if (tone === "good") return styles.thresholdGood;
  return undefined;
}

function renderStatusTags(tags, styles) {
  const items = Array.isArray(tags) ? tags : [];
  if (!items.length) return <span className={styles.muted}>—</span>;

  return (
    <span className="tw-flex tw-flex-wrap tw-gap-1">
      {items.map((tag) => {
        const normalized = String(tag).toLowerCase();
        const pillClass =
          normalized === "on track"
            ? getSlaRiskStatusPillClass("open")
            : normalized.includes("high") || normalized.includes("low")
              ? getSlaRiskStatusPillClass("reopened")
              : getSlaRiskStatusPillClass("assigned");
        return (
          <span key={tag} className={pillClass}>
            {tag}
          </span>
        );
      })}
    </span>
  );
}

const DashboardTable = ({ columns, rows }) => {
  const styles = DATA_TABLE_STYLES;

  if (!rows?.length) {
    return <p className={styles.empty}>No data</p>;
  }

  return (
    <table className={styles.table}>
      <colgroup>
        {columns.map((col) => (
          <col
            key={col.id}
            className={col.width ? styles.colFixed : undefined}
            style={col.width ? { width: col.width } : undefined}
          />
        ))}
      </colgroup>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.id} className={getDataTableThClass(col.align)}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          <tr
            key={row.id ?? rowIndex}
            className={row.highlight ? styles.rowHighlight : undefined}
          >
            {columns.map((col) => {
              const raw = row[col.id];
              const isLabel =
                col.id === "label" || col.id === "subtypeLabel" || col.id === "officerName";
              const render = CELL_RENDERERS[col.type] ?? CELL_RENDERERS.text;
              const content =
                col.type === "tags"
                  ? renderStatusTags(raw, styles)
                  : col.type === "trend"
                    ? render(raw)
                    : render(raw);
              const labelText = typeof raw === "string" ? raw : String(raw ?? "");
              const toneKey = col.thresholdKey ?? col.id;
              const toneClass = resolveCellToneClass(row.cellTones?.[toneKey], styles);
              const isThresholdCell = row.cellHighlights?.[col.id];

              return (
                <td key={col.id} className={getDataTableTdClass(col.align)}>
                  {isLabel ? (
                    <span className={styles.primary} title={labelText}>
                      <span className={styles.label}>{content}</span>
                      {row.badge ? (
                        <span className={styles.badge}>{row.badge}</span>
                      ) : null}
                    </span>
                  ) : (
                    <span className={toneClass ?? (isThresholdCell ? styles.thresholdCell : undefined)}>
                      {content}
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default DashboardTable;

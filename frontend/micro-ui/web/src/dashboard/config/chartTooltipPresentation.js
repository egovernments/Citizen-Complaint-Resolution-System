/**
 * Shared hover tooltip markup and Apex tooltip config for dashboard charts.
 */

import { SHARED_CHROME } from "./visualizationStyles";

const DEFAULT_TOOLTIP_OFFSET = 10;

export function resolveNearCursorTooltipPosition(
  clientX,
  clientY,
  { width = 0, height = 0 } = {},
  offset = DEFAULT_TOOLTIP_OFFSET
) {
  const margin = offset;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = clientX + margin;
  let top = clientY + margin;

  if (width > 0 && left + width + margin > viewportWidth) {
    left = clientX - width - margin;
  }
  if (height > 0 && top + height + margin > viewportHeight) {
    top = clientY - height - margin;
  }

  if (width > 0) {
    left = Math.max(margin, Math.min(left, viewportWidth - width - margin));
  } else {
    left = Math.max(margin, Math.min(left, viewportWidth - margin));
  }

  if (height > 0) {
    top = Math.max(margin, Math.min(top, viewportHeight - height - margin));
  } else {
    top = Math.max(margin, Math.min(top, viewportHeight - margin));
  }

  return { left, top };
}

export function buildChartTooltipMarkup({ title, rows = [] }) {
  const { chartTooltip, chartTooltipTitle, chartTooltipRow } = SHARED_CHROME;

  const titleHtml = title
    ? `<div class="${chartTooltipTitle}">${title}</div>`
    : "";

  const rowsHtml = rows
    .map((row) => {
      if (row?.value == null && row?.label == null) return "";
      const colorStyle = row.color ? ` style="color:${row.color}"` : "";
      const label = row.label ?? "";
      const value = row.value ?? "";
      const text = label ? `${label} : ${value}` : String(value);
      return `<div class="${chartTooltipRow}"${colorStyle}>${text}</div>`;
    })
    .join("");

  return `<div class="${chartTooltip}">${titleHtml}${rowsHtml}</div>`;
}

export function buildApexChartTooltipOptions({
  followCursor = false,
  offsetX = DEFAULT_TOOLTIP_OFFSET,
  offsetY = DEFAULT_TOOLTIP_OFFSET,
  shared = true,
  intersect = false,
  ...rest
} = {}) {
  return {
    enabled: true,
    shared,
    intersect,
    followCursor,
    offsetX,
    offsetY,
    fixed: { enabled: false },
    theme: "light",
    marker: { show: false },
    x: { show: false },
    ...rest,
  };
}

export function buildApexSeriesHoverTooltip({
  categories = [],
  getCategoryLabel,
  formatValue = (value) => Math.round(Number(value)),
  includeZero = true,
  followCursor = false,
  offsetX = DEFAULT_TOOLTIP_OFFSET,
  offsetY = DEFAULT_TOOLTIP_OFFSET,
} = {}) {
  return buildApexChartTooltipOptions({
    followCursor,
    offsetX,
    offsetY,
    y: {
      formatter: formatValue,
      title: { formatter: (name) => `${name} : ` },
    },
    custom: ({ series, dataPointIndex, w }) => {
      if (dataPointIndex < 0) return "";

      const label =
        getCategoryLabel?.(dataPointIndex) ??
        categories[dataPointIndex] ??
        w.globals.categoryLabels[dataPointIndex] ??
        w.globals.labels[dataPointIndex] ??
        "";

      const names = w.config.series.map((entry) => entry.name);
      const palette = w.globals.colors;

      const rows = series
        .map((values, index) => {
          const value = values[dataPointIndex];
          if (value == null || Number.isNaN(Number(value))) return null;
          if (!includeZero && Number(value) === 0) return null;

          return {
            label: names[index] ?? `Series ${index + 1}`,
            value: formatValue(value, index),
            color: palette[index] ?? palette[0],
          };
        })
        .filter(Boolean);

      if (!rows.length) return "";

      return buildChartTooltipMarkup({ title: label, rows });
    },
  });
}

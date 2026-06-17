/**
 * Shared presentation for pie / donut charts (viz type: pie-chart).
 */

import { getChartColor, resolveDashboardCssColor } from "./chartColors";

export const PIE_CHART_VIEWBOX = { width: 320, height: 230 };
export const PIE_CHART_CX = 160;
export const PIE_CHART_CY = 118;
export const PIE_CHART_OUTER_R = 72;
export const PIE_CHART_INNER_R = 42;
export const PIE_CHART_LABEL_R = 94;
export const PIE_CHART_MIN_SWEEP_FOR_VALUE = 20;

export function pieChartValueRadius() {
  return (PIE_CHART_OUTER_R + PIE_CHART_INNER_R) / 2;
}

export function toPieRad(deg) {
  return ((deg - 90) * Math.PI) / 180;
}

export function polarOnPie(cx, cy, r, deg) {
  const rad = toPieRad(deg);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function buildPieArcPath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  const outerStart = polarOnPie(cx, cy, rOuter, startDeg);
  const outerEnd = polarOnPie(cx, cy, rOuter, endDeg);
  const innerEnd = polarOnPie(cx, cy, rInner, endDeg);
  const innerStart = polarOnPie(cx, cy, rInner, startDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;

  return [
    `M ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
    `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

export function pieLabelAnchor(midDeg) {
  const cos = Math.cos(toPieRad(midDeg));
  if (cos > 0.25) return "start";
  if (cos < -0.25) return "end";
  return "middle";
}

export function pieLabelOffset(midDeg) {
  const cos = Math.cos(toPieRad(midDeg));
  if (cos > 0.25) return 6;
  if (cos < -0.25) return -6;
  return 0;
}

export function truncatePieLabel(label, sweepDeg) {
  const text = String(label ?? "");
  const maxChars = sweepDeg < 30 ? 8 : sweepDeg < 55 ? 12 : 18;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

export function normalizePieChartData(data = []) {
  const total = data.reduce((sum, item) => sum + (Number(item.count) || 0), 0) || 1;
  let cursor = 0;

  return data.map((item, index) => {
    const count = Number(item.count) || 0;
    const color = resolveDashboardCssColor(item.color || getChartColor(index));
    const sweep = (count / total) * 360;
    const start = cursor;
    const end = cursor + sweep;
    const mid = start + sweep / 2;
    cursor = end;

    const valuePoint = polarOnPie(PIE_CHART_CX, PIE_CHART_CY, pieChartValueRadius(), mid);
    const labelPoint = polarOnPie(PIE_CHART_CX, PIE_CHART_CY, PIE_CHART_LABEL_R, mid);
    const anchor = pieLabelAnchor(mid);
    const dx = pieLabelOffset(mid);
    const hoverPoint = polarOnPie(PIE_CHART_CX, PIE_CHART_CY, PIE_CHART_OUTER_R + 8, mid);

    return {
      label: String(item.label ?? "Unknown"),
      count,
      color,
      index,
      mid,
      sweep,
      pct: Math.round((count / total) * 100),
      path: buildPieArcPath(
        PIE_CHART_CX,
        PIE_CHART_CY,
        PIE_CHART_OUTER_R,
        PIE_CHART_INNER_R,
        start,
        end
      ),
      valueX: valuePoint.x,
      valueY: valuePoint.y,
      labelX: labelPoint.x + dx,
      labelY: labelPoint.y,
      labelAnchor: anchor,
      hoverX: hoverPoint.x,
      hoverY: hoverPoint.y,
      showValue: sweep >= PIE_CHART_MIN_SWEEP_FOR_VALUE,
      displayLabel: truncatePieLabel(item.label, sweep),
    };
  });
}

export function getPieChartValueLabelColor() {
  return (
    resolveDashboardCssColor("var(--surface)") ||
    resolveDashboardCssColor("var(--background)") ||
    "#ffffff"
  );
}

/**
 * ours (digit-3 P0, 2026-10-14): what a KPI sparkline can draw. ApexCharts' sparkline divides by the y-range, so a
 * series with no points or with every point equal (a quiet county: all zeros) produced "M -1 Infinity ..." paths and an
 * uncaught svg.js error. Such series are drawn as a flat baseline (or a "no data" note), never handed to the chart.
 *   'none'  - no finite points
 *   'flat'  - every finite point equal (value: that number)
 *   'chart' - something to plot (data: the finite points; one point is doubled so a line has two ends)
 */
export function sparklineShape(points) {
  const data = (Array.isArray(points) ? points : [])
    .map((p) => (p !== null && typeof p === "object" ? p.y : p))
    .map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v))
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  if (data.length === 0) return { kind: "none", data: [] };
  if (data.every((v) => v === data[0])) return { kind: "flat", value: data[0], data };
  return { kind: "chart", data: data.length === 1 ? [data[0], data[0]] : data };
}

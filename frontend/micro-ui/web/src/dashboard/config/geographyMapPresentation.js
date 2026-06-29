/** @typedef {'wow_change' | 'sla_breach' | 'created' | 'open' | 'resolved'} GeographyMapLayerId */

export const GEOGRAPHY_MAP_LAYERS = [
  {
    id: "created",
    label: "Created",
    legendTitle: "Complaints created",
    zoomLevelLabel: "Locality",
  },
  {
    id: "open",
    label: "Open",
    legendTitle: "Open complaints",
    zoomLevelLabel: "Ward",
  },
  {
    id: "resolved",
    label: "Resolved",
    legendTitle: "Complaints resolved",
    zoomLevelLabel: "Locality",
  },
  {
    id: "wow_change",
    label: "WoW change",
    legendTitle: "Week-over-week change",
    zoomLevelLabel: "Locality",
  },
  {
    id: "sla_breach",
    label: "SLA breach",
    legendTitle: "SLA breach share",
    zoomLevelLabel: "Ward",
  },
];

export const GEOGRAPHY_MAP_LAYER_IDS = new Set(
  GEOGRAPHY_MAP_LAYERS.map((layer) => layer.id)
);

export function isGeographyMapLayerId(value) {
  return GEOGRAPHY_MAP_LAYER_IDS.has(value);
}

export function isGeographyMapVolumeLayerId(layerId) {
  return layerId === "created" || layerId === "open" || layerId === "resolved";
}

export function getGeographyMapLayerMeta(layerId) {
  return GEOGRAPHY_MAP_LAYERS.find((layer) => layer.id === layerId);
}

/** WoW choropleth buckets — matches reference legend. */
export const WOW_CHANGE_LEGEND = [
  { id: "down_large", label: "↓ > 25%", fill: "#0d6e63", stroke: "#0a5249", fillOpacity: 0.72 },
  { id: "down_small", label: "↓ 5–25%", fill: "#a7f3d0", stroke: "#6ee7b7", fillOpacity: 0.72 },
  { id: "flat", label: "flat ±5%", fill: "#ffffff", stroke: "#d1d5db", fillOpacity: 0.95 },
  { id: "up_small", label: "↑ 5–25%", fill: "#fde68a", stroke: "#facc15", fillOpacity: 0.78 },
  { id: "up_medium", label: "↑ 25–100%", fill: "#fb923c", stroke: "#f97316", fillOpacity: 0.75 },
  { id: "up_large", label: "↑ >100% / new", fill: "#ef4444", stroke: "#dc2626", fillOpacity: 0.75 },
];

/** SLA breach share — % of open complaints breached in ward. */
export const SLA_BREACH_LEGEND = [
  { id: "none", label: "0%", fill: "#ffffff", stroke: "#d1d5db" },
  { id: "low", label: "≤ 10%", fill: "#fee2e2", stroke: "#fecaca" },
  { id: "medium_low", label: "10–25%", fill: "#fecaca", stroke: "#fca5a5" },
  { id: "medium", label: "25–50%", fill: "#f87171", stroke: "#ef4444" },
  { id: "high", label: "50–75%", fill: "#dc2626", stroke: "#b91c1c" },
  { id: "very_high", label: "> 75%", fill: "#7f1d1d", stroke: "#450a0a" },
];

/** Volume choropleth — low to high complaint count. */
export const VOLUME_COUNT_LEGEND = [
  { id: "none", label: "0", fill: "#ffffff", stroke: "#d1d5db", fillOpacity: 0.95 },
  { id: "low", label: "Low", fill: "#ccfbf1", stroke: "#99f6e4", fillOpacity: 0.78 },
  { id: "medium_low", label: "Medium-low", fill: "#5eead4", stroke: "#2dd4bf", fillOpacity: 0.76 },
  { id: "medium", label: "Medium", fill: "#14b8a6", stroke: "#0d9488", fillOpacity: 0.74 },
  { id: "high", label: "High", fill: "#0d9488", stroke: "#0f766e", fillOpacity: 0.76 },
  { id: "very_high", label: "Very high", fill: "#115e59", stroke: "#134e4a", fillOpacity: 0.78 },
];

export function getGeographyMapLegend(layerId) {
  if (layerId === "sla_breach") return SLA_BREACH_LEGEND;
  if (isGeographyMapVolumeLayerId(layerId)) return VOLUME_COUNT_LEGEND;
  return WOW_CHANGE_LEGEND;
}

export function getGeographyMapLegendTitle(layerId) {
  return getGeographyMapLayerMeta(layerId)?.legendTitle ?? "Map legend";
}

export function getGeographyMapLegendFooter(layerId) {
  const focusHint =
    layerId === "wow_change"
      ? "Click a polygon to drill down"
      : "Click a polygon to drill down";
  return `${focusHint} · State → City → District → Ward · Reset to start over`;
}

export function getWowChangeBucket(wowPct) {
  if (!Number.isFinite(wowPct)) return WOW_CHANGE_LEGEND.find((b) => b.id === "up_large");
  if (wowPct < -25) return WOW_CHANGE_LEGEND.find((b) => b.id === "down_large");
  if (wowPct < -5) return WOW_CHANGE_LEGEND.find((b) => b.id === "down_small");
  if (wowPct <= 5) return WOW_CHANGE_LEGEND.find((b) => b.id === "flat");
  if (wowPct <= 25) return WOW_CHANGE_LEGEND.find((b) => b.id === "up_small");
  if (wowPct <= 100) return WOW_CHANGE_LEGEND.find((b) => b.id === "up_medium");
  return WOW_CHANGE_LEGEND.find((b) => b.id === "up_large");
}

export function getWowChangeFillStyle(wowPct) {
  const bucket = getWowChangeBucket(wowPct);
  return {
    fillColor: bucket.fill,
    strokeColor: bucket.stroke,
    fillOpacity: bucket.fillOpacity ?? 0.72,
  };
}

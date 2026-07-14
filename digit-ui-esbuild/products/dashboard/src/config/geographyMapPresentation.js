// Not a component — translate lazily inside render-time functions only (never
// at module level), so language switches pick up fresh strings.
import { translate as t } from "../i18n/localeRuntime";

/** @typedef {'created' | 'open' | 'resolved'} GeographyMapLayerId */

export const GEOGRAPHY_MAP_LAYERS = [
  { id: "created", label: "Created", legendTitle: "Created" },
  { id: "open", label: "Open", legendTitle: "% Open" },
  { id: "resolved", label: "Resolved", legendTitle: "% Resolved" },
];

export const GEOGRAPHY_MAP_LAYER_IDS = new Set(
  GEOGRAPHY_MAP_LAYERS.map((layer) => layer.id)
);

export function isGeographyMapLayerId(value) {
  return GEOGRAPHY_MAP_LAYER_IDS.has(value);
}

export function isGeographyMapVolumeLayerId(layerId) {
  return layerId === "created";
}

export function isGeographyMapShareLayerId(layerId) {
  return layerId === "open" || layerId === "resolved";
}

export function getGeographyMapLayerMeta(layerId) {
  return GEOGRAPHY_MAP_LAYERS.find((layer) => layer.id === layerId);
}

/** Created — complaint count buckets (blue scale). */
export const CREATED_COUNT_LEGEND = [
  { id: "none", label: "No complaints", fill: "#ffffff", stroke: "#d1d5db", fillOpacity: 0.95 },
  { id: "b1", label: "1–3", fill: "#dbeafe", stroke: "#bfdbfe", fillOpacity: 0.78 },
  { id: "b2", label: "4–5", fill: "#93c5fd", stroke: "#60a5fa", fillOpacity: 0.76 },
  { id: "b3", label: "6–8", fill: "#60a5fa", stroke: "#3b82f6", fillOpacity: 0.74 },
  { id: "b4", label: "9–10", fill: "#3b82f6", stroke: "#2563eb", fillOpacity: 0.74 },
  { id: "b5", label: "11–13", fill: "#2563eb", stroke: "#1d4ed8", fillOpacity: 0.76 },
  { id: "b6", label: "14–15", fill: "#1e40af", stroke: "#1e3a8a", fillOpacity: 0.78 },
];

/** % Open — share of filed complaints still open (red scale). */
export const OPEN_SHARE_LEGEND = [
  { id: "none", label: "No complaints", fill: "#ffffff", stroke: "#d1d5db", fillOpacity: 0.95 },
  { id: "p0", label: "0%", fill: "#fff1f2", stroke: "#fecdd3", fillOpacity: 0.78 },
  { id: "p20", label: "≤ 20%", fill: "#fecaca", stroke: "#fca5a5", fillOpacity: 0.76 },
  { id: "p40", label: "20–40%", fill: "#fca5a5", stroke: "#f87171", fillOpacity: 0.74 },
  { id: "p60", label: "40–60%", fill: "#f87171", stroke: "#ef4444", fillOpacity: 0.76 },
  { id: "p80", label: "60–80%", fill: "#ef4444", stroke: "#dc2626", fillOpacity: 0.78 },
  { id: "p100", label: "> 80%", fill: "#991b1b", stroke: "#7f1d1d", fillOpacity: 0.8 },
];

/** % Resolved — share of filed complaints resolved (green scale). */
export const RESOLVED_SHARE_LEGEND = [
  { id: "none", label: "No complaints", fill: "#ffffff", stroke: "#d1d5db", fillOpacity: 0.95 },
  { id: "p0", label: "0%", fill: "#f0fdf4", stroke: "#dcfce7", fillOpacity: 0.78 },
  { id: "p20", label: "≤ 20%", fill: "#bbf7d0", stroke: "#86efac", fillOpacity: 0.76 },
  { id: "p40", label: "20–40%", fill: "#86efac", stroke: "#4ade80", fillOpacity: 0.74 },
  { id: "p60", label: "40–60%", fill: "#4ade80", stroke: "#22c55e", fillOpacity: 0.76 },
  { id: "p80", label: "60–80%", fill: "#16a34a", stroke: "#15803d", fillOpacity: 0.78 },
  { id: "p100", label: "> 80%", fill: "#14532d", stroke: "#052e16", fillOpacity: 0.8 },
];

/** Localized bucket label — English literals stay the fallbacks (extracted for seeding). */
function localizeLegendBucketLabel(label) {
  switch (label) {
    case "No complaints":
      return t("DASHBOARD_MAP_LEGEND_NO_COMPLAINTS", "No complaints");
    case "1–3":
      return t("DASHBOARD_MAP_LEGEND_COUNT_1_3", "1–3");
    case "4–5":
      return t("DASHBOARD_MAP_LEGEND_COUNT_4_5", "4–5");
    case "6–8":
      return t("DASHBOARD_MAP_LEGEND_COUNT_6_8", "6–8");
    case "9–10":
      return t("DASHBOARD_MAP_LEGEND_COUNT_9_10", "9–10");
    case "11–13":
      return t("DASHBOARD_MAP_LEGEND_COUNT_11_13", "11–13");
    case "14–15":
      return t("DASHBOARD_MAP_LEGEND_COUNT_14_15", "14–15");
    case "0%":
      return t("DASHBOARD_MAP_LEGEND_PCT_0", "0%");
    case "≤ 20%":
      return t("DASHBOARD_MAP_LEGEND_PCT_LTE_20", "≤ 20%");
    case "20–40%":
      return t("DASHBOARD_MAP_LEGEND_PCT_20_40", "20–40%");
    case "40–60%":
      return t("DASHBOARD_MAP_LEGEND_PCT_40_60", "40–60%");
    case "60–80%":
      return t("DASHBOARD_MAP_LEGEND_PCT_60_80", "60–80%");
    case "> 80%":
      return t("DASHBOARD_MAP_LEGEND_PCT_GT_80", "> 80%");
    default:
      return label;
  }
}

export function getGeographyMapLegend(layerId) {
  const legend =
    layerId === "open"
      ? OPEN_SHARE_LEGEND
      : layerId === "resolved"
        ? RESOLVED_SHARE_LEGEND
        : CREATED_COUNT_LEGEND;
  return legend.map((bucket) => ({ ...bucket, label: localizeLegendBucketLabel(bucket.label) }));
}

export function getGeographyMapLegendTitle(layerId) {
  if (layerId === "open") return t("DASHBOARD_MAP_LEGEND_TITLE_OPEN", "% Open");
  if (layerId === "resolved") return t("DASHBOARD_MAP_LEGEND_TITLE_RESOLVED", "% Resolved");
  if (layerId === "created") return t("DASHBOARD_MAP_LEGEND_TITLE_CREATED", "Created");
  return t("DASHBOARD_MAP_LEGEND_TITLE", "Map legend");
}

export function getGeographyMapLegendFooter(drillTrailLength = 0) {
  const idx = Math.min(Math.max(drillTrailLength, 0), 3);
  // The focus target is a geo-level name (drill depth key ladder); the footer is
  // composed by plain concatenation — no interpolation syntax in the messages.
  const focusTarget =
    idx === 0
      ? t("DASHBOARD_GEO_LEVEL_0", "district")
      : idx === 1
        ? t("DASHBOARD_GEO_LEVEL_1", "subdistrict")
        : idx === 2
          ? t("DASHBOARD_GEO_LEVEL_2", "sub-subdistrict")
          : t("DASHBOARD_GEO_LEVEL_3", "complaint");
  return (
    t("DASHBOARD_MAP_LEGEND_FOOTER_ZOOM", "Zoom in to drill down · click a ") +
    focusTarget +
    t("DASHBOARD_MAP_LEGEND_FOOTER_FOCUS", " to focus")
  );
}

function bucketToFillStyle(bucket) {
  return {
    fillColor: bucket.fill,
    strokeColor: bucket.stroke,
    fillOpacity: bucket.fillOpacity ?? 0.76,
  };
}

export function getCreatedCountBucket(count) {
  const n = Number(count) || 0;
  if (n <= 0) return CREATED_COUNT_LEGEND[0];
  if (n <= 3) return CREATED_COUNT_LEGEND[1];
  if (n <= 5) return CREATED_COUNT_LEGEND[2];
  if (n <= 8) return CREATED_COUNT_LEGEND[3];
  if (n <= 10) return CREATED_COUNT_LEGEND[4];
  if (n <= 13) return CREATED_COUNT_LEGEND[5];
  return CREATED_COUNT_LEGEND[6];
}

export function getSharePctBucket(pct, legend) {
  const value = Number(pct);
  if (!Number.isFinite(value) || value < 0) return legend[0];
  if (value === 0) return legend[1];
  if (value <= 20) return legend[2];
  if (value <= 40) return legend[3];
  if (value <= 60) return legend[4];
  if (value <= 80) return legend[5];
  return legend[6];
}

export function getCreatedCountFillStyle(count) {
  return bucketToFillStyle(getCreatedCountBucket(count));
}

export function getOpenShareFillStyle(openPct) {
  return bucketToFillStyle(getSharePctBucket(openPct, OPEN_SHARE_LEGEND));
}

export function getResolvedShareFillStyle(resolvedPct) {
  return bucketToFillStyle(getSharePctBucket(resolvedPct, RESOLVED_SHARE_LEGEND));
}

/** @deprecated Legacy WoW styling — map uses created/open/resolved layers only. */
export function getWowChangeFillStyle(wowPct) {
  return getCreatedCountFillStyle(0);
}

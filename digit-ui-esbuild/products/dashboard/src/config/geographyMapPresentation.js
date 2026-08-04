// Not a component — translate lazily inside render-time functions only (never
// at module level), so language switches pick up fresh strings.
import { translate as t } from "../i18n/localeRuntime";
import { formatNumber } from "../utils/numberFormat";

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

/** The white "nothing here" swatch, shared by all three legends. */
export const CREATED_COUNT_NONE = {
  id: "none",
  label: "No complaints",
  fill: "#ffffff",
  stroke: "#d1d5db",
  fillOpacity: 0.95,
};

/** Created — the blue ramp, darkest last. Bucket EDGES are computed per tenant. */
export const CREATED_COUNT_RAMP = [
  { fill: "#dbeafe", stroke: "#bfdbfe", fillOpacity: 0.78 },
  { fill: "#93c5fd", stroke: "#60a5fa", fillOpacity: 0.76 },
  { fill: "#60a5fa", stroke: "#3b82f6", fillOpacity: 0.74 },
  { fill: "#3b82f6", stroke: "#2563eb", fillOpacity: 0.74 },
  { fill: "#2563eb", stroke: "#1d4ed8", fillOpacity: 0.76 },
  { fill: "#1e40af", stroke: "#1e3a8a", fillOpacity: 0.78 },
];

export const MAX_CREATED_COUNT_BUCKETS = CREATED_COUNT_RAMP.length;

/**
 * Fallback scale, used only when no data has been seen yet (and by the legacy
 * getWowChangeFillStyle path). Real scales come from buildCreatedCountScale.
 */
export const CREATED_COUNT_LEGEND = [
  CREATED_COUNT_NONE,
  { id: "b1", label: "1–3", min: 1, max: 3, ...CREATED_COUNT_RAMP[0] },
  { id: "b2", label: "4–5", min: 4, max: 5, ...CREATED_COUNT_RAMP[1] },
  { id: "b3", label: "6–8", min: 6, max: 8, ...CREATED_COUNT_RAMP[2] },
  { id: "b4", label: "9–10", min: 9, max: 10, ...CREATED_COUNT_RAMP[3] },
  { id: "b5", label: "11–13", min: 11, max: 13, ...CREATED_COUNT_RAMP[4] },
  { id: "b6", label: "14+", min: 14, max: Infinity, ...CREATED_COUNT_RAMP[5] },
];

/** Round up to the next 1–2–5 ladder rung (1,2,5,10,20,50,100,…). */
function niceCeil(value) {
  if (!(value > 1)) return 1;
  const decade = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / decade;
  const rung = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return rung * decade;
}

/**
 * Build the Created-layer scale from the values actually on the map (#1461).
 *
 * The old scale was a constant topping out at 15, so on a tenant like bomet —
 * where one ward holds 1250 complaints and the next holds 55 — every ward
 * saturated the darkest bucket and the choropleth carried no information at all.
 *
 * Complaint volume is skewed MULTIPLICATIVELY (1250 / 55 / 3), so the breaks are
 * geometric rather than linear: an equal-interval scale over [0, max] would put
 * all 22 of bomet's smaller wards in bucket 1 and merely invert the bug. Breaks
 * are then snapped up to the 1–2–5 ladder, which is itself near-logarithmic, so
 * "log spacing" and "round human numbers" cost nothing against each other — and
 * quantization gives free hysteresis: the legend only moves when the max crosses
 * a rung, not on every refresh.
 *
 * Quantile/Jenks breaks were rejected: with 6–23 wards they degenerate into a
 * rank map, produce arbitrary labels like "3–1250", and reshuffle on every
 * filter change.
 *
 * The domain must be the WARD-level series. Zoom rolls counts up by summing
 * children, so scaling to the rendered features would rewrite the legend on
 * every scroll step; the open-ended top bucket absorbs rolled-up values instead.
 *
 * Pure and total — safe to call with anything.
 *
 * @param {Array<number>} values raw per-ward counts
 * @returns {{ max: number, breaks: number[], buckets: object[] }}
 */
export function buildCreatedCountScale(values = []) {
  let max = 0;
  for (const raw of Array.isArray(values) ? values : []) {
    const n = Math.trunc(Number(raw));
    if (Number.isFinite(n) && n > max) max = n;
  }
  if (max <= 0) return { max: 0, breaks: [], buckets: [CREATED_COUNT_NONE] };

  let breaks;
  if (max <= MAX_CREATED_COUNT_BUCKETS) {
    // Tiny tenants (mz peaks at 32; a fresh install at 1): give each count its
    // own shade rather than rounding a max of 8 up to a 50-wide bucket.
    breaks = Array.from({ length: max - 1 }, (_, i) => i + 1);
  } else {
    // Geometric interior breaks, snapped up to the ladder. The top bucket is
    // open-ended, so only MAX-1 edges are needed.
    breaks = Array.from({ length: MAX_CREATED_COUNT_BUCKETS - 1 }, (_, i) =>
      niceCeil(max ** ((i + 1) / MAX_CREATED_COUNT_BUCKETS))
    );
  }
  // Snapping collapses duplicates; that is how the scale degrades gracefully to
  // fewer buckets on small domains instead of emitting empty ranges.
  breaks = [...new Set(breaks)].filter((b) => b >= 1 && b < max).sort((a, b) => a - b);

  const edges = [...breaks, Infinity];
  const last = edges.length - 1;
  return {
    max,
    breaks,
    buckets: [
      CREATED_COUNT_NONE,
      ...edges.map((upper, i) => {
        const lower = i === 0 ? 1 : edges[i - 1] + 1;
        // Always anchor the darkest stop to the top bucket, however few there are.
        const ramp =
          CREATED_COUNT_RAMP[
            last === 0 ? CREATED_COUNT_RAMP.length - 1 : Math.round((i * (CREATED_COUNT_RAMP.length - 1)) / last)
          ];
        return { id: `b${i + 1}`, label: formatBucketLabel(lower, upper), min: lower, max: upper, ...ramp };
      }),
    ],
  };
}

/**
 * "1–5" / "501+" / "7". Numerals only: legend labels used to be seeded l10n
 * messages, but a computed range has no fixed key and translate() renders the
 * RAW KEY when a message is missing — so a minted key would paint
 * "DASHBOARD_MAP_LEGEND_COUNT_124_248" on screen. The seeded count messages were
 * byte-identical across en_IN and pt_PT anyway (they were pure numerals), so
 * nothing translatable is lost. Digit grouping still honours the tenant mask.
 */
function formatBucketLabel(lower, upper) {
  const n = (value) => formatNumber(value, { decimals: 0 }) ?? String(value);
  if (upper === Infinity) return `${n(lower)}+`;
  if (lower === upper) return n(lower);
  return `${n(lower)}–${n(upper)}`;
}

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

export function getGeographyMapLegend(layerId, createdBuckets = CREATED_COUNT_LEGEND) {
  const legend =
    layerId === "open"
      ? OPEN_SHARE_LEGEND
      : layerId === "resolved"
        ? RESOLVED_SHARE_LEGEND
        : createdBuckets;
  // The share legends keep their seeded messages; computed count labels are
  // already numerals and fall through localizeLegendBucketLabel's default.
  return legend.map((bucket) => ({ ...bucket, label: localizeLegendBucketLabel(bucket.label) }));
}

/**
 * Pin colours, one per layer. DELIBERATELY not part of any legend array:
 * getGeographyMapLegend returns a colour SCALE that getCreatedCountBucket scans
 * by range, so an extra entry in there would corrupt bucket classification.
 * The pin row is rendered as a separate <li> below the scale.
 */
export const GEOGRAPHY_MAP_PIN_STYLES = {
  created: { fill: "#475569", stroke: "#334155" },
  open: { fill: "#f59e0b", stroke: "#b45309" },
  resolved: { fill: "#16a34a", stroke: "#15803d" },
};

export function getGeographyMapPinStyle(layerId) {
  return GEOGRAPHY_MAP_PIN_STYLES[layerId] || GEOGRAPHY_MAP_PIN_STYLES.created;
}

const pinNum = (value) => {
  const n = Number(value) || 0;
  return formatNumber(n, { decimals: 0 }) ?? String(n);
};

/**
 * The pin legend row: what the pins on the CURRENT layer mean, plus the honesty
 * notes (how many of the layer's complaints actually carry a location, whether
 * the row cap truncated them, and how many complaints have no ward at all and
 * are therefore not on the map anywhere).
 *
 * @param {GeographyMapLayerId} layerId
 * @param {{shown?: number, total?: number, semantics?: 'per-layer'|'open-only',
 *          truncated?: boolean, unmapped?: number}} pins
 * @returns {{swatch: {fill: string, stroke: string}, label: string, note: string}}
 */
export function getGeographyMapPinLegendEntry(layerId, pins = {}) {
  const semantics = pins.semantics === "open-only" ? "open-only" : "per-layer";
  // Old catalog + new UI: pins are still hard-filtered to open complaints, so
  // they cannot follow the toggle. Say that on EVERY layer rather than
  // mislabelling open complaints as "filed" or "resolved".
  const label =
    semantics === "open-only"
      ? t(
          "DASHBOARD_MAP_LEGEND_PINS_OPEN_ONLY",
          "Pins: complaints still open — pins do not follow this layer"
        )
      : layerId === "open"
        ? t("DASHBOARD_MAP_LEGEND_PINS_OPEN", "Pins: complaints still open")
        : layerId === "resolved"
          ? t("DASHBOARD_MAP_LEGEND_PINS_RESOLVED", "Pins: complaints resolved")
          : t("DASHBOARD_MAP_LEGEND_PINS_CREATED", "Pins: complaints filed");

  // No interpolation in the message store — compose by concatenation, the same
  // pattern as getGeographyMapLegendFooter.
  const notes = [];
  const total = Number(pins.total) || 0;
  if (total > 0) {
    notes.push(
      pinNum(pins.shown) +
        t("DASHBOARD_MAP_LEGEND_PINS_COVERAGE_OF", " of ") +
        pinNum(total) +
        t(
          "DASHBOARD_MAP_LEGEND_PINS_COVERAGE_SUFFIX",
          " shown on the map (rest have no location)"
        )
    );
  }
  if (pins.truncated) {
    notes.push(
      t("DASHBOARD_MAP_LEGEND_PINS_TRUNCATED", "Showing the most recent 1,000 only")
    );
  }
  if (Number(pins.unmapped) > 0) {
    notes.push(
      pinNum(pins.unmapped) +
        t(
          "DASHBOARD_MAP_LEGEND_PINS_UNMAPPED",
          " complaints have no ward and are not mapped"
        )
    );
  }

  return { swatch: getGeographyMapPinStyle(layerId), label, note: notes.join(" · ") };
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

/** Range scan, so it classifies against ANY generated scale, not fixed edges. */
export function getCreatedCountBucket(count, buckets = CREATED_COUNT_LEGEND) {
  const scale = Array.isArray(buckets) && buckets.length ? buckets : CREATED_COUNT_LEGEND;
  const n = Number(count) || 0;
  if (n <= 0) return scale[0];
  for (let i = 1; i < scale.length; i += 1) {
    if (n <= scale[i].max) return scale[i];
  }
  // Above every edge — only reachable when the top bucket is not open-ended
  // (rolled-up county values against a stale scale).
  return scale[scale.length - 1];
}

/**
 * `filed` is passed so a ward with NO complaints gets the white "No complaints"
 * swatch. Both share layers compute pct as 0 when filed is 0, and pct 0 maps to
 * legend[1] ("0%") — so the white swatch was unreachable and an empty ward
 * painted identically to one with complaints but none resolved.
 */
export function getSharePctBucket(pct, legend, filed) {
  if (filed !== undefined && !(Number(filed) > 0)) return legend[0];
  const value = Number(pct);
  if (!Number.isFinite(value) || value < 0) return legend[0];
  if (value === 0) return legend[1];
  if (value <= 20) return legend[2];
  if (value <= 40) return legend[3];
  if (value <= 60) return legend[4];
  if (value <= 80) return legend[5];
  return legend[6];
}

export function getCreatedCountFillStyle(count, buckets = CREATED_COUNT_LEGEND) {
  return bucketToFillStyle(getCreatedCountBucket(count, buckets));
}

export function getOpenShareFillStyle(openPct, filed) {
  return bucketToFillStyle(getSharePctBucket(openPct, OPEN_SHARE_LEGEND, filed));
}

export function getResolvedShareFillStyle(resolvedPct, filed) {
  return bucketToFillStyle(getSharePctBucket(resolvedPct, RESOLVED_SHARE_LEGEND, filed));
}

/** @deprecated Legacy WoW styling — map uses created/open/resolved layers only. */
export function getWowChangeFillStyle(wowPct) {
  return getCreatedCountFillStyle(0);
}

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
 * nothing translatable is lost. The esbuild copy additionally applies the tenant digit mask.
 */
function formatBucketLabel(lower, upper) {
  // No numberFormat module in this tree — raw numerals (see the esbuild copy).
  const n = (value) => String(value);
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

export function getGeographyMapLegend(layerId, createdBuckets = CREATED_COUNT_LEGEND) {
  if (layerId === "open") return OPEN_SHARE_LEGEND;
  if (layerId === "resolved") return RESOLVED_SHARE_LEGEND;
  return createdBuckets;
}

export function getGeographyMapLegendTitle(layerId) {
  return getGeographyMapLayerMeta(layerId)?.legendTitle ?? "Map legend";
}

export function getGeographyMapLegendFooter(drillTrailLength = 0) {
  const focusTarget = ["district", "subdistrict", "sub-subdistrict", "complaint"][
    Math.min(Math.max(drillTrailLength, 0), 3)
  ];
  return `Zoom in to drill down · click a ${focusTarget} to focus`;
}

function bucketToFillStyle(bucket) {
  return {
    fillColor: bucket.fill,
    strokeColor: bucket.stroke,
    fillOpacity: bucket.fillOpacity ?? 0.76,
  };
}

export function getCreatedCountBucket(count, buckets = CREATED_COUNT_LEGEND) {
  const scale = Array.isArray(buckets) && buckets.length ? buckets : CREATED_COUNT_LEGEND;
  const n = Number(count) || 0;
  if (n <= 0) return scale[0];
  for (let i = 1; i < scale.length; i += 1) {
    if (n <= scale[i].max) return scale[i];
  }
  return scale[scale.length - 1];
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

export function getCreatedCountFillStyle(count, buckets = CREATED_COUNT_LEGEND) {
  return bucketToFillStyle(getCreatedCountBucket(count, buckets));
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

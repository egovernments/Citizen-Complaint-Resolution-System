/**
 * Per-layer partitioning of the map's complaint pins.
 *
 * The choropleth toggles between Created / Open / Resolved, but the pin overlay
 * used to show ONE set of pins on all three layers — and that set was hard
 * filtered to `is_open` by the pin KPI itself, so the Resolved layer shaded
 * "0 resolved" underneath a scatter of still-open complaints.
 *
 * Lives in its own module (rather than inside KpiTile.jsx) so it is pure and
 * unit-testable without bundling a React tree, matching the other utils/ here.
 */

export const GEO_MAP_LAYER_KEYS = ["created", "open", "resolved"];

/**
 * Split pins into the three map layers.
 *
 *   created  — every pin in the window (a complaint filed IS a pin)
 *   open     — pins whose complaint is still open
 *   resolved — pins whose complaint is resolved
 *
 * `statusKnown === false` means the pin source does not project is_open /
 * is_resolved (the legacy cl_map_complaint_pins def, which is open-only). There
 * is no honest way to partition those, so we keep the legacy behaviour — the
 * same array on all three layers — and the caller labels it 'open-only' in the
 * legend so the reader is not misled.
 *
 * @param {Array<object>} pins
 * @param {boolean} statusKnown
 * @returns {{created: object[], open: object[], resolved: object[]}}
 */
export function partitionPinsByLayer(pins, statusKnown) {
  const all = Array.isArray(pins) ? pins : [];
  if (!statusKnown) return { created: all, open: all, resolved: all };
  return {
    created: all,
    open: all.filter((pin) => pin?.isOpen === true),
    resolved: all.filter((pin) => pin?.isResolved === true),
  };
}

/**
 * Totals over the ward series, plus the counts that the ward mapper DROPS
 * (rows with a null/blank ward code). Those complaints are real and counted by
 * every card on the dashboard; silently discarding them made the map's numbers
 * disagree with the cards with no explanation on screen.
 *
 * @param {Array<object>} rows raw result rows
 * @param {string} dimKey the ward dimension column
 * @returns {{layerTotals: {filed:number,open:number,resolved:number},
 *            unmapped: {filed:number,open:number,resolved:number}}}
 */
export function summarizeWardRows(rows, dimKey) {
  const layerTotals = { filed: 0, open: 0, resolved: 0 };
  const unmapped = { filed: 0, open: 0, resolved: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = String(row?.[dimKey] ?? "").trim();
    const bucket = code && code !== "null" ? layerTotals : unmapped;
    bucket.filed += Number(row?.filed) || 0;
    bucket.open += Number(row?.open) || 0;
    bucket.resolved += Number(row?.resolved) || 0;
  }
  return { layerTotals, unmapped };
}

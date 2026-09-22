/**
 * Grid geometry constants for the catalog-driven dashboard. After the inversion
 * cutover the only consumers are the engine (AdminDashboard), the chart-size
 * baseline (chartScrollBaseline / useScrollableChartSize), and useCatalogLayout —
 * none of which use the old dash-case WIDGETS registry, DEFAULT_LAYOUT seed, or
 * the per-widget helper functions. Those (and their Landscape-config imports) are
 * removed; what remains is pure grid geometry keyed off nothing widget-specific.
 */

export const GRID_COLS = 12;
export const KPI_ROW_HEIGHT = 52;
export const GRID_MARGIN_Y = 16;

/** react-grid-layout placeholder id while dragging from the Add-KPI inventory. */
export const DROPPING_ITEM_ID = "__dropping-kpi__";

export const DROPPING_ITEM = {
  i: DROPPING_ITEM_ID,
  w: 2,
  h: 2,
  x: 0,
  y: 0,
};


/** Default grid size for full-width data tables (header + rows + updated stamp). */
export const FULL_WIDTH_TABLE_GRID = {
  w: 12,
  h: 6,
  minW: 6,
  minH: 4,
  maxW: 12,
  maxH: 14,
};

/** One shared size contract per chart visualization (uniform min/max across charts). */
export const UNIFORM_CHART_SIZE_CONSTRAINTS = {
  minW: 4,
  minH: 4,
  maxW: 12,
  maxH: 10,
};

/** Map widgets benefit from a taller resize range. */
export const MAP_SIZE_CONSTRAINTS = {
  minW: 4,
  minH: 5,
  maxW: 12,
  maxH: 14,
};

/** Default size when adding a chart from the catalog. */
export const DEFAULT_CHART_GRID = { w: 4, h: 6 };

/**
 * Per-chart default sizes (keyed by the legacy dash-case scrollKey). The catalog
 * engine's scrollKey is a kpiId, so chartScrollBaseline's lookups here resolve to
 * undefined and it falls back to measuring the live viewport — this table is kept
 * only to satisfy that import contract and as a baseline for any dash-case key.
 */
export const DEFAULT_CHART_LAYOUT = {
  "cl-table-complaint-type-details": { x: 0, ...FULL_WIDTH_TABLE_GRID },
  "cl-table-complaints-at-risk": { x: 0, ...FULL_WIDTH_TABLE_GRID },
  "ep-table-employee-performance": { x: 0, ...FULL_WIDTH_TABLE_GRID },
  "cl-chart-complaints-by-type": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-departments": { x: 6, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-department-resolution-rate": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-department-flow-ratio": { x: 8, w: 4, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-map-geography-choropleth": { x: 0, w: 8, h: 6, minW: 4, minH: 5, maxW: 12, maxH: 14 },
  "cl-chart-over-time": { x: 0, w: 12, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-resolution-subtype": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-officer-sla": { x: 0, w: 8, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-open-by-type": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
  "cl-chart-open-by-channel": { x: 6, w: 4, h: 5, minW: 3, minH: 4, maxW: 6, maxH: 8 },
  "cl-chart-complaints-by-age": { x: 0, w: 6, h: 6, minW: 4, minH: 4, maxW: 12, maxH: 10 },
};

/**
 * Re-flows the saved 12-column layout into a narrower column count.
 *
 * Pure, and kept with the rest of the grid geometry so it can be pinned under
 * `node --test` without a React harness — the same reason layoutStore exists.
 *
 * Positions are re-flowed in reading order rather than scaled down from the
 * saved x/y. Scaling has to round, and rounding two widgets onto the same cell
 * is an overlap; re-flowing cannot collide by construction.
 *
 * `h` is preserved throughout. The operator chose those heights, and a widget
 * given a larger share of the width can only need less height, never more.
 *
 * This derives a presentation from the saved layout and is never persisted:
 * there is one storage slot per tenant+user with no breakpoint dimension (see
 * utils/layoutStore.js), so writing it back would replace a desktop
 * arrangement with a phone's.
 *
 * @param layout       saved react-grid-layout items
 * @param cols         column count at this breakpoint
 * @param isFullWidth  item => true when it should span the full width. At
 *                     cols=1 everything does, which is the phone case.
 */
export function reflowLayout(layout, cols, isFullWidth = () => true) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return [...layout]
    .sort((a, b) => (a.y - b.y) || (a.x - b.x))
    .map((item) => {
      const w = Math.min(isFullWidth(item) ? cols : 1, cols);
      // Wrap before placing, so a widget never starts mid-row and overflow the
      // right edge.
      if (x + w > cols) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      const placed = { ...item, x, y, w, minW: 1, maxW: cols };
      x += w;
      rowHeight = Math.max(rowHeight, item.h);
      if (x >= cols) {
        x = 0;
        y += rowHeight;
        rowHeight = 0;
      }
      return placed;
    });
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function collidesAt(x, y, w, h, layout) {
  const candidate = { x, y, w, h };
  return layout.some((other) => rectsOverlap(candidate, other));
}

/** First grid slot (reading order) that fits w×h without overlapping any item. */
export function findFirstOpenPosition(layout, w, h, cols = GRID_COLS) {
  const maxY = layout.length ? Math.max(...layout.map((item) => item.y + item.h)) : 0;
  const yLimit = maxY + h + 12;

  for (let y = 0; y <= yLimit; y += 1) {
    for (let x = 0; x <= cols - w; x += 1) {
      if (!collidesAt(x, y, w, h, layout)) {
        return { x, y };
      }
    }
  }

  return { x: 0, y: maxY };
}

// Unit tests for the Add-KPI attach/persist/rehydrate cycle (#1276).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/layoutStore.test.js
//
// The modules under test are ESM (like the rest of products/), so the test
// bundles them to CJS with the repo's own esbuild — the same idiom as
// hierLevelGrouping.test.js and dashboardMetrics.test.js.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle(entry) {
  const out = path.join(
    os.tmpdir(),
    `${path.basename(entry, ".js")}.cjs.${process.pid}.js`
  );
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, entry)],
    bundle: true,
    format: "cjs",
    platform: "neutral",
    outfile: out,
  });
  process.on("exit", () => {
    try {
      fs.unlinkSync(out);
    } catch (e) {
      /* already gone */
    }
  });
  return require(out);
}

const {
  LEGACY_STORAGE_KEY,
  storageKeyFor,
  sizeConstraintsForKpi,
  defaultSizeForKpi,
  buildSeedLayout,
  reconcileLayout,
  resolveInitialLayout,
  addItemToLayout,
  mergeEmittedLayout,
  readSavedLayout,
  persistLayout,
} = bundle("layoutStore.js");

const { DROPPING_ITEM_ID, GRID_COLS } = bundle("../constants/layoutConfig.js");

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Minimal Storage stand-in (the store takes Storage injected). */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

const KPIS = {
  card_a: { kpiId: "card_a", viz: { kind: "number-tile-delta" } },
  card_b: { kpiId: "card_b", viz: { kind: "number-tile" } },
  chart_a: { kpiId: "chart_a", viz: { kind: "stacked-bar" } },
  map_a: { kpiId: "map_a", viz: { kind: "choropleth-map" } },
  table_a: { kpiId: "table_a", viz: { kind: "sla-risk-table" } },
};

const item = (i, x, y, w, h) => ({ i, x, y, w, h });

/* ------------------------------------------------------------------ */
/* storageKeyFor — per-user/tenant scoping                             */
/* ------------------------------------------------------------------ */

test("storageKeyFor scopes by tenant and user, falls back to legacy without identity", () => {
  assert.equal(
    storageKeyFor("ke", "uuid-1"),
    `${LEGACY_STORAGE_KEY}.ke.uuid-1`
  );
  assert.equal(storageKeyFor("ke", null), LEGACY_STORAGE_KEY);
  assert.equal(storageKeyFor(null, "uuid-1"), LEGACY_STORAGE_KEY);
  assert.notEqual(storageKeyFor("ke", "uuid-1"), storageKeyFor("ke", "uuid-2"));
});

/* ------------------------------------------------------------------ */
/* readSavedLayout / persistLayout                                     */
/* ------------------------------------------------------------------ */

test("persist/read round-trips a layout under the scoped key", () => {
  const storage = fakeStorage();
  const key = storageKeyFor("ke", "u1");
  const layout = [item("card_a", 0, 0, 2, 2)];
  persistLayout(storage, key, layout);
  assert.deepEqual(readSavedLayout(storage, key), layout);
});

test("readSavedLayout returns null for absent key and for garbage, [] for an intentional empty layout", () => {
  const storage = fakeStorage({
    garbage: "{not json",
    notarray: JSON.stringify({ i: "x" }),
    empty: "[]",
  });
  assert.equal(readSavedLayout(storage, "missing"), null);
  assert.equal(readSavedLayout(storage, "garbage"), null);
  assert.equal(readSavedLayout(storage, "notarray"), null);
  assert.deepEqual(readSavedLayout(storage, "empty"), []);
});

test("readSavedLayout falls back to the legacy global key exactly once (read-only migration)", () => {
  const legacyLayout = [item("chart_a", 0, 0, 6, 6)];
  const storage = fakeStorage({
    [LEGACY_STORAGE_KEY]: JSON.stringify(legacyLayout),
  });
  const key = storageKeyFor("ke", "u1");
  // Scoped slot empty -> legacy layout surfaces.
  assert.deepEqual(readSavedLayout(storage, key, LEGACY_STORAGE_KEY), legacyLayout);
  // After the user persists, the scoped slot wins and legacy stays untouched.
  const own = [item("card_a", 0, 0, 2, 2)];
  persistLayout(storage, key, own);
  assert.deepEqual(readSavedLayout(storage, key, LEGACY_STORAGE_KEY), own);
  assert.equal(storage.getItem(LEGACY_STORAGE_KEY), JSON.stringify(legacyLayout));
});

test("two users on one browser no longer clobber each other (the #1276 shared-slot failure)", () => {
  const storage = fakeStorage();
  const keyGro = storageKeyFor("ke", "gro-uuid");
  const keySup = storageKeyFor("ke", "supervisor-uuid");

  const groLayout = [item("card_a", 0, 0, 2, 2), item("chart_a", 0, 2, 6, 6)];
  persistLayout(storage, keyGro, groLayout);

  // Supervisor session persists a different arrangement — under ITS key.
  persistLayout(storage, keySup, [item("table_a", 0, 0, 12, 5)]);

  // GRO comes back: additions intact.
  assert.deepEqual(readSavedLayout(storage, keyGro, LEGACY_STORAGE_KEY), groLayout);
});

/* ------------------------------------------------------------------ */
/* Seed / rehydrate                                                    */
/* ------------------------------------------------------------------ */

test("buildSeedLayout keeps only catalog-visible pack tiles, normalised", () => {
  const seed = buildSeedLayout(
    [
      { kpiId: "card_a", x: 0, y: 0, w: 2, h: 2 },
      { kpiId: "ghost_tile", x: 2, y: 0, w: 2, h: 2 }, // not in catalog
    ],
    KPIS
  );
  assert.deepEqual(seed.map((l) => l.i), ["card_a"]);
});

test("resolveInitialLayout: saved layout wins over the seed", () => {
  const seed = buildSeedLayout([{ kpiId: "card_a", x: 0, y: 0, w: 2, h: 2 }], KPIS);
  const saved = [item("chart_a", 0, 0, 6, 6)];
  assert.deepEqual(
    resolveInitialLayout(saved, seed, KPIS).map((l) => l.i),
    ["chart_a"]
  );
  // No saved layout at all -> the pack seed applies.
  assert.deepEqual(
    resolveInitialLayout(null, seed, KPIS).map((l) => l.i),
    ["card_a"]
  );
  // Intentionally-empty saved layout is respected (seed not re-applied).
  assert.deepEqual(resolveInitialLayout([], seed, KPIS), []);
});

test("REGRESSION #1276: saved additions rehydrate even when the pack seed is EMPTY", () => {
  // /v2/analytics/packs returns defaultLayout: [] when no DashboardPack
  // matches the caller's roles — the old hook gated hydration on
  // seed.length and never read the saved layout back for those users.
  const storage = fakeStorage();
  const key = storageKeyFor("ke", "u1");
  const seed = buildSeedLayout([], KPIS); // empty pack layout

  // Session 1: user adds a KPI to an empty dashboard; it persists.
  const added = addItemToLayout([], "card_a", KPIS);
  assert.deepEqual(added.map((l) => l.i), ["card_a"]);
  persistLayout(storage, key, added);

  // Session 2 (reload): hydration must surface the saved tile.
  const rehydrated = resolveInitialLayout(
    readSavedLayout(storage, key, LEGACY_STORAGE_KEY),
    seed,
    KPIS
  );
  assert.deepEqual(rehydrated.map((l) => l.i), ["card_a"]);
});

test("reconcileLayout drops tiles the role can no longer see and repairs malformed geometry", () => {
  const reconciled = reconcileLayout(
    [
      item("card_a", NaN, -3, 99, "h"), // malformed persisted entry
      item("ghost_tile", 0, 0, 2, 2), // no longer in the role catalog
    ],
    KPIS
  );
  assert.deepEqual(reconciled.map((l) => l.i), ["card_a"]);
  const c = sizeConstraintsForKpi("card_a", KPIS);
  const l = reconciled[0];
  assert.ok(Number.isFinite(l.x) && Number.isFinite(l.y));
  assert.ok(l.w >= c.minW && l.w <= c.maxW, `w ${l.w} within [${c.minW},${c.maxW}]`);
  assert.ok(l.h >= c.minH && l.h <= c.maxH, `h ${l.h} within [${c.minH},${c.maxH}]`);
  assert.ok(l.x + l.w <= GRID_COLS);
});

/* ------------------------------------------------------------------ */
/* addItemToLayout — click append + drag-drop placement                */
/* ------------------------------------------------------------------ */

test("click add (no position) lands at the first open slot and persists constraints", () => {
  const layout = [item("card_a", 0, 0, 2, 2)];
  const next = addItemToLayout(layout, "card_b", KPIS);
  assert.equal(next.length, 2);
  const added = next.find((l) => l.i === "card_b");
  assert.deepEqual({ x: added.x, y: added.y }, { x: 2, y: 0 }); // next slot in reading order
  assert.equal(added.minW, 2); // constraints baked in for RGL
});

test("add is a same-reference no-op for unknown or already-placed KPIs", () => {
  const layout = [item("card_a", 0, 0, 2, 2)];
  assert.equal(addItemToLayout(layout, "card_a", KPIS), layout); // duplicate
  assert.equal(addItemToLayout(layout, "not_in_catalog", KPIS), layout); // unknown
});

test("drop position is honoured and clamped into the grid", () => {
  const dropped = addItemToLayout([], "chart_a", KPIS, { x: 4, y: 0 });
  const l = dropped.find((it) => it.i === "chart_a");
  assert.equal(l.x, 4);

  // A drop coordinate past the right edge clamps to keep the tile in-grid.
  const clamped = addItemToLayout([], "chart_a", KPIS, { x: 11, y: 0 });
  const lc = clamped.find((it) => it.i === "chart_a");
  assert.ok(lc.x + lc.w <= GRID_COLS, `x ${lc.x} + w ${lc.w} inside ${GRID_COLS} cols`);
});

test("drop onto occupied coordinates keeps both tiles (vertical compaction, no drop-out)", () => {
  const layout = addItemToLayout([], "chart_a", KPIS, { x: 0, y: 0 });
  const next = addItemToLayout(layout, "map_a", KPIS, { x: 0, y: 0 });
  assert.deepEqual(next.map((l) => l.i).sort(), ["chart_a", "map_a"]);
  // No overlap after compaction.
  const [a, b] = next;
  const overlap =
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  assert.equal(overlap, false);
});

test("defaultSizeForKpi sizes cards/charts/maps/tables distinctly", () => {
  assert.deepEqual(defaultSizeForKpi("card_a", KPIS), { w: 2, h: 2 });
  assert.deepEqual(defaultSizeForKpi("map_a", KPIS), { w: 8, h: 6 }); // incl. choropleth-map
  assert.deepEqual(defaultSizeForKpi("table_a", KPIS), { w: 12, h: 5 });
  assert.deepEqual(defaultSizeForKpi("chart_a", KPIS), { w: 6, h: 6 });
});

/* ------------------------------------------------------------------ */
/* mergeEmittedLayout — RGL echo handling                              */
/* ------------------------------------------------------------------ */

test("mergeEmittedLayout strips RGL's external-drop placeholder so it never persists", () => {
  const prev = [{ ...item("card_a", 0, 0, 2, 2), minW: 2 }];
  const next = [
    item("card_a", 0, 0, 2, 2),
    item(DROPPING_ITEM_ID, 4, 0, 2, 2), // synthetic hover placeholder
  ];
  const merged = mergeEmittedLayout(prev, next);
  assert.deepEqual(merged.map((l) => l.i), ["card_a"]);
});

test("mergeEmittedLayout takes RGL geometry but re-attaches stripped constraints", () => {
  const prev = [{ ...item("card_a", 0, 0, 2, 2), minW: 2, maxH: 3 }];
  const next = [item("card_a", 4, 2, 3, 2)]; // RGL emits bare geometry
  const merged = mergeEmittedLayout(prev, next);
  assert.deepEqual(
    { x: merged[0].x, y: merged[0].y, w: merged[0].w, minW: merged[0].minW, maxH: merged[0].maxH },
    { x: 4, y: 2, w: 3, minW: 2, maxH: 3 }
  );
});

/* ------------------------------------------------------------------ */
/* Drop-coordinate hardening (#1287)                                   */
/* ------------------------------------------------------------------ */

test("REGRESSION #1287: NaN drop coordinates never persist — clamped to a valid cell", () => {
  // An RGL onDrop item computed against unmeasurable geometry can carry NaN
  // x/y. The add must still land, at finite integer coordinates.
  const next = addItemToLayout([], "chart_a", KPIS, { x: NaN, y: NaN });
  const l = next.find((it) => it.i === "chart_a");
  assert.ok(l, "tile attached despite NaN drop coords");
  assert.ok(Number.isInteger(l.x) && Number.isInteger(l.y), `finite ints, got ${l.x},${l.y}`);
  assert.ok(Number.isInteger(l.w) && Number.isInteger(l.h));
});

test("fractional drop coordinates are rounded to whole grid cells", () => {
  // x rounds (3.4 -> 3); y also rounds, then vertical compaction owns the
  // final row (a lone tile is pulled to y 0 regardless).
  const next = addItemToLayout([], "card_a", KPIS, { x: 3.4, y: 1.6 });
  const l = next.find((it) => it.i === "card_a");
  assert.deepEqual({ x: l.x, y: l.y }, { x: 3, y: 0 });
  assert.ok(next.every((it) => Number.isInteger(it.x) && Number.isInteger(it.y)));
});

test("droppingItem size is always finite, even for a kpiId the catalog cannot resolve", () => {
  // dataTransfer.getData is empty during dragover in Chrome; the placeholder
  // is sized from state set at dragstart — but even an unresolvable id must
  // produce a real w/h, or RGL's calcXY turns the whole drag into NaN.
  for (const id of ["ghost_kpi", undefined, null]) {
    const { w, h } = defaultSizeForKpi(id, KPIS);
    assert.ok(Number.isFinite(w) && w > 0, `w finite for ${String(id)}`);
    assert.ok(Number.isFinite(h) && h > 0, `h finite for ${String(id)}`);
  }
  const { w, h } = defaultSizeForKpi("chart_a", undefined); // catalog not yet loaded
  assert.ok(Number.isFinite(w) && Number.isFinite(h));
});

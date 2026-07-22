// Unit tests for the tree-traversal complaint-type filter state
// (descend / ascend / apply / clear / repair / ABAC pruning).
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/complaintTypeTree.test.js
//
// The modules under test are ESM (like the rest of products/), so the test
// bundles them to CJS with the repo's own esbuild — the same idiom as
// hierLevelGrouping.test.js.

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
  ALL,
  buildComplaintTree,
  pruneComplaintTree,
  nodeOf,
  childrenOf,
  parentOf,
  ancestorsOf,
  selectionFromCode,
  clearedSelection,
  complaintTypeParams,
  isValidComplaintPath,
  repairSelection,
  normalizeComplaintTypeValue,
  humanizeTypeCode,
  humanizeDimensionCode,
  looksLikeTaxonomyCodePath,
  browseBaseCode,
  truncateTrail,
  TRAIL_ELLIPSIS,
} = bundle("complaintTypeTree.js");

const { globalParams, buildRefs } = bundle("queryPlan.js");

/* ------------------------------------------------------------------ */
/* Fixtures — a 3-level tree (bomet-like Category → SubType → leaf)     */
/* ------------------------------------------------------------------ */

const rec = (code, parentCode, extra = {}) => ({
  code,
  name: code,
  parentCode,
  active: true,
  ...extra,
});

// SANITATION            (root, name===code → no data-owned label)
//   GARBAGE             (interior, data-owned name)
//     GarbageFull       (leaf)
//     GarbageMissed     (leaf)
//   SEWAGE              (interior)
//     SewageOverflow    (leaf)
// ROADS                 (root)
//   Pothole             (leaf; record carries explicit path)
const RECORDS = [
  rec("SANITATION", null),
  rec("GARBAGE", "SANITATION", { name: "Garbage collection" }),
  rec("GarbageFull", "GARBAGE", { name: "Bin overflowing" }),
  rec("GarbageMissed", "GARBAGE", { name: "Missed pickup" }),
  rec("SEWAGE", "SANITATION"),
  rec("SewageOverflow", "SEWAGE", { name: "Sewage overflow" }),
  rec("ROADS", null),
  rec("Pothole", "ROADS", { name: "Pothole", path: "ROADS.Pothole" }),
];

const tree = () => buildComplaintTree(RECORDS);

/* ------------------------------------------------------------------ */
/* buildComplaintTree                                                   */
/* ------------------------------------------------------------------ */

test("buildComplaintTree: structure, derived paths, record path wins", () => {
  const t = tree();
  assert.equal(t.roots.length, 2);
  assert.deepEqual(
    t.roots.map((r) => r.code).sort(),
    ["ROADS", "SANITATION"]
  );

  const garbage = nodeOf(t, "GARBAGE");
  assert.equal(garbage.path, "SANITATION.GARBAGE"); // derived from parent chain
  assert.equal(garbage.isLeaf, false);
  assert.equal(garbage.label, "Garbage collection");

  const leaf = nodeOf(t, "GarbageFull");
  assert.equal(leaf.path, "SANITATION.GARBAGE.GarbageFull");
  assert.equal(leaf.isLeaf, true);

  // Explicit record path wins over derivation.
  assert.equal(nodeOf(t, "Pothole").path, "ROADS.Pothole");

  // name === code → no data-owned label (localization/humanizer decides).
  assert.equal(nodeOf(t, "SANITATION").label, undefined);
});

test("buildComplaintTree: inactive records and cycles are dropped", () => {
  const t = buildComplaintTree([
    ...RECORDS,
    rec("Inactive", "ROADS", { active: false }),
    rec("CycleA", "CycleB"),
    rec("CycleB", "CycleA"),
  ]);
  assert.equal(nodeOf(t, "Inactive"), null);
  assert.equal(nodeOf(t, "CycleA"), null); // orphan cycle unreachable from roots
  assert.equal(t.roots.length, 2);
});

test("buildComplaintTree: empty/no records → null", () => {
  assert.equal(buildComplaintTree([]), null);
  assert.equal(buildComplaintTree(null), null);
});

/* ------------------------------------------------------------------ */
/* ABAC pruning                                                         */
/* ------------------------------------------------------------------ */

test("prune: branches with zero scoped leaves disappear (dept-scoped view)", () => {
  // Sanitation-dept supervisor: scoped distincts only cover garbage leaves.
  const pruned = pruneComplaintTree(tree(), ["GarbageFull", "GarbageMissed"]);
  assert.deepEqual(pruned.roots.map((r) => r.code), ["SANITATION"]);
  assert.equal(nodeOf(pruned, "SEWAGE"), null); // zero scoped leaves → gone
  assert.equal(nodeOf(pruned, "ROADS"), null); // whole other branch → gone
  assert.equal(nodeOf(pruned, "GARBAGE").isLeaf, false);
  assert.equal(childrenOf(pruned, "GARBAGE").length, 2);
});

test("prune: stray scoped codes (no master record) attach as root leaves", () => {
  const pruned = pruneComplaintTree(tree(), ["Pothole", "QA_STRAY_CODE"]);
  const stray = nodeOf(pruned, "QA_STRAY_CODE");
  assert.ok(stray);
  assert.equal(stray.isLeaf, true);
  assert.equal(stray.path, "QA_STRAY_CODE");
  assert.ok(pruned.roots.some((r) => r.code === "QA_STRAY_CODE"));
});

test("prune: never mutates the input tree; empty scope → null", () => {
  const full = tree();
  pruneComplaintTree(full, ["GarbageFull"]);
  assert.equal(nodeOf(full, "ROADS").code, "ROADS"); // input intact
  assert.equal(nodeOf(full, "SEWAGE").isLeaf, false);
  assert.equal(pruneComplaintTree(full, []), null);
  assert.equal(pruneComplaintTree(null, ["x"]), null);
});

/* ------------------------------------------------------------------ */
/* Traversal: descend / ascend / apply / clear                          */
/* ------------------------------------------------------------------ */

test("descend: root → children are the root categories; child applies", () => {
  const t = tree();
  assert.deepEqual(
    childrenOf(t, ALL).map((n) => n.code).sort(),
    ["ROADS", "SANITATION"]
  );
  // Selecting an interior child applies a subtree selection…
  const sel = selectionFromCode(t, "SANITATION");
  assert.deepEqual(sel, { code: "SANITATION", path: "SANITATION", leaf: false });
  // …and the next level's dropdown lists ITS children (traversal continues).
  assert.deepEqual(
    childrenOf(t, sel.code).map((n) => n.code).sort(),
    ["GARBAGE", "SEWAGE"]
  );
});

test("descend to leaf: selection applies as exact leaf", () => {
  const sel = selectionFromCode(tree(), "GarbageFull");
  assert.deepEqual(sel, {
    code: "GarbageFull",
    path: "SANITATION.GARBAGE.GarbageFull",
    leaf: true,
  });
});

test("ascend: parentOf walks one level up; roots go to ALL", () => {
  const t = tree();
  assert.equal(parentOf(t, "GarbageFull"), "GARBAGE");
  assert.equal(parentOf(t, "GARBAGE"), "SANITATION");
  assert.equal(parentOf(t, "SANITATION"), ALL);
  assert.equal(parentOf(t, "does-not-exist"), ALL);
});

test("breadcrumb: ancestorsOf lists the chain topmost-first", () => {
  const t = tree();
  assert.deepEqual(ancestorsOf(t, "GarbageFull"), ["SANITATION", "GARBAGE"]);
  assert.deepEqual(ancestorsOf(t, "SANITATION"), []);
});

test("clear: ALL / unknown code → cleared selection", () => {
  const t = tree();
  assert.deepEqual(selectionFromCode(t, ALL), clearedSelection());
  assert.deepEqual(selectionFromCode(t, "nope"), clearedSelection());
});

/* ------------------------------------------------------------------ */
/* Param mapping (leaf → serviceCode, interior → complaintPath)         */
/* ------------------------------------------------------------------ */

test("params: root none, leaf serviceCode, interior complaintPath", () => {
  const t = tree();
  assert.deepEqual(complaintTypeParams(clearedSelection()), {});
  assert.deepEqual(complaintTypeParams(selectionFromCode(t, "GarbageFull")), {
    serviceCode: "GarbageFull",
  });
  assert.deepEqual(complaintTypeParams(selectionFromCode(t, "GARBAGE")), {
    complaintPath: "SANITATION.GARBAGE",
  });
});

test("params: legacy string-only persisted state behaves as leaf", () => {
  // Pre-tree localStorage: { complaintType: "GarbageFull" } — no path/leaf keys.
  assert.deepEqual(complaintTypeParams({ code: "GarbageFull" }), {
    serviceCode: "GarbageFull",
  });
});

test("params: complaintPath outside the backend charset/length is NOT sent", () => {
  assert.equal(isValidComplaintPath("SANITATION.GARBAGE"), true);
  assert.equal(isValidComplaintPath("has space"), false);
  assert.equal(isValidComplaintPath("x".repeat(257)), false);
  assert.equal(isValidComplaintPath(""), false);
  assert.deepEqual(
    complaintTypeParams({ code: "WEIRD", path: "weird päth", leaf: false }),
    {} // unfiltered beats a per-entry 400 blanking the tile
  );
});

test("globalParams: filter trio flows into the batch params", () => {
  const interior = {
    geography: "all",
    complaintType: "GARBAGE",
    complaintTypePath: "SANITATION.GARBAGE",
    complaintTypeLeaf: false,
  };
  assert.deepEqual(globalParams(interior), {
    complaintPath: "SANITATION.GARBAGE",
  });

  const leaf = {
    complaintType: "GarbageFull",
    complaintTypePath: "SANITATION.GARBAGE.GarbageFull",
    complaintTypeLeaf: true,
  };
  assert.deepEqual(globalParams(leaf), { serviceCode: "GarbageFull" });

  assert.deepEqual(globalParams({ complaintType: "all" }), {});
  // Legacy persisted shape (no companions) → leaf semantics, exactly today.
  assert.deepEqual(globalParams({ complaintType: "GarbageFull" }), {
    serviceCode: "GarbageFull",
  });
});

test("buildRefs: every tile ref carries the subtree param", () => {
  const kpis = {
    a: { kpiId: "a", viz: { kind: "number-tile" } },
    b: { kpiId: "b", viz: { kind: "stacked-bar" } },
  };
  const refs = buildRefs([{ kpiId: "a" }, { kpiId: "b" }], kpis, {
    complaintType: "SANITATION",
    complaintTypePath: "SANITATION",
    complaintTypeLeaf: false,
  });
  assert.equal(refs.a.params.complaintPath, "SANITATION");
  assert.equal(refs.a__prior.params.complaintPath, "SANITATION");
  assert.equal(refs.b.params.complaintPath, "SANITATION");
  assert.equal(refs.a.params.serviceCode, undefined);
});

/* ------------------------------------------------------------------ */
/* Persisted-selection repair                                           */
/* ------------------------------------------------------------------ */

test("repair: valid node survives; path/leaf drift is normalised", () => {
  const t = tree();
  assert.deepEqual(
    repairSelection(t, { code: "GARBAGE", path: "STALE.PATH", leaf: true }),
    { code: "GARBAGE", path: "SANITATION.GARBAGE", leaf: false }
  );
});

test("repair: vanished node walks UP its stored path to nearest ancestor", () => {
  // e.g. ABAC re-scope or master edit removed the leaf; GARBAGE survives.
  const pruned = pruneComplaintTree(tree(), ["GarbageMissed"]);
  const repaired = repairSelection(pruned, {
    code: "GarbageFull",
    path: "SANITATION.GARBAGE.GarbageFull",
    leaf: true,
  });
  assert.deepEqual(repaired, {
    code: "GARBAGE",
    path: "SANITATION.GARBAGE",
    leaf: false,
  });
});

test("repair: dotted CODES repair to the surviving ancestor, not cleared", () => {
  // Real MDMS codes contain "." (e.g. "complaints.categories.sanitation") —
  // the stored path must be matched by node-path prefix, never split into
  // segments (which would shred one dotted code into several non-codes).
  const full = buildComplaintTree([
    rec("complaints.categories.sanitation", null, { name: "Sanitation" }),
    rec("complaints.types.garbage", "complaints.categories.sanitation", {
      name: "Garbage",
    }),
    rec("complaints.types.sewage", "complaints.categories.sanitation", {
      name: "Sewage",
    }),
  ]);
  // ABAC re-scope drops the garbage leaf; its stored selection must repair
  // UP to the surviving dotted-code ancestor.
  const pruned = pruneComplaintTree(full, ["complaints.types.sewage"]);
  assert.deepEqual(
    repairSelection(pruned, {
      code: "complaints.types.garbage",
      path: "complaints.categories.sanitation.complaints.types.garbage",
      leaf: true,
    }),
    {
      code: "complaints.categories.sanitation",
      path: "complaints.categories.sanitation",
      leaf: false,
    }
  );
});

test("repair: ancestor prefix match respects dot boundaries (ROADS ≠ ROADSIDE)", () => {
  const pruned = pruneComplaintTree(tree(), ["Pothole"]); // ROADS branch only
  assert.deepEqual(
    repairSelection(pruned, {
      code: "RoadsideDump",
      path: "ROADSIDE.RoadsideDump", // "ROADS" is NOT a dot-boundary prefix
      leaf: true,
    }),
    clearedSelection()
  );
});

test("repair: nothing on the stored path survives → cleared", () => {
  const pruned = pruneComplaintTree(tree(), ["Pothole"]); // ROADS branch only
  assert.deepEqual(
    repairSelection(pruned, {
      code: "GarbageFull",
      path: "SANITATION.GARBAGE.GarbageFull",
      leaf: true,
    }),
    clearedSelection()
  );
  assert.deepEqual(repairSelection(null, { code: "X", path: "X" }), clearedSelection());
});

/* ------------------------------------------------------------------ */
/* Filter-change value normalisation (widget trio vs flat-select code)  */
/* ------------------------------------------------------------------ */

test("normalize: trio passes through, bare string means leaf, all clears", () => {
  assert.deepEqual(
    normalizeComplaintTypeValue({ code: "GARBAGE", path: "SANITATION.GARBAGE", leaf: false }),
    { code: "GARBAGE", path: "SANITATION.GARBAGE", leaf: false }
  );
  assert.deepEqual(normalizeComplaintTypeValue("GarbageFull"), {
    code: "GarbageFull",
    path: null,
    leaf: true,
  });
  assert.deepEqual(normalizeComplaintTypeValue("all"), clearedSelection());
  assert.deepEqual(normalizeComplaintTypeValue(null), clearedSelection());
  assert.deepEqual(normalizeComplaintTypeValue({ code: "all" }), clearedSelection());
});

/* ------------------------------------------------------------------ */
/* Persist/load round-trip (config/dashboardFilters sanitizer):        */
/* a tree-fetch failure must NOT forget a persisted interior selection */
/* ------------------------------------------------------------------ */

const {
  loadDashboardFilters,
  persistDashboardFilters,
  reconcileFiltersWithOptions,
} = bundle("../config/dashboardFilters.js");

// dashboardFilters reaches for browser globals (localStorage for the persisted
// filters, window.globalConfigs for the tenant-scoped storage key) — stub the
// minimum for a node round-trip.
function stubBrowserGlobals() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = { localStorage: globalThis.localStorage };
  return () => {
    delete globalThis.localStorage;
    delete globalThis.window;
  };
}

test("tree-fetch failure: persisted interior selection survives a reload cycle, then repairs", () => {
  const restore = stubBrowserGlobals();
  try {
    const full = tree();
    const pruned = pruneComplaintTree(full, [
      "GarbageFull",
      "GarbageMissed",
      "SewageOverflow",
      "Pothole",
    ]);
    // What useFilterOptions emits when the MDMS hierarchy fetch failed but the
    // scoped DISTINCT leaf list loaded: flat complaintType list, NO tree.
    const flatOnly = {
      complaintType: [
        { id: "all", label: "All types" },
        { id: "GarbageFull", label: "Bin overflowing" },
        { id: "GarbageMissed", label: "Missed pickup" },
        { id: "SewageOverflow", label: "Sewage overflow" },
        { id: "Pothole", label: "Pothole" },
      ],
    };

    // Session 1 — tree present: the user applies the interior GARBAGE subtree.
    persistDashboardFilters(
      {
        ...loadDashboardFilters(),
        complaintType: "GARBAGE",
        complaintTypePath: "SANITATION.GARBAGE",
        complaintTypeLeaf: false,
      },
      { ...flatOnly, complaintTypeTree: pruned }
    );

    // Session 2 — transient MDMS hiccup: tree fetch failed, flat list loaded.
    const reloaded = loadDashboardFilters();
    assert.equal(reloaded.complaintType, "GARBAGE"); // cold load trusts the trio
    // A filter change re-persists through the sanitizer's FLAT branch — the
    // held interior trio must be persisted as-is, not cleared (regression:
    // storage was wiped here while in-memory state kept the selection).
    persistDashboardFilters({ ...reloaded, dateFrom: "2026-01-01" }, flatOnly);

    const afterHiccup = loadDashboardFilters();
    assert.deepEqual(
      {
        code: afterHiccup.complaintType,
        path: afterHiccup.complaintTypePath,
        leaf: afterHiccup.complaintTypeLeaf,
      },
      { code: "GARBAGE", path: "SANITATION.GARBAGE", leaf: false }
    );
    // In-memory reconcile against the same flat-only options agrees with
    // storage (no memory/storage split-brain).
    assert.equal(
      reconcileFiltersWithOptions(afterHiccup, flatOnly).complaintType,
      "GARBAGE"
    );

    // Session 3 — tree is back: the held selection repairs through the tree
    // branch. Exact node survives here…
    const treeBack = reconcileFiltersWithOptions(afterHiccup, {
      ...flatOnly,
      complaintTypeTree: pruned,
    });
    assert.deepEqual(
      {
        code: treeBack.complaintType,
        path: treeBack.complaintTypePath,
        leaf: treeBack.complaintTypeLeaf,
      },
      { code: "GARBAGE", path: "SANITATION.GARBAGE", leaf: false }
    );
    // …and a re-scope that dropped the whole branch repairs to cleared, so
    // holding through the hiccup never pins a permanently-invalid selection.
    const rescoped = pruneComplaintTree(full, ["Pothole"]);
    assert.equal(
      reconcileFiltersWithOptions(afterHiccup, {
        ...flatOnly,
        complaintTypeTree: rescoped,
      }).complaintType,
      ALL
    );

    // Unchanged flat-branch behavior: a persisted LEAF still validates against
    // the flat list — a vanished leaf clears exactly as before.
    persistDashboardFilters(
      {
        ...reloaded,
        complaintType: "GhostLeaf",
        complaintTypePath: null,
        complaintTypeLeaf: true,
      },
      flatOnly
    );
    assert.equal(loadDashboardFilters().complaintType, ALL);
  } finally {
    restore();
  }
});

/* ------------------------------------------------------------------ */
/* Traversal-panel browse state (chip + panel design pass)              */
/* ------------------------------------------------------------------ */

// ke's PGR_TEST-shaped 4-level tree (Category → Type → SubType → leaf),
// deeper than the 2-level live PGR tree — the trail-truncation case.
const DEEP_RECORDS = [
  rec("Infra", null, { name: "Infrastructure" }),
  rec("Water", "Infra", { name: "Water supply" }),
  rec("WaterQuality", "Water", { name: "Water quality" }),
  rec("WaterMuddy", "WaterQuality", { name: "Muddy water" }),
  rec("WaterSmelly", "WaterQuality", { name: "Smelly water" }),
  rec("WaterPressure", "Water", { name: "Low pressure" }),
];
const deepTree = () => buildComplaintTree(DEEP_RECORDS);

test("browseBaseCode: root/unknown → all, interior → itself, leaf → parent", () => {
  const t = tree();
  assert.equal(browseBaseCode(t, ALL), ALL);
  assert.equal(browseBaseCode(t, "NOPE"), ALL);
  assert.equal(browseBaseCode(null, "GARBAGE"), ALL);
  // interior: its children are on show
  assert.equal(browseBaseCode(t, "GARBAGE"), "GARBAGE");
  // leaf: siblings on show with the leaf selected (one-click switching)
  assert.equal(browseBaseCode(t, "GarbageFull"), "GARBAGE");
  // root-level leaf's parent is the virtual root
  const pruned = pruneComplaintTree(t, ["GarbageFull", "STRAY"]);
  assert.equal(browseBaseCode(pruned, "STRAY"), ALL);
});

test("browseBaseCode: 4-level tree opens a deep leaf at its direct parent", () => {
  const t = deepTree();
  assert.equal(browseBaseCode(t, "WaterMuddy"), "WaterQuality");
  assert.equal(browseBaseCode(t, "WaterQuality"), "WaterQuality");
});

test("truncateTrail: short trails come back untouched (same array)", () => {
  const short = ["all", "Infra", "Water"];
  assert.equal(truncateTrail(short, 4), short);
  const exact = ["all", "Infra", "Water", "WaterQuality"];
  assert.equal(truncateTrail(exact, 4), exact);
});

test("truncateTrail: deep trails keep root + nearest, elide the middle", () => {
  const t = deepTree();
  // Browsing at depth 3 of the 4-level tree: all › Infra › Water › WaterQuality
  const full = [ALL, ...ancestorsOf(t, "WaterQuality"), "WaterQuality"];
  assert.deepEqual(full, ["all", "Infra", "Water", "WaterQuality"]);
  assert.equal(truncateTrail(full, 4), full); // depth 3 still fits

  // One level deeper than max: middle elided, endpoints kept.
  const deeper = [...full, "WaterMuddy"];
  assert.deepEqual(truncateTrail(deeper, 4), [
    "all",
    TRAIL_ELLIPSIS,
    "WaterQuality",
    "WaterMuddy",
  ]);

  // Degenerate max (< 3) can't hold first+ellipsis+last → untouched.
  assert.equal(truncateTrail(deeper, 2), deeper);
});

test("TRAIL_ELLIPSIS can never collide with a real code", () => {
  assert.equal(isValidComplaintPath(TRAIL_ELLIPSIS), false);
});

/* ------------------------------------------------------------------ */
/* Label fallback                                                       */
/* ------------------------------------------------------------------ */

test("humanizeTypeCode: never surfaces a raw dotted code", () => {
  assert.equal(humanizeTypeCode("complaints.categories.sanitation"), "Sanitation");
  assert.equal(humanizeTypeCode("MedicalServices"), "Medical Services");
  assert.equal(humanizeTypeCode("GARBAGE_NEEDS_ATTENTION"), "GARBAGE NEEDS ATTENTION");
  assert.equal(humanizeTypeCode("streetLight-broken"), "Street Light Broken");
  assert.equal(
    humanizeTypeCode("complaints.categories.Defibrillator/Suction"),
    "Defibrillator / Suction"
  );
  assert.equal(humanizeTypeCode(""), "");
});

test("humanizeDimensionCode: ward/dept codes become readable titles", () => {
  assert.equal(humanizeDimensionCode("ETOEROLES_WARD_1"), "Etoeroles Ward 1");
  assert.equal(humanizeDimensionCode("BOMET_CHEPALUNGU_CHEBUNYO"), "Chepalungu Chebunyo");
  assert.equal(humanizeDimensionCode("MEDICAL_SVC"), "Medical Svc");
  assert.equal(humanizeDimensionCode("PMC_Z1_B1_L1"), "Pmc Z1 B1 L1");
});

test("looksLikeTaxonomyCodePath: catches EN and PT path-shaped labels", () => {
  assert.equal(looksLikeTaxonomyCodePath("complaints.categories.DamagedRoad"), true);
  assert.equal(looksLikeTaxonomyCodePath("reclamações.categories.DamagedRoad"), true);
  assert.equal(looksLikeTaxonomyCodePath("Street Light Not Working"), false);
  assert.equal(looksLikeTaxonomyCodePath("Lixo"), false);
});

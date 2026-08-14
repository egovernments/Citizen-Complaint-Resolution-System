// Unit tests for the geography drill-down filter state (CCSD-2171):
// boundary tree build (pipe paths matching the analytics MV), ABAC pruning,
// selection→params (leaf ward / interior boundaryPath), repair, normalize.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/boundaryTree.test.js
//
// Same ESM→CJS esbuild bundling idiom as complaintTypeTree.test.js.

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
  buildBoundaryTree,
  pruneBoundaryTree,
  geographySelectionFromCode,
  clearedGeographySelection,
  geographyParams,
  isValidBoundaryPath,
  repairGeographySelection,
  normalizeGeographyValue,
  humanizeBoundaryCode,
} = bundle("boundaryTree.js");

// The live cms-pilot shape: Provincia roots (no country node), 3 levels —
// exactly what boundary-relationships/_search?includeChildren=true returns.
const API_ROOTS = [
  {
    code: "maputo_cidade",
    boundaryType: "Provincia",
    children: [
      {
        code: "katembe",
        boundaryType: "Distrito",
        children: [
          { code: "municipio_maputo_katembe", boundaryType: "Municipio", children: [] },
        ],
      },
      {
        code: "kanyaka",
        boundaryType: "Distrito",
        children: [
          { code: "municipio_maputo_kanyaka", boundaryType: "Municipio", children: [] },
        ],
      },
    ],
  },
  {
    code: "PROVINCIA_001",
    boundaryType: "Provincia",
    children: [
      {
        code: "DISTRITO_001",
        boundaryType: "Distrito",
        children: [{ code: "MUNICIPIO_001", boundaryType: "Municipio", children: [] }],
      },
    ],
  },
];

test("buildBoundaryTree derives pipe paths matching the analytics MV boundary_path", () => {
  const tree = buildBoundaryTree(API_ROOTS);
  assert.equal(tree.roots.length, 2);
  // Verified live: facts boundary_path = "maputo_cidade|kanyaka|municipio_maputo_kanyaka"
  assert.equal(
    tree.byCode.get("municipio_maputo_kanyaka").path,
    "maputo_cidade|kanyaka|municipio_maputo_kanyaka"
  );
  assert.equal(tree.byCode.get("katembe").path, "maputo_cidade|katembe");
  assert.equal(tree.byCode.get("maputo_cidade").isLeaf, false);
  assert.equal(tree.byCode.get("MUNICIPIO_001").isLeaf, true);
});

test("buildBoundaryTree handles empty/missing input", () => {
  assert.equal(buildBoundaryTree(null), null);
  assert.equal(buildBoundaryTree([]), null);
});

test("pruneBoundaryTree keeps only branches with scoped wards, attaches strays", () => {
  const tree = buildBoundaryTree(API_ROOTS);
  const pruned = pruneBoundaryTree(tree, ["municipio_maputo_katembe", "stray_ward"]);
  // katembe branch survives, kanyaka + the QA province do not
  assert.ok(pruned.byCode.has("maputo_cidade"));
  assert.ok(pruned.byCode.has("katembe"));
  assert.ok(pruned.byCode.has("municipio_maputo_katembe"));
  assert.ok(!pruned.byCode.has("kanyaka"));
  assert.ok(!pruned.byCode.has("PROVINCIA_001"));
  // scoped ward with no boundary record → root-level leaf, never lost
  assert.ok(pruned.byCode.has("stray_ward"));
  assert.equal(pruned.byCode.get("stray_ward").parentCode, null);
  // pruning never mutates the input
  assert.ok(tree.byCode.has("kanyaka"));
});

test("pruneBoundaryTree with no scoped wards / no tree → null (flat fallback)", () => {
  const tree = buildBoundaryTree(API_ROOTS);
  assert.equal(pruneBoundaryTree(tree, []), null);
  assert.equal(pruneBoundaryTree(null, ["x"]), null);
});

test("geographyParams: leaf → ward (today's wire shape), interior → boundaryPath", () => {
  const tree = buildBoundaryTree(API_ROOTS);
  const leaf = geographySelectionFromCode(tree, "municipio_maputo_katembe");
  assert.deepEqual(geographyParams(leaf), { ward: "municipio_maputo_katembe" });

  const interior = geographySelectionFromCode(tree, "katembe");
  assert.deepEqual(geographyParams(interior), { boundaryPath: "maputo_cidade|katembe" });

  assert.deepEqual(geographyParams(clearedGeographySelection()), {});
  // legacy persisted string-only state (leaf flag undefined) → leaf ward
  assert.deepEqual(geographyParams({ code: "w1" }), { ward: "w1" });
});

test("interior path failing backend validation is NOT sent (unfiltered beats 400)", () => {
  assert.deepEqual(
    geographyParams({ code: "x", path: "bad path with spaces", leaf: false }),
    {}
  );
});

test("isValidBoundaryPath accepts pipe paths, rejects SQL-ish garbage", () => {
  assert.ok(isValidBoundaryPath("maputo_cidade|katembe|municipio_maputo_katembe"));
  assert.ok(isValidBoundaryPath("mz"));
  for (const bad of ["a b", "x%y", "a;b", "x'y", "", null, "a".repeat(513)]) {
    assert.equal(isValidBoundaryPath(bad), false, String(bad));
  }
});

test("repairGeographySelection: exact wins, vanished walks up pipe path, else cleared", () => {
  const tree = buildBoundaryTree(API_ROOTS);
  const pruned = pruneBoundaryTree(tree, ["municipio_maputo_katembe"]);

  // exact node survives
  assert.equal(
    repairGeographySelection(pruned, { code: "katembe", path: "maputo_cidade|katembe" }).code,
    "katembe"
  );
  // vanished ward (kanyaka pruned) → nearest surviving ancestor by pipe-prefix
  const repaired = repairGeographySelection(pruned, {
    code: "municipio_maputo_kanyaka",
    path: "maputo_cidade|kanyaka|municipio_maputo_kanyaka",
  });
  assert.equal(repaired.code, "maputo_cidade");
  // nothing valid → cleared
  assert.equal(
    repairGeographySelection(pruned, { code: "ghost", path: "other|ghost" }).code,
    "all"
  );
  // "all" / no tree → cleared, never throws
  assert.equal(repairGeographySelection(pruned, { code: "all" }).code, "all");
  assert.equal(repairGeographySelection(null, { code: "katembe" }).code, "all");
});

test("normalizeGeographyValue: trio object, legacy bare string, cleared", () => {
  assert.deepEqual(normalizeGeographyValue("w1"), { code: "w1", path: null, leaf: true });
  assert.deepEqual(normalizeGeographyValue("all"), clearedGeographySelection());
  assert.deepEqual(normalizeGeographyValue(null), clearedGeographySelection());
  assert.deepEqual(
    normalizeGeographyValue({ code: "katembe", path: "maputo_cidade|katembe", leaf: false }),
    { code: "katembe", path: "maputo_cidade|katembe", leaf: false }
  );
  assert.deepEqual(normalizeGeographyValue({ code: "all" }), clearedGeographySelection());
});

test("humanizeBoundaryCode never surfaces raw underscores/pipes", () => {
  assert.equal(humanizeBoundaryCode("municipio_maputo_katembe"), "Municipio Maputo Katembe");
  assert.equal(humanizeBoundaryCode("a|b|distrito_x"), "Distrito X");
  assert.equal(humanizeBoundaryCode(""), "");
});

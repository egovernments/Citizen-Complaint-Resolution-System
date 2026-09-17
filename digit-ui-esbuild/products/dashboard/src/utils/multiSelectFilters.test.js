const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const esbuild = require("esbuild");

function bundle(entry) {
  const out = path.join(
    os.tmpdir(),
    `${path.basename(entry)}.${process.pid}.cjs`
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
    } catch {
      /* already gone */
    }
  });
  return require(out);
}

const {
  normalizeStringList,
  normalizeHierarchySelections,
  selectedCodes,
  toggleHierarchySelection,
  removeHierarchySelection,
  mergeFlatHierarchySelections,
} = bundle("multiSelectFilters.js");
const { globalParams } = bundle("queryPlan.js");

const leaf = (code) => ({ code, path: code, leaf: true, codes: [code] });
const parent = (code, codes) => ({ code, path: code, leaf: false, codes });

test("normalization trims, de-duplicates and drops sentinels", () => {
  assert.deepEqual(normalizeStringList([" A ", "all", "", "A", null, "B"]), [
    "A",
    "B",
  ]);
  assert.deepEqual(
    normalizeHierarchySelections([leaf("A"), leaf("A"), null, { code: "all" }]),
    [leaf("A")]
  );
});

test("hierarchy toggle canonicalizes parent/descendant overlap", () => {
  const sanitation = parent("SANITATION", ["Garbage", "Sewage"]);
  assert.deepEqual(toggleHierarchySelection([leaf("Garbage")], sanitation), [
    sanitation,
  ]);
  assert.deepEqual(toggleHierarchySelection([sanitation], leaf("Garbage")), [
    sanitation,
  ]);
  assert.deepEqual(toggleHierarchySelection([sanitation], sanitation), []);
  assert.deepEqual(
    removeHierarchySelection([sanitation, leaf("Road")], "SANITATION"),
    [leaf("Road")]
  );
});

test("selected hierarchy nodes expand to unique exact scoped codes", () => {
  assert.deepEqual(
    selectedCodes([
      parent("SANITATION", ["Garbage", "Sewage"]),
      leaf("Sewage"),
      leaf("Road"),
    ]),
    ["Garbage", "Sewage", "Road"]
  );
});

test("flat fallback Apply preserves interior selection metadata", () => {
  const sanitation = parent("SANITATION", ["Garbage", "Sewage"]);
  // Re-applying the same codes through the flat picker must keep leaf:false
  // and the expanded codes list — not rewrite as a leaf covering only itself.
  assert.deepEqual(
    mergeFlatHierarchySelections(["SANITATION", "Road"], [sanitation, leaf("Road")]),
    [sanitation, leaf("Road")]
  );
  // Brand-new codes from the flat list are true leaves.
  assert.deepEqual(mergeFlatHierarchySelections(["WARD_9"], [sanitation]), [
    { code: "WARD_9", path: null, leaf: true, codes: ["WARD_9"] },
  ]);
  // Dropped codes stay dropped.
  assert.deepEqual(mergeFlatHierarchySelections(["Road"], [sanitation, leaf("Road")]), [
    leaf("Road"),
  ]);
});

test("query plan preserves scalar wire shape for one value and uses plural params for many", () => {
  assert.deepEqual(
    globalParams({
      geographies: [leaf("WARD_1")],
      complaintTypes: [leaf("Pothole")],
      departments: ["ROADS"],
    }),
    { ward: "WARD_1", serviceCode: "Pothole", departments: ["ROADS"] }
  );

  assert.deepEqual(
    globalParams({
      geographies: [parent("DISTRICT", ["WARD_1", "WARD_2"])],
      complaintTypes: [
        parent("SANITATION", ["Garbage", "Sewage"]),
        leaf("Pothole"),
      ],
      departments: ["SANITATION", "ROADS"],
      dateRangeActive: true,
      dateFrom: "2026-08-01",
      dateTo: "2026-08-18",
    }),
    {
      wards: ["WARD_1", "WARD_2"],
      serviceCodes: ["Garbage", "Sewage", "Pothole"],
      departments: ["SANITATION", "ROADS"],
      dateFrom: "2026-08-01",
      dateTo: "2026-08-18",
    }
  );
});

test("held interior selections (empty codes) still emit path params", () => {
  assert.deepEqual(
    globalParams({
      geographies: [
        {
          code: "katembe",
          path: "mz|maputo_cidade|katembe",
          leaf: false,
          codes: [],
        },
      ],
      complaintTypes: [
        { code: "SANITATION", path: "SANITATION", leaf: false, codes: [] },
      ],
    }),
    {
      boundaryPath: "mz|maputo_cidade|katembe",
      complaintPath: "SANITATION",
    }
  );
});

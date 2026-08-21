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

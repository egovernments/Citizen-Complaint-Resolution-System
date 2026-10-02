// Pins the inbox filter's complaint category and subcategory: the categories
// listed, and which complaint types a selection searches.
// Run from digit-ui-esbuild/:  node --test tests/complaintCategories.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/complaintCategories.js");
const OUT = path.join(os.tmpdir(), `complaintCategories.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { complaintCategories, serviceCodesForFilter, subcategoryFits } = require(OUT);

// The inbox's complaint types: a subcategory each, carrying its category.
const defs = [
  { serviceCode: "StreetLightNotWorking", menuPath: "StreetLights", menuPathName: "Street Lights" },
  { serviceCode: "GarbageNeedsTobeCleared", menuPath: "Garbage", menuPathName: "Garbage" },
  { serviceCode: "NoStreetlight", menuPath: "StreetLights", menuPathName: "Street Lights" },
  { serviceCode: "DamagedGarbageBin", menuPath: "Garbage", menuPathName: "Garbage" },
  { serviceCode: "Others", menuPath: "", menuPathName: "" },
];
// A seeded label for one category; the other falls back to its node name.
const t = (key) => ({ "COMPLAINT_HIERARCHY.GARBAGE": "Solid Waste" })[key] || key;

test("one category per parent, labelled as the app labels a node, sorted by label", () => {
  assert.deepEqual(complaintCategories(defs, t), [
    { code: "Garbage", label: "Solid Waste", serviceCodes: ["GarbageNeedsTobeCleared", "DamagedGarbageBin"] },
    { code: "StreetLights", label: "Street Lights", serviceCodes: ["StreetLightNotWorking", "NoStreetlight"] },
  ]);
  assert.deepEqual(complaintCategories(undefined, t), []);
  assert.deepEqual(complaintCategories(null, t), []);
});

test("a subcategory searches itself; a category alone searches all of its subcategories", () => {
  const [garbage] = complaintCategories(defs, t);
  assert.deepEqual(serviceCodesForFilter({ serviceCode: "DamagedGarbageBin" }, garbage), ["DamagedGarbageBin"]);
  assert.deepEqual(serviceCodesForFilter(null, garbage), ["GarbageNeedsTobeCleared", "DamagedGarbageBin"]);
  assert.deepEqual(serviceCodesForFilter({ serviceCode: "NoStreetlight" }, null), ["NoStreetlight"]);
  // Nothing picked: no constraint at all, not an empty match.
  assert.deepEqual(serviceCodesForFilter(null, null), []);
  assert.deepEqual(serviceCodesForFilter(undefined, { code: "Empty", serviceCodes: [] }), []);
});

test("picking a category drops a subcategory that isn't one of its own, a parentless one included", () => {
  const [garbage, streetLights] = complaintCategories(defs, t);
  assert.equal(subcategoryFits({ serviceCode: "DamagedGarbageBin", menuPath: "Garbage" }, garbage), true);
  assert.equal(subcategoryFits({ serviceCode: "DamagedGarbageBin", menuPath: "Garbage" }, streetLights), false);
  // "Others" has no parent (menuPath ""), so no category keeps it.
  assert.equal(subcategoryFits({ serviceCode: "Others", menuPath: "" }, garbage), false);
  // Nothing to check against: no subcategory, or no category picked.
  assert.equal(subcategoryFits(null, garbage), true);
  assert.equal(subcategoryFits({ serviceCode: "Others", menuPath: "" }, null), true);
});

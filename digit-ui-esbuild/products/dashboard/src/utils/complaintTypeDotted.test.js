// #637: a category whose subtree holds a dotted code (e.g. "complaints.categories.NoStreetlight") is sent as
// serviceCodes (its subtree's codes), because the dashboard grains leave complaint_node_path NULL there and a
// complaintPath subtree filter empties every tile. Trees without dotted codes keep complaintPath.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/utils/complaintTypeDotted.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

function bundle(entry) {
  const out = path.join(os.tmpdir(), `${path.basename(entry, ".js")}.dotted.cjs.${process.pid}.js`);
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
  buildComplaintTree,
  selectionFromCode,
  complaintTypeParams,
  normalizeComplaintTypeValue,
  subtreeCodesIfPathless,
  MAX_SERVICE_CODES,
} = bundle("complaintTypeTree.js");
const { globalParams } = bundle("queryPlan.js");
const { sanitizeFilters } = bundle("../config/globalFilterGroups.js");

const rec = (code, parentCode) => ({ code, name: code, parentCode, active: true });

// complaints.categories.NoStreetlight     (dotted root)
//   StreetLightNotWorking                 (leaf)
//   LightPoleDamaged                      (leaf)
// MEDICAL                                 (root)
//   complaints.categories.Absenteeism     (dotted interior)
//     StaffAbsent                         (leaf)
//   DrugShortage                          (leaf)
// SANITATION                              (root, no dots anywhere)
//   GARBAGE                               (interior)
//     GarbageFull                         (leaf)
const RECORDS = [
  rec("complaints.categories.NoStreetlight", null),
  rec("StreetLightNotWorking", "complaints.categories.NoStreetlight"),
  rec("LightPoleDamaged", "complaints.categories.NoStreetlight"),
  rec("MEDICAL", null),
  rec("complaints.categories.Absenteeism", "MEDICAL"),
  rec("StaffAbsent", "complaints.categories.Absenteeism"),
  rec("DrugShortage", "MEDICAL"),
  rec("SANITATION", null),
  rec("GARBAGE", "SANITATION"),
  rec("GarbageFull", "GARBAGE"),
];
const tree = () => buildComplaintTree(RECORDS);

test("a dotted category is sent as its subtree's codes, not complaintPath", () => {
  const sel = selectionFromCode(tree(), "complaints.categories.NoStreetlight");
  assert.deepEqual(sel.codes, [
    "LightPoleDamaged",
    "StreetLightNotWorking",
    "complaints.categories.NoStreetlight",
  ]);
  assert.deepEqual(complaintTypeParams(sel), {
    serviceCodes: ["LightPoleDamaged", "StreetLightNotWorking", "complaints.categories.NoStreetlight"],
  });
});

test("an ancestor of a dotted interior node goes by codes too (its leaves' paths are NULL)", () => {
  const sel = selectionFromCode(tree(), "MEDICAL");
  assert.deepEqual(complaintTypeParams(sel), {
    serviceCodes: ["DrugShortage", "MEDICAL", "StaffAbsent", "complaints.categories.Absenteeism"],
  });
});

test("a node below a dotted ancestor goes by codes", () => {
  const t = buildComplaintTree([
    rec("complaints.categories.Roads", null),
    rec("POTHOLES", "complaints.categories.Roads"),
    rec("PotholeDeep", "POTHOLES"),
  ]);
  assert.deepEqual(complaintTypeParams(selectionFromCode(t, "POTHOLES")), {
    serviceCodes: ["POTHOLES", "PotholeDeep"],
  });
});

test("trees without dotted codes keep complaintPath; leaves keep serviceCode", () => {
  const t = tree();
  assert.equal(subtreeCodesIfPathless(t, "SANITATION"), null);
  assert.deepEqual(complaintTypeParams(selectionFromCode(t, "GARBAGE")), {
    complaintPath: "SANITATION.GARBAGE",
  });
  assert.deepEqual(complaintTypeParams(selectionFromCode(t, "StreetLightNotWorking")), {
    serviceCode: "StreetLightNotWorking",
  });
});

test("over the backend's cap the subtree falls back to complaintPath", () => {
  const recs = [rec("complaints.categories.Big", null)];
  for (let i = 0; i < MAX_SERVICE_CODES; i++) recs.push(rec(`Leaf${i}`, "complaints.categories.Big"));
  const t = buildComplaintTree(recs);
  assert.equal(subtreeCodesIfPathless(t, "complaints.categories.Big"), null);
  assert.deepEqual(complaintTypeParams(selectionFromCode(t, "complaints.categories.Big")), {
    complaintPath: "complaints.categories.Big",
  });
});

test("codes survive normalize, the persisted filters and globalParams", () => {
  const t = tree();
  const sel = normalizeComplaintTypeValue(selectionFromCode(t, "complaints.categories.NoStreetlight"));
  assert.equal(sel.codes.length, 3);
  assert.equal(normalizeComplaintTypeValue({ code: "X", leaf: true, codes: ["X"] }).codes, undefined);

  const raw = {
    complaintType: sel.code,
    complaintTypePath: sel.path,
    complaintTypeLeaf: sel.leaf,
    complaintTypeCodes: sel.codes,
  };
  const stored = sanitizeFilters(raw, { complaintTypeTree: t });
  assert.deepEqual(stored.complaintTypeCodes, sel.codes);
  // before the tree loads the persisted codes are trusted as they are
  assert.deepEqual(sanitizeFilters(raw, {}).complaintTypeCodes, sel.codes);
  assert.deepEqual(globalParams(stored).serviceCodes, sel.codes);
  assert.equal(globalParams(stored).complaintPath, undefined);

  // an ordinary interior selection persists codes: null and still sends complaintPath
  const g = sanitizeFilters(
    { complaintType: "GARBAGE", complaintTypePath: "SANITATION.GARBAGE", complaintTypeLeaf: false },
    { complaintTypeTree: t }
  );
  assert.equal(g.complaintTypeCodes, null);
  assert.deepEqual(globalParams(g), { complaintPath: "SANITATION.GARBAGE" });
});

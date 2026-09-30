// Pins the filing form's boundary cascade: every level listed from the start,
// a pick fills the levels above it, and a lower pick survives only under it.
// Run from digit-ui-esbuild/:  node --test tests/boundaryCascade.test.js

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = path.join(__dirname, "../products/pgr/src/utils/boundaryCascade.js");
const OUT = path.join(os.tmpdir(), `boundaryCascade.cjs.${process.pid}.js`);
esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, format: "cjs", platform: "neutral", outfile: OUT });
process.on("exit", () => {
  try {
    fs.unlinkSync(OUT);
  } catch {
    // Best effort; the temp file is process-scoped.
  }
});
const { disambiguateLabels, optionsForLevels, pathsByCode, selectionAfterPick } = require(OUT);

const node = (code, boundaryType, children = []) => ({ code, name: code, boundaryType, children });

// Country (above the shown levels) > County > Sub County > Ward, with a
// "TOWNSHIP" ward name under two sub-counties.
const tree = [
  node("KE", "Country", [
    node("BOMET", "County", [
      node("BOMET_EAST", "SubCounty", [node("BE_TOWNSHIP", "Ward"), node("CHEMANER", "Ward")]),
      node("CHEPALUNGU", "SubCounty", [node("CH_TOWNSHIP", "Ward"), node("SIGOR", "Ward")]),
    ]),
    node("KERICHO", "County", [node("AINAMOI", "SubCounty", [node("KAPSOIT", "Ward")])]),
  ]),
];
const hierarchy = ["Country", "County", "SubCounty", "Ward"];
const shownLevels = ["County", "SubCounty", "Ward"];
const paths = pathsByCode(tree);
const byCode = (code) => paths.get(code).at(-1);
const codes = (nodes) => nodes.map((n) => n.code);
const pick = (code, selected = {}) =>
  selectionAfterPick(byCode(code), selected, { hierarchy, shownLevels, paths });
const selectionCodes = (selected) =>
  Object.fromEntries(Object.entries(selected).map(([type, n]) => [type, n.code]));

test("with nothing chosen, every level lists every node of its type", () => {
  const options = optionsForLevels(shownLevels, {}, tree);
  assert.deepEqual(codes(options.County), ["BOMET", "KERICHO"]);
  assert.deepEqual(codes(options.SubCounty), ["BOMET_EAST", "CHEPALUNGU", "AINAMOI"]);
  assert.deepEqual(codes(options.Ward), ["BE_TOWNSHIP", "CHEMANER", "CH_TOWNSHIP", "SIGOR", "KAPSOIT"]);
});

test("a level lists only what sits under the nearest choice above it", () => {
  const options = optionsForLevels(shownLevels, { County: byCode("BOMET") }, tree);
  assert.deepEqual(codes(options.SubCounty), ["BOMET_EAST", "CHEPALUNGU"]);
  // The ward level skips the unchosen sub-county and anchors on the county.
  assert.deepEqual(codes(options.Ward), ["BE_TOWNSHIP", "CHEMANER", "CH_TOWNSHIP", "SIGOR"]);
});

test("picking a ward first fills its own sub-county and county", () => {
  assert.deepEqual(selectionCodes(pick("SIGOR")), {
    County: "BOMET",
    SubCounty: "CHEPALUNGU",
    Ward: "SIGOR",
  });
});

test("a root above the shown levels never enters the selection", () => {
  assert.equal(pick("KAPSOIT").Country, undefined);
});

test("re-picking a level keeps a lower choice that is still under it", () => {
  const selected = pick("SIGOR");
  assert.deepEqual(selectionCodes(pick("BOMET", selected)), {
    County: "BOMET",
    SubCounty: "CHEPALUNGU",
    Ward: "SIGOR",
  });
});

test("picking another branch drops the lower choices outside it", () => {
  const selected = pick("SIGOR");
  assert.deepEqual(selectionCodes(pick("KERICHO", selected)), { County: "KERICHO" });
  assert.deepEqual(selectionCodes(pick("BOMET_EAST", selected)), { County: "BOMET", SubCounty: "BOMET_EAST" });
});

test("only names shared within a level carry their parent", () => {
  const options = ["BE_TOWNSHIP", "CHEMANER", "CH_TOWNSHIP"].map((code) => ({
    value: code,
    label: code.endsWith("TOWNSHIP") ? "Township" : "Chemaner",
    node: byCode(code),
  }));
  const parentLabelOf = (n) => paths.get(n.code).at(-2).name;
  assert.deepEqual(disambiguateLabels(options, parentLabelOf), [
    { value: "BE_TOWNSHIP", label: "Township (BOMET_EAST)" },
    { value: "CHEMANER", label: "Chemaner" },
    { value: "CH_TOWNSHIP", label: "Township (CHEPALUNGU)" },
  ]);
});

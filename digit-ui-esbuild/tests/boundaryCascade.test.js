// Pins the filing form's boundary cascade: every level listed from the start
// (a very long one waits for the level above), a pick fills the levels above
// it and clears the ones below.
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
const { disambiguateLabels, levelsFilledAbove, optionsForLevels, pathsByCode, selectionAfterPick } = require(OUT);

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
const pick = (code) => selectionAfterPick(byCode(code), { shownLevels, paths });
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

test("re-picking a level's current value clears the levels below it", () => {
  // After a ward, picking its own county again widens back to the county
  // (the inbox filter's way back from a ward).
  assert.deepEqual(selectionCodes(pick("BOMET")), { County: "BOMET" });
  assert.deepEqual(selectionCodes(pick("CHEPALUNGU")), { County: "BOMET", SubCounty: "CHEPALUNGU" });
});

test("picking another branch keeps nothing from the old one", () => {
  assert.deepEqual(selectionCodes(pick("KERICHO")), { County: "KERICHO" });
  assert.deepEqual(selectionCodes(pick("BOMET_EAST")), { County: "BOMET", SubCounty: "BOMET_EAST" });
});

test("a level too long to list whole waits for the level above", () => {
  const capped = optionsForLevels(shownLevels, {}, tree, { maxUnanchored: 4 });
  // Five wards with nothing chosen is over the cap of four.
  assert.equal(capped.Ward, null);
  // The top level always lists, whatever its size.
  assert.deepEqual(codes(capped.County), ["BOMET", "KERICHO"]);
  const anchored = optionsForLevels(shownLevels, { SubCounty: byCode("CHEPALUNGU") }, tree, { maxUnanchored: 1 });
  assert.deepEqual(codes(anchored.Ward), ["CH_TOWNSHIP", "SIGOR"]);
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

test("a pick reports how many levels above it it filled in", () => {
  const first = pick("SIGOR");
  assert.equal(levelsFilledAbove(byCode("SIGOR"), {}, first, hierarchy), 2);
  // Walking down from a chosen county fills nothing above.
  const county = pick("BOMET");
  assert.equal(levelsFilledAbove(byCode("CHEPALUNGU"), county, pick("CHEPALUNGU"), hierarchy), 0);
  // A ward from another sub-county changes the one above it.
  assert.equal(levelsFilledAbove(byCode("CHEMANER"), first, pick("CHEMANER"), hierarchy), 1);
});

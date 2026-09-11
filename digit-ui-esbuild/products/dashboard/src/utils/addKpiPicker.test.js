const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/utils/addKpiPicker.test.js

const out = path.join(os.tmpdir(), `add-kpi-picker.${process.pid}.cjs`);
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "addKpiPicker.js")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: out,
  logLevel: "silent",
});
const { buildAvailableKpis } = require(out);

const catalog = [
  { id: "zulu", metric: "Zulu complaints" },
  { id: "alpha", metric: "Alpha open" },
  { id: "mike", metric: "Median resolution" },
  { id: "bravo", metric: "bravo backlog" },
];

test("buildAvailableKpis sorts alphabetically by label (case-insensitive)", () => {
  const items = buildAvailableKpis(catalog, [], "");
  assert.deepEqual(
    items.map((it) => it.metric),
    ["Alpha open", "bravo backlog", "Median resolution", "Zulu complaints"]
  );
});

test("buildAvailableKpis excludes tiles already on the layout", () => {
  const items = buildAvailableKpis(catalog, ["alpha", "mike"], "");
  assert.deepEqual(
    items.map((it) => it.id),
    ["bravo", "zulu"]
  );
});

test("buildAvailableKpis filters by search on label and id", () => {
  assert.deepEqual(
    buildAvailableKpis(catalog, [], "median").map((it) => it.id),
    ["mike"]
  );
  assert.deepEqual(
    buildAvailableKpis(catalog, [], "ZULU").map((it) => it.id),
    ["zulu"]
  );
  assert.deepEqual(
    buildAvailableKpis(catalog, [], "bravo").map((it) => it.id),
    ["bravo"]
  );
});

test("AddKpiDropdown wires search input + sorted list helper", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "components", "AddKpiDropdown.jsx"), "utf8");
  assert.match(source, /buildAvailableKpis/);
  assert.match(source, /dashboard-add-kpi-search/);
  assert.match(source, /DASHBOARD_HEADER_SEARCH_KPIS/);
});

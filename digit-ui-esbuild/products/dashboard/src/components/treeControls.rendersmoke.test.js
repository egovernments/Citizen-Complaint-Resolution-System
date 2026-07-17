// ReactDOMServer render smoke for the design-pass controls: the
// complaint-type chip + traversal panel and the per-widget settings gear
// ("Group by" menu), at root / interior / leaf / 4-level-deep states (ke's
// PGR_TEST-shaped hierarchy, not just the 2-level live PGR tree).
//
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/components/treeControls.rendersmoke.test.js
//
// The components are ESM/JSX, so the test bundles a small render entry with
// the repo's own esbuild (React included in the bundle so the hooks
// dispatcher matches the server renderer — no external duplicates), the same
// idiom as the utils suites. renderToStaticMarkup exercises the closed chip
// for the full widgets and the panel body directly (it is portal-free by
// design; the PopoverMenu portal itself only mounts client-side).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = `
import React from "react";
import ReactDOMServer from "react-dom/server";
import ComplaintTypeTreeFilter, { ComplaintTypeTreePanel } from "./ComplaintTypeTreeFilter.jsx";
import GroupByLevelSelect from "./GroupByLevelSelect.jsx";
import { buildComplaintTree } from "../utils/complaintTypeTree";

export { buildComplaintTree };
export const renderFilter = (props) =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(ComplaintTypeTreeFilter, props));
export const renderPanel = (props) =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(ComplaintTypeTreePanel, props));
export const renderGroupBy = (props) =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(GroupByLevelSelect, props));
`;

function bundleEntry() {
  const out = path.join(os.tmpdir(), `tree-controls-smoke.${process.pid}.cjs.js`);
  esbuild.buildSync({
    stdin: {
      contents: ENTRY,
      resolveDir: __dirname,
      loader: "jsx",
      sourcefile: "smoke-entry.jsx",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    loader: { ".jsx": "jsx", ".js": "jsx" },
    outfile: out,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": '"test"' },
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

const { renderFilter, renderPanel, renderGroupBy, buildComplaintTree } = bundleEntry();

// t: echo the seed English so assertions read naturally (the real runtime
// echoes the KEY when unseeded — copy is not what this smoke verifies).
const t = (key, seedEnglish) => seedEnglish || key;

const rec = (code, parentCode, name) => ({ code, name: name || code, parentCode, active: true });

// ke PGR_TEST-shaped 4-level hierarchy: Category → Type → SubType → leaf.
// (WaterMuddy additionally carries a 5th-level child so a browse position
// DEEPER than TRAIL_MAX exists — the trail-elision render case.)
const DEEP_TREE = buildComplaintTree([
  rec("Infra", null, "Infrastructure"),
  rec("Water", "Infra", "Water supply"),
  rec("WaterQuality", "Water", "Water quality"),
  rec("WaterMuddy", "WaterQuality", "Muddy water"),
  rec("WaterMuddySource", "WaterMuddy", "Muddy at source"),
  rec("WaterSmelly", "WaterQuality", "Smelly water"),
  rec("WaterPressure", "Water", "Low pressure"),
  rec("Roads", null, "Roads"),
  rec("Pothole", "Roads", "Pothole"),
]);

const noop = () => {};

/* ---------------- chip (closed widget) states ---------------- */

test("chip smoke: root state shows All types with menu semantics", () => {
  const html = renderFilter({
    tree: DEEP_TREE,
    filters: { complaintType: "all" },
    onFilterChange: noop,
    t,
  });
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /All types/);
  assert.doesNotMatch(html, /<select/);
});

test("chip smoke: depth-1 interior selection shows its label", () => {
  const html = renderFilter({
    tree: DEEP_TREE,
    filters: { complaintType: "Infra" },
    onFilterChange: noop,
    t,
  });
  assert.match(html, /Infrastructure/);
  assert.doesNotMatch(html, /<select/);
});

test("chip smoke: deep leaf shows parent › leaf with elision marker", () => {
  const html = renderFilter({
    tree: DEEP_TREE,
    filters: { complaintType: "WaterMuddy" },
    onFilterChange: noop,
    t,
  });
  // "… › Water quality › Muddy water" — nearest ancestor + leaf, middle elided.
  assert.match(html, /Water quality/);
  assert.match(html, /Muddy water/);
  assert.match(html, /dashboard-popover-chip-seg--muted/);
  // full trail is recoverable from the title
  assert.match(html, /title="Infrastructure › Water supply › Water quality › Muddy water"/);
});

/* ---------------- panel states ---------------- */

test("panel smoke: root — categories listed, no All-in row, reset pinned", () => {
  const html = renderPanel({ tree: DEEP_TREE, appliedCode: "all", onApply: noop, t });
  assert.match(html, /role="menuitem"/);
  assert.match(html, /Infrastructure/);
  assert.match(html, /Roads/);
  assert.doesNotMatch(html, /All in/);
  assert.match(html, /dashboard-popover-footer/);
  assert.match(html, /All types/);
  // interior children carry the descend chevron slot
  assert.match(html, /dashboard-menu-item-trailing/);
});

test("panel smoke: interior — trail, All-in row, children", () => {
  const html = renderPanel({ tree: DEEP_TREE, appliedCode: "Water", onApply: noop, t });
  // browse opens AT the applied interior node
  assert.match(html, /dashboard-popover-trail/);
  assert.match(html, /All in Water supply/);
  // the applied subtree row renders checked
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /Water quality/);
  assert.match(html, /Low pressure/);
});

test("panel smoke: leaf — opens at parent with the leaf checked among siblings", () => {
  const html = renderPanel({ tree: DEEP_TREE, appliedCode: "WaterSmelly", onApply: noop, t });
  assert.match(html, /All in Water quality/);
  assert.match(html, /Muddy water/);
  assert.match(html, /data-selected="true"[^>]*>[\s\S]*?Smelly water/);
  assert.match(html, /aria-checked="true"/);
});

test("panel smoke: 4-level-deep leaf — full trail fits, every level labeled", () => {
  const html = renderPanel({ tree: DEEP_TREE, appliedCode: "WaterSmelly", onApply: noop, t });
  // browse opens at WaterQuality (depth 3): all › Infrastructure › Water
  // supply › Water quality — exactly TRAIL_MAX, no elision needed.
  assert.match(html, /All types/);
  assert.match(html, /Water supply/);
  assert.match(html, /Water quality/);
  assert.doesNotMatch(html, /dashboard-popover-trail-ellipsis/);
  // labels, never raw codes, in the trail text
  assert.doesNotMatch(html, />WaterQuality</);
});

test("panel smoke: deeper than TRAIL_MAX — trail middle-truncates with ellipsis", () => {
  const html = renderPanel({
    tree: DEEP_TREE,
    appliedCode: "WaterMuddySource",
    onApply: noop,
    t,
  });
  // browse opens at WaterMuddy (depth 4): all › … › Water quality › Muddy water
  assert.match(html, /dashboard-popover-trail-ellipsis/);
  assert.match(html, /All types/); // root endpoint kept clickable
  assert.match(html, /Water quality/); // nearest ancestors kept
  assert.match(html, /Muddy water/);
  // elided levels stay recoverable from the ellipsis title
  assert.match(html, /title="Infrastructure › Water supply"/);
  assert.match(html, /All in Muddy water/);
});

/* ---------------- Group-by chip ---------------- */

const LEVELS = [
  { levelCode: "CATEGORY", label: "Category", order: 1 },
  { levelCode: "TYPE", label: "Type", order: 2 },
];
const OPTIONS = [
  { value: "1", level: LEVELS[0] },
  { value: "leaf", leaf: true },
];

test("group-by smoke: settings gear icon button, no native select, menu semantics", () => {
  const html = renderGroupBy({
    value: "1",
    options: OPTIONS,
    hierarchyType: "PGR_TEST",
    onChange: noop,
  });
  assert.doesNotMatch(html, /<select/);
  // icon-only anchor in the remove-button idiom — NOT a text chip
  assert.match(html, /dashboard-popover-iconbtn/);
  assert.doesNotMatch(html, /dashboard-popover-chip/);
  assert.match(html, /<svg/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.match(html, /aria-expanded="false"/);
  // accessible name + tooltip carry the label and the current value (the
  // unseeded smoke runtime echoes the KEY for the label — copy is not what
  // this smoke verifies; "Category" resolves from the level's own label)
  assert.match(html, /aria-label="DASHBOARD_GROUPBY_LABEL"/);
  assert.match(html, /title="DASHBOARD_GROUPBY_LABEL: Category"/);
  assert.match(html, /dashboard-widget-settings-wrap/);
});

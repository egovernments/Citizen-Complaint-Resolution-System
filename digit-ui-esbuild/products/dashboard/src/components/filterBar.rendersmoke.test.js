// ReactDOMServer render smoke for the filter top bar's design parity
// (issue #1797 follow-up): every dropdown in the bar goes through the shared
// PopoverMenu primitive — a native <select> pops the OS menu, which renders
// visibly unlike every other dropdown on the page (the bomet report's
// "dropdown types" difference). Also pins the two font-fallback fixes for the
// public page, where no vendor CSS sets a <body> font: portal-mounted panels
// must re-apply .dashboard-root, and public-dashboard.html must set a sans
// body font of its own.
//
// Run from digit-ui-esbuild/:
//   node --test products/dashboard/src/components/filterBar.rendersmoke.test.js
//
// Same idiom as treeControls.rendersmoke.test.js: the components are ESM/JSX,
// so the test bundles a small render entry with the repo's own esbuild.
// renderToStaticMarkup exercises the closed chips; the PopoverMenu portal
// itself only mounts client-side, so the portal wrapper's class is asserted
// against the source.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const esbuild = require("esbuild");

const ENTRY = `
import React from "react";
import ReactDOMServer from "react-dom/server";
import DashboardFilters from "./DashboardFilters.jsx";

export const renderFilters = (props) =>
  ReactDOMServer.renderToStaticMarkup(React.createElement(DashboardFilters, props));
`;

function bundleEntry() {
  const out = path.join(os.tmpdir(), `filter-bar-smoke.${process.pid}.cjs.js`);
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

const { renderFilters } = bundleEntry();

const TZ = "Africa/Nairobi";
const noop = () => {};

const baseProps = {
  filters: { geography: "all", complaintType: "all" },
  onFilterChange: noop,
  onClearFilters: noop,
  timeZone: TZ,
};

/* ---------------- dropdown types: PopoverMenu everywhere ---------------- */

test("filter bar renders no native <select> — ward and type are PopoverMenu chips", () => {
  const html = renderFilters({
    ...baseProps,
    filterOptions: {
      geography: [
        { id: "all", label: "All wards" },
        { id: "W01", label: "Ward One" },
      ],
      complaintType: [
        { id: "all", label: "All types" },
        { id: "WATER", label: "Water supply" },
      ],
    },
  });
  assert.doesNotMatch(html, /<select/);
  assert.match(html, /aria-label="Ward filter"[^>]*aria-haspopup="menu"|aria-haspopup="menu"[^>]*aria-label="Ward filter"/);
  assert.match(
    html,
    /aria-label="Complaint type filter"[^>]*aria-haspopup="menu"|aria-haspopup="menu"[^>]*aria-label="Complaint type filter"/
  );
});

test("ward chip shows the selected ward's label", () => {
  const html = renderFilters({
    ...baseProps,
    filters: { geography: "W01", complaintType: "all" },
    filterOptions: {
      geography: [
        { id: "all", label: "All wards" },
        { id: "W01", label: "Ward One" },
      ],
    },
  });
  assert.match(html, /Ward One/);
  assert.doesNotMatch(html, /<select/);
});

test("ward chip degrades to a disabled Loading state while options resolve", () => {
  const html = renderFilters({
    ...baseProps,
    filterOptionsLoading: true,
  });
  assert.match(html, /Loading…/);
  assert.match(html, /disabled/);
});

/* ---------------- fonts: portals + the public page body ---------------- */

test("Add KPI portal panel re-applies .dashboard-root for the scoped font", () => {
  const source = fs.readFileSync(path.join(__dirname, "AddKpiDropdown.jsx"), "utf8");
  // The panel portals to document.body; without dashboard-root the public page
  // (no vendor CSS on <body>) renders it in the browser's default serif.
  assert.match(source, /className="dashboard-root dashboard-add-kpi-panel/);
});

test("public-dashboard.html sets a sans body font (no vendor CSS to inherit)", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "public", "public-dashboard.html"),
    "utf8"
  );
  const bodyRule = html.match(/body\s*\{[^}]*\}/g)?.find((rule) => rule.includes("font-family"));
  assert.ok(bodyRule, "expected a body{} rule declaring font-family");
  assert.match(bodyRule, /Inter, Roboto, ui-sans-serif, system-ui, sans-serif/);
});

// Guards the pin-click crash from #1576.
// Run from digit-ui-esbuild/:  node --test products/dashboard/src/components/mapTooltipTeardown.test.js
//
// Leaflet 1.9's Map.closeTooltip(tooltip) dereferences its argument:
//     closeTooltip: function (tooltip) { tooltip.close(); return this; }
// so `map.closeTooltip()` throws TypeError. Thrown from the pin click handler,
// that exception aborted the event BEFORE Leaflet's own bindPopup listener ran,
// so clicking a complaint pin silently did nothing.
//
// GeographyChoroplethMap.jsx cannot be bundled here (it pulls in Leaflet, React
// and CSS), so this asserts the two things that actually matter: the real
// Leaflet signature still behaves as assumed, and the source carries no bare
// `map.closeTooltip()` call in either dashboard copy.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/** Strip comments so the scan sees code, not the note explaining the bug. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const COPIES = [
  path.join(__dirname, "GeographyChoroplethMap.jsx"),
  path.join(__dirname, "../../../../../frontend/micro-ui/web/src/dashboard/components/GeographyChoroplethMap.jsx"),
];

test("Leaflet's Map.closeTooltip still requires an argument", () => {
  // If a Leaflet upgrade ever makes the bare call safe, this fails and the
  // workaround can be revisited — rather than being cargo-culted forever.
  const src = fs.readFileSync(
    path.join(__dirname, "../../../../node_modules/leaflet/dist/leaflet-src.js"),
    "utf8"
  );
  const match = src.match(/closeTooltip: function \(tooltip\) \{\s*tooltip\.close\(\);/);
  assert.ok(match, "Map.closeTooltip no longer dereferences its argument — re-check the workaround");
});

for (const file of COPIES) {
  const label = file.includes("digit-ui-esbuild") || !file.includes("micro-ui") ? "esbuild" : "legacy";
  test(`no bare map.closeTooltip() in the ${label} map component`, () => {
    if (!fs.existsSync(file)) return; // legacy tree may be absent in some checkouts
    const src = stripComments(fs.readFileSync(file, "utf8"));
    assert.equal(
      /\bmap\.closeTooltip\(\s*\)/.test(src),
      false,
      "bare map.closeTooltip() throws in Leaflet 1.9 — use closeOpenTooltips(map)"
    );
    assert.ok(fs.readFileSync(file, "utf8").includes("function closeOpenTooltips"), "closeOpenTooltips helper missing");
  });

  test(`complaint pins bind a hover tooltip in the ${label} map component`, () => {
    if (!fs.existsSync(file)) return;
    const src = fs.readFileSync(file, "utf8");
    // Pins previously had bindPopup (click) only, so hovering one showed nothing
    // while still stealing the pointer from the ward polygon beneath it.
    assert.ok(
      /circle\.bindTooltip\(/.test(src),
      "pins must bind a tooltip or hovering a pin hides the ward tooltip and shows nothing"
    );
  });
}

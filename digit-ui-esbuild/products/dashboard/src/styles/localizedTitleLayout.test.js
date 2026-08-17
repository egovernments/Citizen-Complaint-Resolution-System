const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const styles = fs.readFileSync(path.resolve(__dirname, "input.css"), "utf8");
const dashboard = fs.readFileSync(path.resolve(__dirname, "../AdminDashboard.jsx"), "utf8");

const cssRule = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS rule for ${selector}`);
  return match[1];
};

test("localized widget titles wrap instead of using the truncation utility", () => {
  const titleRule = cssRule(".dashboard-drag-handle-title");

  assert.doesNotMatch(titleRule, /tw-truncate/);
  assert.match(titleRule, /-webkit-line-clamp:\s*2/);
  assert.match(titleRule, /overflow-wrap:\s*anywhere/);
  assert.match(titleRule, /white-space:\s*normal/);
  assert.doesNotMatch(
    dashboard,
    /SHARED_CHROME\.dragHandleTitle[^\n]*tw-truncate/,
  );
});

test("localized KPI titles have room for three lines at desktop widths", () => {
  assert.match(
    cssRule(".dashboard-kpi-card--metric"),
    /grid-template-rows:\s*minmax\(0, auto\)/,
  );

  for (const variant of ["metric", "delta", "sparkline"]) {
    assert.match(
      cssRule(`.dashboard-kpi-card--${variant} .dashboard-kpi-title`),
      /-webkit-line-clamp:\s*3/,
      `${variant} KPI title should allow three lines`,
    );
  }
});

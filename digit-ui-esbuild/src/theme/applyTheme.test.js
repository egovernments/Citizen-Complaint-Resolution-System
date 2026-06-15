const { test } = require("node:test");
const assert = require("node:assert/strict");

function stubDocument() {
  const props = {};
  // Minimal element + head stub so the v2-scope bridge (createElement +
  // appendChild + getElementById) can run under node:test.
  const elements = {};
  const head = { children: [], appendChild(el) { this.children.push(el); } };
  global.document = {
    documentElement: {
      style: {
        setProperty(name, value) { props[name] = value; },
      },
    },
    head,
    createElement(tag) {
      return { tagName: tag.toUpperCase(), id: "", textContent: "" };
    },
    getElementById(id) {
      return head.children.find((el) => el.id === id) || elements[id] || null;
    },
  };
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  return { props, head, restore: () => { console.warn = origWarn; console.log = origLog; } };
}

function freshApply() {
  delete require.cache[require.resolve("./applyTheme.js")];
  return require("./applyTheme.js").applyTheme;
}

test("valid config: writes all flattened variables", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: {
        primary: { main: "#ff0000", light: "#ff8080", dark: "#800000" },
        secondary: "#00ff00",
      },
    });
    assert.equal(props["--color-primary-main"], "#ff0000");
    assert.equal(props["--color-primary-light"], "#ff8080");
    assert.equal(props["--color-primary-dark"], "#800000");
    assert.equal(props["--color-secondary"], "#00ff00");
  } finally { restore(); }
});

test("missing colors key: valid config shape, no-op", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "1" });
    assert.deepEqual(props, {});
  } finally { restore(); }
});

test("invalid value shape (not a hex): no-op", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "1", colors: { primary: { main: "not-a-color" } } });
    assert.deepEqual(props, {});
  } finally { restore(); }
});

test("MDMS-shaped config with code field: applies colors, ignores extra properties", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      code: "kenya-green",
      name: "Kenya Green",
      tenantId: "ke",
      auditDetails: { createdBy: "admin", lastModifiedBy: "admin" },
      colors: {
        primary: { main: "#006B3F", dark: "#004D2C" },
        secondary: "#BB0000",
      },
    });
    assert.equal(props["--color-primary-main"], "#006B3F");
    assert.equal(props["--color-primary-dark"], "#004D2C");
    assert.equal(props["--color-secondary"], "#BB0000");
  } finally { restore(); }
});

test("null / undefined / non-object config: no-op", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme(null);
    applyTheme(undefined);
    applyTheme(42);
    applyTheme("theme");
    applyTheme([1, 2]);
    assert.deepEqual(props, {});
  } finally { restore(); }
});

// ── v2 semantic expansion ───────────────────────────────────────────────────

test("v2: `brand` fans out to --color-primary-main", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "2", colors: { brand: "#FEC931" } });
    assert.equal(props["--color-primary-main"], "#FEC931");
  } finally { restore(); }
});

test("v2: `brand-on` fans out to primary-dark, primary-accent, link-*, text-heading", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "2", colors: { brand: "#FEC931", "brand-on": "#204F37" } });
    assert.equal(props["--color-primary-dark"], "#204F37");
    assert.equal(props["--color-primary-accent"], "#204F37");
    assert.equal(props["--color-link-normal"], "#204F37");
    assert.equal(props["--color-link-hover"], "#204F37");
    assert.equal(props["--color-text-heading"], "#204F37");
  } finally { restore(); }
});

test("v2: `surface-header` covers both --color-secondary and --color-digitv2-header-sidenav", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "2", colors: { brand: "#FEC931", "surface-header": "#1D2433" } });
    assert.equal(props["--color-secondary"], "#1D2433");
    assert.equal(props["--color-digitv2-header-sidenav"], "#1D2433");
  } finally { restore(); }
});

test("v2: `text-disabled` collapses both `grey.disabled` and `digitv2.text-color-disabled`", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "2", colors: { brand: "#FEC931", "text-disabled": "#B1B4B6" } });
    assert.equal(props["--color-grey-disabled"], "#B1B4B6");
    assert.equal(props["--color-digitv2-text-color-disabled"], "#B1B4B6");
  } finally { restore(); }
});

test("v2: `border` collapses both border and input-border", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "2", colors: { brand: "#FEC931", border: "#D6D5D4" } });
    assert.equal(props["--color-border"], "#D6D5D4");
    assert.equal(props["--color-input-border"], "#D6D5D4");
  } finally { restore(); }
});

test("v2: `error` writes both --color-error and --color-error-dark (semantics collapse)", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "2", colors: { brand: "#FEC931", error: "#E02D3A" } });
    assert.equal(props["--color-error"], "#E02D3A");
    assert.equal(props["--color-error-dark"], "#E02D3A");
  } finally { restore(); }
});

test("v2: `chart-palette` array fans out to chart-1..5", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "2",
      colors: {
        brand: "#FEC931",
        "chart-palette": ["#204F37", "#FEC931", "#2A5084", "#E02D3C", "#128F21"],
      },
    });
    assert.equal(props["--color-digitv2-chart-1"], "#204F37");
    assert.equal(props["--color-digitv2-chart-2"], "#FEC931");
    assert.equal(props["--color-digitv2-chart-3"], "#2A5084");
    assert.equal(props["--color-digitv2-chart-4"], "#E02D3C");
    assert.equal(props["--color-digitv2-chart-5"], "#128F21");
  } finally { restore(); }
});

test("v1 record (no `brand` key): legacy flatten only, no semantic expansion side-effects", () => {
  // The kenya-green MDMS record currently sets `colors.error` (v1 single key)
  // without setting `colors.brand`. Without the v2 opt-in gate, this would be
  // re-interpreted as v2 `error` and overwrite `--color-error-dark`. We want
  // legacy records to behave EXACTLY as before — no surprise side effects.
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: { error: "#E02D3A", primary: { main: "#FEC931" } },
    });
    assert.equal(props["--color-error"], "#E02D3A");
    assert.equal(props["--color-primary-main"], "#FEC931");
    // Crucially: error-dark is NOT touched (no v2 opt-in).
    assert.equal(props["--color-error-dark"], undefined);
    // brand/brand-on/etc. CSS vars also not written (no expansion).
    assert.equal(props["--color-primary-dark"], undefined);
    assert.equal(props["--color-primary-accent"], undefined);
  } finally { restore(); }
});

test("v2 wins on overlap with v1: same record can carry both shapes", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "2",
      colors: {
        // v1-shaped fallback for backwards compat:
        primary: { main: "#000000" },
        // v2 wins:
        brand: "#FEC931",
      },
    });
    // Pass 1 wrote --color-primary-main = #000000, then Pass 2 overwrote
    // with the v2 brand value. v2 always wins on overlap.
    assert.equal(props["--color-primary-main"], "#FEC931");
  } finally { restore(); }
});

// ── v3 designer-1:1 expansion ───────────────────────────────────────────────

test("v3: `primary-1` fans out to dark/accent/link/heading/secondary/header-sidenav AND new --color-primary-1", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "3", colors: { "primary-1": "#204F37" } });
    assert.equal(props["--color-primary-1"], "#204F37");
    assert.equal(props["--color-primary-dark"], "#204F37");
    assert.equal(props["--color-primary-accent"], "#204F37");
    assert.equal(props["--color-link-normal"], "#204F37");
    assert.equal(props["--color-text-heading"], "#204F37");
    assert.equal(props["--color-secondary"], "#204F37");
    assert.equal(props["--color-digitv2-header-sidenav"], "#204F37");
  } finally { restore(); }
});

test("v3: `primary-2` fans out to --color-primary-main and --color-primary-2", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "3", colors: { "primary-1": "#204F37", "primary-2": "#FEC931" } });
    assert.equal(props["--color-primary-2"], "#FEC931");
    assert.equal(props["--color-primary-main"], "#FEC931");
  } finally { restore(); }
});

test("v3: granular button-state inputs each write their own dedicated CSS var", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "3",
      colors: {
        "primary-1": "#204F37",
        "button-primary-bg-default": "#FEC931",
        "button-primary-bg-hover": "#E6B800",
        "button-primary-bg-pressed": "#CC9F00",
        "button-primary-text": "#204F37",
        "button-primary-disabled-bg": "#E5E7EB",
        "button-primary-disabled-text": "#9CA3AF",
      },
    });
    assert.equal(props["--color-button-primary-bg-default"], "#FEC931");
    assert.equal(props["--color-button-primary-bg-hover"], "#E6B800");
    assert.equal(props["--color-button-primary-bg-pressed"], "#CC9F00");
    assert.equal(props["--color-button-primary-text"], "#204F37");
    assert.equal(props["--color-button-primary-disabled-bg"], "#E5E7EB");
    assert.equal(props["--color-button-primary-disabled-text"], "#9CA3AF");
  } finally { restore(); }
});

test("v3: `page-secondary-bg` aliases all four legacy grey vars (designer eliminated grey scale)", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "3", colors: { "primary-1": "#204F37", "page-secondary-bg": "#FAFAFA" } });
    assert.equal(props["--color-page-secondary-bg"], "#FAFAFA");
    assert.equal(props["--color-grey-light"], "#FAFAFA");
    assert.equal(props["--color-grey-lighter"], "#FAFAFA");
    assert.equal(props["--color-grey-bg"], "#FAFAFA");
  } finally { restore(); }
});

test("v3: status text/bg/border are 3 distinct roles per severity", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "3",
      colors: {
        "primary-1": "#204F37",
        "status-error-text": "#C62828",
        "status-error-bg": "#FDECEC",
        "status-error-border": "#C62828",
      },
    });
    assert.equal(props["--color-status-error-text"], "#C62828");
    assert.equal(props["--color-status-error-bg"], "#FDECEC");
    assert.equal(props["--color-status-error-border"], "#C62828");
    // status-error-text also writes the legacy --color-error / --color-error-dark
    // so existing rules referencing them stay correct.
    assert.equal(props["--color-error"], "#C62828");
    assert.equal(props["--color-error-dark"], "#C62828");
  } finally { restore(); }
});

test("v3: chart-1..5 individual keys write to --color-digitv2-chart-N", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "3",
      colors: {
        "primary-1": "#204F37",
        "chart-1": "#204F37",
        "chart-2": "#FEC931",
        "chart-3": "#2A5084",
        "chart-4": "#D97706",
        "chart-5": "#C62828",
      },
    });
    assert.equal(props["--color-digitv2-chart-1"], "#204F37");
    assert.equal(props["--color-digitv2-chart-3"], "#2A5084");
    assert.equal(props["--color-digitv2-chart-5"], "#C62828");
  } finally { restore(); }
});

test("v3 wins over v2 on overlap (record carries both)", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "3",
      colors: {
        // v2 markers
        brand: "#000000",
        // v3 markers — should override v2 on --color-primary-main path
        "primary-1": "#204F37",
        "primary-2": "#FEC931",
      },
    });
    // primary-2 (v3) writes --color-primary-main = #FEC931, overriding v2's brand = #000000
    assert.equal(props["--color-primary-main"], "#FEC931");
  } finally { restore(); }
});

test("v3 not active without `primary-1` marker — v1/v2-only records keep their behavior", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: { "button-primary-bg-hover": "#E6B800" },
    });
    // Without primary-1 set, v3 expansion is skipped; the new --color-button-*
    // vars are NOT written by Pass 3. The flat key gets a harmless
    // --color-button-primary-bg-hover via Pass 1 flatten anyway, but Pass 3
    // didn't run. (Pass 1 still writes since it's a top-level string.)
    assert.equal(props["--color-button-primary-bg-hover"], "#E6B800");
    // But primary-1-derived vars should be absent.
    assert.equal(props["--color-primary-1"], undefined);
  } finally { restore(); }
});

// ── v2-scope bridge ──────────────────────────────────────────────────────────

const { hexToHslTriplet } = require("./applyTheme.js");

test("hexToHslTriplet: known conversions + invalid input", () => {
  assert.equal(hexToHslTriplet("#1B85D2"), "205 77% 46%");
  assert.equal(hexToHslTriplet("#ffffff"), "0 0% 100%");
  assert.equal(hexToHslTriplet("#fff"), "0 0% 100%");
  assert.equal(hexToHslTriplet("ff0000"), "0 100% 50%"); // bare hex tolerated
  assert.equal(hexToHslTriplet("not-a-color"), null);
  assert.equal(hexToHslTriplet(undefined), null);
  assert.equal(hexToHslTriplet("rgb(1,2,3)"), null);
});

test("v2 bridge: primary.main drives .v2-scope --v2-primary HSL triplet", () => {
  const { head, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: { primary: { main: "#10cdda" } },
    });
    const bridge = head.children.find((el) => el.id === "mdms-theme-v2-bridge");
    assert.ok(bridge, "bridge <style> should be appended to head");
    assert.match(bridge.textContent, /\.v2-scope \{/);
    assert.match(bridge.textContent, /--v2-primary: 184 86% 46%/);
    assert.match(bridge.textContent, /--v2-ring: 184 86% 46%/);
  } finally { restore(); }
});

test("v2 bridge: v3 button-primary-bg-default wins over primary.main", () => {
  const { head, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: {
        "primary-1": "#204F37", // v3 marker
        "button-primary-bg-default": "#FEC931",
        "button-primary-text": "#1D2433",
        primary: { main: "#10cdda" },
      },
    });
    const bridge = head.children.find((el) => el.id === "mdms-theme-v2-bridge");
    assert.ok(bridge);
    // #FEC931 = hsl(44 99% 59%)
    assert.match(bridge.textContent, /--v2-primary: 44 99% 59%/);
    assert.match(bridge.textContent, /--v2-primary-foreground: 221 28% 16%/);
  } finally { restore(); }
});

test("v2 bridge: no usable color → no style tag injected", () => {
  const { head, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "1", colors: { grey: { bg: "#E6E6E6" } } });
    const bridge = head.children.find((el) => el.id === "mdms-theme-v2-bridge");
    assert.equal(bridge, undefined);
  } finally { restore(); }
});

test("v2 bridge: re-apply reuses the same style tag (no duplicates)", () => {
  const { head, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "1", colors: { primary: { main: "#10cdda" } } });
    applyTheme({ version: "1", colors: { primary: { main: "#1B85D2" } } });
    const bridges = head.children.filter((el) => el.id === "mdms-theme-v2-bridge");
    assert.equal(bridges.length, 1);
    assert.match(bridges[0].textContent, /--v2-primary: 205 77% 46%/);
  } finally { restore(); }
});

// ── v3 backfill for v1/v2 records ────────────────────────────────────────────

test("v3 backfill: v1 record feeds button + primary-N tokens from palette", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: { primary: { main: "#FEC931", dark: "#204F37" } },
    });
    assert.equal(props["--color-button-primary-bg-default"], "#FEC931");
    assert.equal(props["--color-button-primary-bg-hover"], "#204F37");
    assert.equal(props["--color-button-primary-bg-pressed"], "#204F37");
    assert.equal(props["--color-primary-1"], "#204F37");
    assert.equal(props["--color-primary-2"], "#FEC931");
  } finally { restore(); }
});

test("v3 backfill: skipped entirely for real v3 records", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({
      version: "1",
      colors: {
        "primary-1": "#204F37",
        "button-primary-bg-default": "#E6B800",
        primary: { main: "#FEC931" },
      },
    });
    // v3 path applied the record's own value, not a backfilled one
    assert.equal(props["--color-button-primary-bg-default"], "#E6B800");
    // hover wasn't in the record and must NOT be invented for v3 records
    assert.equal(props["--color-button-primary-bg-hover"], undefined);
  } finally { restore(); }
});

test("v3 backfill: no primary in record → nothing invented", () => {
  const { props, restore } = stubDocument();
  try {
    const applyTheme = freshApply();
    applyTheme({ version: "1", colors: { grey: { bg: "#E6E6E6" } } });
    assert.equal(props["--color-button-primary-bg-default"], undefined);
    assert.equal(props["--color-primary-2"], undefined);
  } finally { restore(); }
});

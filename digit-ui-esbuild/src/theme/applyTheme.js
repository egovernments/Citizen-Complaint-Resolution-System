// Theme loader. Validates a config against schema.json, then writes CSS custom
// properties on document.documentElement so MDMS-driven per-tenant themes
// cascade through every var(--color-*) reference in the vendored CSS.
//
// Three input shapes are supported, applied in order so newer keys override
// older ones on overlap:
//
//   v1 (legacy, used by the original kenya-green record): nested groups,
//   e.g. `{ colors: { primary: { main, dark, ... }, text: { ... } } }`.
//   Each leaf is flattened to `--color-<path-joined-by-dashes>`.
//
//   v2 (12-input semantic shape): flat keys with semantic names — brand,
//   brand-on, surface-header, surface-page, text-{primary,secondary,disabled},
//   border, error, success, info, warning, selected-bg, chart-palette.
//   Each fans out to several existing CSS vars via SEMANTIC_EXPANSION.
//
//   v3 (designer 1:1 shape, ~77 keys following the Theme System spreadsheet's
//   New System / Nairobi Theme tabs): granular per-section roles —
//   primary-1, primary-2, primary-1-bg, button-primary-bg-{default,hover,
//   pressed}, input-border-{default,focus,error}, sidebar-{selected-bg,
//   selected-text,...}, status-{success,error,warning,info}-{text,bg,border},
//   table-*, tooltip-*, etc. Each maps to one or more CSS vars (existing or
//   newly added in vendor-digit-ui-css.js's ROOT_BLOCK) via V3_EXPANSION.
//
// Records can carry any combination of shapes during migration; later passes
// win on overlap. v3 takes precedence, then v2, then v1.

const Ajv = require("ajv");
const schema = require("./schema.json");

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// v2 → CSS var(s). 12-input semantic mapping; kept for backward compat with
// records saved against the v2 schema.
const SEMANTIC_EXPANSION = {
  brand: ["--color-primary-main"],
  "brand-on": [
    "--color-primary-dark",
    "--color-primary-accent",
    "--color-link-normal",
    "--color-link-hover",
    "--color-text-heading",
  ],
  "surface-header": [
    "--color-secondary",
    "--color-digitv2-header-sidenav",
  ],
  "surface-page": ["--color-grey-light"],
  "text-primary": ["--color-text-primary"],
  "text-secondary": ["--color-text-secondary", "--color-text-muted"],
  "text-disabled": [
    "--color-grey-disabled",
    "--color-digitv2-text-color-disabled",
  ],
  border: ["--color-border", "--color-input-border"],
  error: ["--color-error", "--color-error-dark"],
  success: ["--color-success"],
  info: ["--color-digitv2-alert-info", "--color-info-dark"],
  warning: ["--color-warning-dark"],
  "selected-bg": [
    "--color-primary-selected-bg",
    "--color-digitv2-primary-bg",
  ],
};

// v3 → CSS var(s). 1:1 with the designer's New System taxonomy. Each entry
// fans the input out to (a) any *existing* legacy CSS vars whose role
// matches, so the rule doesn't have to be rewritten, and (b) the new
// `--color-<role>` var that the surgical CSS edits in this PR consume for
// the granular roles the codebase didn't have a dedicated var for before.
//
// Section comments mirror the spreadsheet's grouping so reviewing this map
// against the source-of-truth tab is straightforward.
const V3_EXPANSION = {
  // ── Main Palette Color ───────────────────────────────────────────────────
  // primary-1 = dominant brand (green on Nairobi). Drives every "on-brand"
  // surface that pairs with primary-2: headings, links, header bar, sidebar,
  // tooltip bg, etc.
  "primary-1": [
    "--color-primary-1",
    "--color-primary-dark",
    "--color-primary-accent",
    "--color-link-normal",
    "--color-link-hover",
    "--color-text-heading",
    "--color-secondary",
    "--color-digitv2-header-sidenav",
  ],
  // primary-2 = accent brand (yellow on Nairobi). Drives the brand color
  // that appears in primary buttons, focus highlights, active sidebar items.
  "primary-2": [
    "--color-primary-2",
    "--color-primary-main",
  ],
  "primary-1-bg": [
    "--color-primary-1-bg",
    "--color-primary-selected-bg",
    "--color-digitv2-primary-bg",
  ],
  "primary-2-bg": ["--color-primary-2-bg"],

  // ── Text ─────────────────────────────────────────────────────────────────
  "text-heading": ["--color-text-heading"],
  "text-primary": ["--color-text-primary"],
  "text-secondary": ["--color-text-secondary", "--color-text-muted"],
  "text-disabled": [
    "--color-text-disabled",
    "--color-grey-disabled",
    "--color-digitv2-text-color-disabled",
  ],

  // ── Page surfaces ────────────────────────────────────────────────────────
  // page-bg = paper white (rows, cards, secondary buttons sit on this).
  // page-secondary-bg = subtle off-white (zebra rows, card panels).
  // Aliasing the legacy grey-* vars onto these absorbs designer's "Grey
  // scale not needed" decision without breaking the 161+ rules that still
  // reference them.
  "page-bg": ["--color-page-bg"],
  "page-secondary-bg": [
    "--color-page-secondary-bg",
    "--color-grey-light",
    "--color-grey-lighter",
    "--color-grey-bg",
  ],

  // ── Primary Button ───────────────────────────────────────────────────────
  "button-primary-bg-default": ["--color-button-primary-bg-default"],
  "button-primary-bg-hover": ["--color-button-primary-bg-hover"],
  "button-primary-bg-pressed": ["--color-button-primary-bg-pressed"],
  "button-primary-text": ["--color-button-primary-text"],
  "button-primary-border": ["--color-button-primary-border"],
  "button-primary-disabled-bg": ["--color-button-primary-disabled-bg"],
  "button-primary-disabled-text": ["--color-button-primary-disabled-text"],

  // ── Secondary Button ─────────────────────────────────────────────────────
  "button-secondary-bg-default": ["--color-button-secondary-bg-default"],
  "button-secondary-bg-hover": ["--color-button-secondary-bg-hover"],
  "button-secondary-bg-pressed": ["--color-button-secondary-bg-pressed"],
  "button-secondary-text": ["--color-button-secondary-text"],
  "button-secondary-border": ["--color-button-secondary-border"],

  // ── Tertiary Button / Links ──────────────────────────────────────────────
  "button-tertiary-text": [
    "--color-button-tertiary-text",
    "--color-link-normal",
    "--color-link-hover",
  ],

  // ── Inputs ───────────────────────────────────────────────────────────────
  "input-bg": ["--color-input-bg"],
  "input-border-default": [
    "--color-input-border-default",
    "--color-input-border",
  ],
  "input-border-focus": ["--color-input-border-focus"],
  "input-border-error": ["--color-input-border-error"],
  "input-placeholder": ["--color-input-placeholder"],
  "input-text": ["--color-input-text"],
  "input-label": ["--color-input-label"],
  "input-helper": ["--color-input-helper"],

  // ── Header ───────────────────────────────────────────────────────────────
  "header-bg": ["--color-header-bg"],
  "header-text": ["--color-header-text"],
  "header-icon": ["--color-header-icon"],

  // ── Sidebar ──────────────────────────────────────────────────────────────
  "sidebar-bg": ["--color-sidebar-bg"],
  "sidebar-text-active": ["--color-sidebar-text-active"],
  "sidebar-text-default": ["--color-sidebar-text-default"],
  "sidebar-hover-text": ["--color-sidebar-hover-text"],
  "sidebar-hover-bg": ["--color-sidebar-hover-bg"],
  "sidebar-icon-active": ["--color-sidebar-icon-active"],
  "sidebar-selected-bg": ["--color-sidebar-selected-bg"],
  "sidebar-selected-text": ["--color-sidebar-selected-text"],

  // ── Cards ────────────────────────────────────────────────────────────────
  "card-border": ["--color-card-border", "--color-border"],
  "card-divider": ["--color-card-divider"],
  "card-success": ["--color-card-success"],
  "card-error": ["--color-card-error"],

  // ── Status (4 × 3 = 12) ──────────────────────────────────────────────────
  "status-success-text": ["--color-status-success-text", "--color-success"],
  "status-success-bg": [
    "--color-status-success-bg",
    "--color-digitv2-alert-success-bg",
  ],
  "status-success-border": ["--color-status-success-border"],
  "status-error-text": [
    "--color-status-error-text",
    "--color-error",
    "--color-error-dark",
  ],
  "status-error-bg": [
    "--color-status-error-bg",
    "--color-digitv2-alert-error-bg",
  ],
  "status-error-border": ["--color-status-error-border"],
  "status-warning-text": [
    "--color-status-warning-text",
    "--color-warning-dark",
  ],
  "status-warning-bg": ["--color-status-warning-bg"],
  "status-warning-border": ["--color-status-warning-border"],
  "status-info-text": [
    "--color-status-info-text",
    "--color-info-dark",
    "--color-digitv2-alert-info",
  ],
  "status-info-bg": [
    "--color-status-info-bg",
    "--color-digitv2-alert-info-bg",
  ],
  "status-info-border": ["--color-status-info-border"],

  // ── Tables ───────────────────────────────────────────────────────────────
  "table-header-bg": ["--color-table-header-bg"],
  "table-header-text": ["--color-table-header-text"],
  "table-row-bg": ["--color-table-row-bg"],
  "table-alt-row": ["--color-table-alt-row"],
  "table-row-text": ["--color-table-row-text"],
  "table-border": ["--color-table-border"],
  "table-hover": ["--color-table-hover"],
  "table-selected": ["--color-table-selected"],
  "table-hover-text": ["--color-table-hover-text"],
  "table-selected-text": ["--color-table-selected-text"],

  // ── Misc ─────────────────────────────────────────────────────────────────
  loader: ["--color-loader"],
  progress: ["--color-progress"],
  "tooltip-bg": ["--color-tooltip-bg"],
  "tooltip-text": ["--color-tooltip-text"],
};

function flatten(obj, prefix, out) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const next = prefix ? `${prefix}-${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, next, out);
    } else if (typeof value === "string") {
      out[`--color-${next}`] = value;
    }
  }
}

function applyTheme(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    console.warn("[theme] config must be an object, skipping apply");
    return;
  }
  if (!validate(config)) {
    console.warn("[theme] invalid config, skipping apply", validate.errors);
    return;
  }
  if (!config.colors) return;

  const root = document.documentElement;
  const vars = {};

  // Pass 1: legacy v1 flatten — every nested string under `colors` becomes
  // its own --color-* variable. For records that only have v2/v3 flat keys,
  // this writes harmless --color-brand / --color-primary-1 / etc. that no
  // CSS rule consumes.
  flatten(config.colors, "", vars);

  // Pass 2: v2 semantic expansion. Opt-in via `colors.brand`. Fans 12 inputs
  // out across the existing CSS-var matrix.
  const v2Active = typeof config.colors.brand === "string";
  if (v2Active) {
    for (const [token, cssVars] of Object.entries(SEMANTIC_EXPANSION)) {
      const value = config.colors[token];
      if (typeof value === "string") {
        for (const name of cssVars) vars[name] = value;
      }
    }
    const palette = config.colors["chart-palette"];
    if (Array.isArray(palette)) {
      palette.slice(0, 5).forEach((hex, i) => {
        if (typeof hex === "string") vars[`--color-digitv2-chart-${i + 1}`] = hex;
      });
    }
  }

  // Pass 3: v3 designer-1:1 expansion. Opt-in via `colors.primary-1` (a v3
  // marker neither v1 nor v2 records have). Wins over v2 / v1 on overlap.
  // See V3_EXPANSION for the section-by-section mapping. Charts (5) flow
  // through individual chart-N keys, each mapping to --color-digitv2-chart-N.
  const v3Active = typeof config.colors["primary-1"] === "string";
  if (v3Active) {
    for (const [token, cssVars] of Object.entries(V3_EXPANSION)) {
      const value = config.colors[token];
      if (typeof value === "string") {
        for (const name of cssVars) vars[name] = value;
      }
    }
    for (let i = 1; i <= 5; i++) {
      const v = config.colors[`chart-${i}`];
      if (typeof v === "string") vars[`--color-digitv2-chart-${i}`] = v;
    }
  }

  for (const name of Object.keys(vars)) {
    root.style.setProperty(name, vars[name]);
  }
  console.log(`[theme] applied ${Object.keys(vars).length} variables`);
}

module.exports = { applyTheme, SEMANTIC_EXPANSION, V3_EXPANSION };

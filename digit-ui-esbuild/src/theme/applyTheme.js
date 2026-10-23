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
  // `text-secondary` also seeds `--color-text-muted` so a record that names
  // only a secondary tone still gets a caption colour rather than the vendored
  // default. `text-muted` is listed immediately after so a record that does
  // name one wins: object key order is iteration order, so the later entry
  // overwrites. Without this a tenant could not separate body, secondary and
  // caption text at all.
  "text-primary": ["--color-text-primary"],
  "text-secondary": ["--color-text-secondary", "--color-text-muted"],
  "text-muted": ["--color-text-muted"],
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
  // `text-secondary` also seeds `--color-text-muted` so a record that names
  // only a secondary tone still gets a caption colour rather than the vendored
  // default. `text-muted` is listed immediately after so a record that does
  // name one wins: object key order is iteration order, so the later entry
  // overwrites. Without this a tenant could not separate body, secondary and
  // caption text at all.
  "text-heading": ["--color-text-heading"],
  "text-primary": ["--color-text-primary"],
  "text-secondary": ["--color-text-secondary", "--color-text-muted"],
  "text-muted": ["--color-text-muted"],
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

// ── v2-scope (Tailwind/shadcn) bridge ───────────────────────────────────────
// The v2 component library (packages/digit-ui-components-v2) paints from
// `--v2-*` HSL-triplet tokens defined ON the `.v2-scope` element by its
// bundled tokens.css — e.g. `.bg-primary { background: hsl(var(--v2-primary)/…) }`.
// Because the scope element carries its own definition, custom properties set
// inline on <html> never reach those rules: the scope's stylesheet value
// shadows the inherited one. Net effect before this bridge: MDMS themes
// painted every legacy `--color-*` surface but v2 surfaces (login page,
// citizen flows) stayed on the baked-in defaults.
//
// Bridge: after applying the palette, inject a `.v2-scope { … }` rule into
// <head> with HSL triplets derived from the applied hex values. Same
// specificity as tokens.css, later source order — so it wins, and removing
// the MDMS record cleanly falls back to defaults on next load.
const V2_BRIDGE_STYLE_ID = "mdms-theme-v2-bridge";

/** sRGB channels 0..1, or null if `hex` isn't a 3/6-digit hex colour. */
function hexChannels(hex) {
  if (typeof hex !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h6 = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [
    parseInt(h6.slice(0, 2), 16) / 255,
    parseInt(h6.slice(2, 4), 16) / 255,
    parseInt(h6.slice(4, 6), 16) / 255,
  ];
}

/**
 * Which of black/white reads on `hex`, by WCAG relative luminance.
 *
 * Needed because the vendored `:root` hard-defines
 * `--color-button-primary-text: #FFFFFF`. A CSS-level
 * `var(--color-button-primary-text, <something sensible>)` can therefore never
 * reach its fallback — the token is always "set", just not by the tenant — so
 * any record that omits it silently gets white, which is unreadable the moment
 * the brand surface is light (kenya-yellow is ~1.5:1). Deciding it here, from
 * the button background the theme actually resolved to, keeps every record
 * legible without asking each tenant to state the pairing.
 */
const WHITE = "#FFFFFF";
const NEAR_BLACK = "#0B0C0C";
/** WCAG 2.2 AA for normal-sized text. Button labels here are 14px. */
const AA_NORMAL_TEXT = 4.5;

function relativeLuminance(hex) {
  const ch = hexChannels(hex);
  if (!ch) return null;
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastWithLuminance(l1, l2) {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Non-text contrast (WCAG 1.4.11): field borders, icons, focus rings. */
const AA_NON_TEXT = 3;
/** The page grey most content sits on, when a record doesn't name one. */
const DEFAULT_PAGE_GREY = "#FAFAFA";
const DEFAULT_PAGE_MID = "#EEEEEE";

function channelsToHex(ch) {
  return `#${ch.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function worstContrast(hex, surfaces) {
  const fg = relativeLuminance(hex);
  const lums = surfaces.map(relativeLuminance).filter((l) => l !== null);
  if (fg === null || !lums.length) return null;
  return Math.min(...lums.map((l) => contrastWithLuminance(fg, l)));
}

/**
 * `hex` if it already reads at `min` on every surface, otherwise the same hue
 * darkened just far enough that it does. Darkening keeps the tenant's colour
 * recognisable; swapping it for black would not. Returns null for a value that
 * isn't a hex colour, so the caller leaves it alone.
 */
function darkenUntilReadable(hex, surfaces, min) {
  const ch = hexChannels(hex);
  if (!ch) return null;
  const current = worstContrast(hex, surfaces);
  if (current === null || current >= min) return hex;
  for (let step = 1; step <= 50; step++) {
    const candidate = channelsToHex(ch.map((c) => c * (1 - step * 0.02)));
    if (worstContrast(candidate, surfaces) >= min) return candidate;
  }
  return NEAR_BLACK;
}

/**
 * The value a token will have once the theme is applied: the record's, or the
 * vendored :root default the stylesheet already set. The default matters as
 * much as the record — DIGIT's own caption grey fails on white.
 */
function effectiveValue(vars, name) {
  if (vars[name]) return vars[name];
  if (typeof getComputedStyle !== "function" || !document.documentElement) return null;
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || null;
  } catch (e) {
    return null;
  }
}

// Tokens that are only ever read as text (or, for borders, as the edge of a
// field) on the page's light surfaces, with the ratio each must reach there.
// A tenant can pick any palette; this keeps whatever it picks legible
// (WCAG 1.4.3 for text, 1.4.11 for field borders).
const LEGIBILITY_FLOORS = [
  ["--color-text-primary", AA_NORMAL_TEXT],
  ["--color-text-secondary", AA_NORMAL_TEXT],
  ["--color-text-muted", AA_NORMAL_TEXT],
  ["--color-text-heading", AA_NORMAL_TEXT],
  ["--color-link-normal", AA_NORMAL_TEXT],
  ["--color-link-hover", AA_NORMAL_TEXT],
  ["--color-button-tertiary-text", AA_NORMAL_TEXT],
  ["--color-button-secondary-text", AA_NORMAL_TEXT],
  ["--color-error", AA_NORMAL_TEXT],
  ["--color-success", AA_NORMAL_TEXT],
  ["--color-status-success-text", AA_NORMAL_TEXT],
  ["--color-status-error-text", AA_NORMAL_TEXT],
  ["--color-input-border", AA_NON_TEXT],
  ["--color-input-border-default", AA_NON_TEXT],
];

const TINT_PAIRS = [
  ["--color-status-error-text", "--color-status-error-bg"],
  ["--color-status-success-text", "--color-status-success-bg"],
  ["--color-status-warning-text", "--color-status-warning-bg"],
  ["--color-status-info-text", "--color-status-info-bg"],
];

// Foreground token, and the fill it is read on. The primary button is left to
// Pass 5, which judges its label across all three button states.
const FILL_PAIRS = [
  ["--color-sidebar-selected-text", "--color-sidebar-selected-bg"],
  ["--color-sidebar-text-default", "--color-sidebar-bg"],
  ["--color-header-text", "--color-header-bg"],
];

/**
 * Pass 6. Brand colours do two jobs the vendored CSS doesn't separate: fills
 * (buttons, the selected row) and text or outlines on the page. A light brand
 * such as Green and Gold's #FEC931 is a fine fill and unreadable as text
 * (1.5:1). Rather than repaint the fills, publish two derived tokens for the
 * text and outline jobs, and hold every text-only token to its floor.
 */
function applyLegibilityFloors(vars) {
  // White cards, the page grey, and the mid grey several citizen screens sit
  // on (`.light-background`).
  const page = [
    WHITE,
    effectiveValue(vars, "--color-grey-light") || DEFAULT_PAGE_GREY,
    effectiveValue(vars, "--color-grey-mid") || DEFAULT_PAGE_MID,
  ];

  const brandCandidates = [
    "--color-primary-2",
    "--color-primary-main",
    "--color-primary-1",
    "--color-link-normal",
  ].map((name) => effectiveValue(vars, name)).filter((v) => hexChannels(v));
  // Brand colour as text. An accent that is nearly there (a mid blue at 4.4:1
  // on the grey page) is nudged darker along its own hue, so links keep the
  // tenant's colour. A light accent (gold, under 3:1) is a fill colour, not a
  // text colour, so text falls to the next brand colour that reads.
  const accent = brandCandidates[0];
  const brandText = accent && worstContrast(accent, page) >= AA_NON_TEXT
    ? darkenUntilReadable(accent, page, AA_NORMAL_TEXT)
    : brandCandidates.find((hex) => worstContrast(hex, page) >= AA_NORMAL_TEXT)
      || (accent && darkenUntilReadable(accent, page, AA_NORMAL_TEXT));
  if (brandText && !("--color-brand-text" in vars)) vars["--color-brand-text"] = brandText;
  // The vendored :root hard-defines the secondary button's text and border as
  // DIGIT orange, so a record that doesn't state them (v1/v2: Green and Gold,
  // DIGIT Orange) never reached the brand-text fallback in the CSS and painted
  // orange on a green workspace. They are brand text, so they take it.
  for (const name of ["--color-button-secondary-text", "--color-button-secondary-border"]) {
    if (brandText && !(name in vars)) vars[name] = brandText;
  }

  for (const [name, min] of LEGIBILITY_FLOORS) {
    const value = effectiveValue(vars, name);
    const fixed = value && darkenUntilReadable(value, page, min);
    if (fixed && fixed.toUpperCase() !== String(value).toUpperCase()) vars[name] = fixed;
  }

  // Focus ring: 3:1 against the page so keyboard users can see where they are.
  const focusCandidates = [
    effectiveValue(vars, "--color-primary-1"),
    ...brandCandidates,
  ].filter((v) => hexChannels(v));
  const ring = focusCandidates.find((hex) => worstContrast(hex, page) >= AA_NON_TEXT)
    || (focusCandidates[0] && darkenUntilReadable(focusCandidates[0], page, AA_NON_TEXT));
  if (ring && !("--color-focus-ring" in vars)) vars["--color-focus-ring"] = ring;

  // Status pills: coloured text on a tint of the same colour. Darken the text
  // along its own hue so a red pill stays red.
  for (const [fgName, bgName] of TINT_PAIRS) {
    const fg = effectiveValue(vars, fgName);
    const bg = effectiveValue(vars, bgName);
    if (!hexChannels(bg) || !hexChannels(fg)) continue;
    const fixed = darkenUntilReadable(fg, [bg], AA_NORMAL_TEXT);
    if (fixed && fixed.toUpperCase() !== fg.toUpperCase()) vars[fgName] = fixed;
  }

  // Text painted on a brand fill. A record may state the pair itself, and a
  // stated pair can still be unreadable (white on a gold selected row is
  // 1.5:1), so judge the pair as it will render and swap in black or white
  // only when the stated one fails.
  for (const [fgName, bgName] of FILL_PAIRS) {
    const fg = effectiveValue(vars, fgName);
    const bg = effectiveValue(vars, bgName);
    if (!hexChannels(bg) || !hexChannels(fg)) continue;
    if (worstContrast(fg, [bg]) >= AA_NORMAL_TEXT) continue;
    const better = readableForegroundAcross([bg]);
    if (better && worstContrast(better, [bg]) > worstContrast(fg, [bg])) vars[fgName] = better;
  }
}

/**
 * White or near-black, whichever stays legible across EVERY surface the label
 * is painted on — default, hover and pressed, not just the resting state. A
 * foreground chosen against one state can fail on another, which is how a
 * button ends up readable until you hover it.
 *
 * Judged on the WORST case of each candidate: take AA (4.5:1, these labels are
 * 14px) if a candidate clears it on all states, otherwise the one whose weakest
 * state is strongest. Not every brand admits a compliant pair — a mid-tone blue
 * has no perfect answer — and in that case the honest choice is the better of
 * the two rather than a token that looks compliant on the state you measured.
 */
function readableForegroundAcross(hexes) {
  const lums = hexes.map(relativeLuminance).filter((l) => l !== null);
  if (!lums.length) return null;
  const worst = (fgLum) => Math.min(...lums.map((l) => contrastWithLuminance(fgLum, l)));
  // Score the colours actually returned. NEAR_BLACK is #0B0C0C, not #000000,
  // and scoring it as pure black overstates its contrast by ~7.2% — enough to
  // wave through a pair that misses AA, e.g. on #777777 it reports 4.69:1 while
  // the rendered ratio is 4.37:1.
  const white = worst(relativeLuminance(WHITE));
  const black = worst(relativeLuminance(NEAR_BLACK));
  if (white >= AA_NORMAL_TEXT) return WHITE;
  if (black >= AA_NORMAL_TEXT) return NEAR_BLACK;
  return white >= black ? WHITE : NEAR_BLACK;
}

/**
 * The shell's own colours for a record without them (v1, as onboarding's
 * Branding step saves for its "Green and Gold" and "DIGIT Orange" choices).
 *
 * The vendored `:root` hard-defines the header (#22394D), the sidebar
 * (#0B4B66) and the selected sidebar item (#c84c0e), so the CSS fallbacks that
 * would follow the record's palette are never reached: a green-and-gold
 * workspace got a navy header, a teal sidebar and an orange selected item
 * (#2635). They are derived here from the record's own palette instead:
 *
 *   header and sidebar   its `digitv2.header-sidenav`
 *   selected item        its main brand colour, or failing that its accent or
 *                        light tone, whichever stands out on the sidebar,
 *                        with whichever of white or near-black reads on it
 *
 * Only where the record chose its own colour: the vendored values ARE
 * digit-ui's default palette, so the default theme and DIGIT Orange keep
 * exactly the shell they have today.
 */
const VENDORED_HEADER_SIDENAV = "#0B4B66";
const VENDORED_PRIMARY_MAIN = "#C84C0E";
/** Enough for a selected row to read as different from the rows around it. */
const SELECTED_MIN_CONTRAST = 1.5;

function sameHex(a, b) {
  return typeof a === "string" && typeof b === "string" && a.trim().toUpperCase() === b.trim().toUpperCase();
}

function backfillShell(vars) {
  const shell = vars["--color-digitv2-header-sidenav"];
  if (shell && !sameHex(shell, VENDORED_HEADER_SIDENAV)) {
    for (const name of ["--color-header-bg", "--color-sidebar-bg"]) {
      if (!(name in vars)) vars[name] = shell;
    }
  }

  const main = vars["--color-primary-main"];
  if (!main || sameHex(main, VENDORED_PRIMARY_MAIN) || "--color-sidebar-selected-bg" in vars) return;
  const sidebarLum = relativeLuminance(vars["--color-sidebar-bg"] || shell || VENDORED_HEADER_SIDENAV);
  const selected = [main, vars["--color-primary-accent"], vars["--color-primary-light"]].find((hex) => {
    const lum = relativeLuminance(hex);
    return lum !== null && (sidebarLum === null || contrastWithLuminance(lum, sidebarLum) >= SELECTED_MIN_CONTRAST);
  });
  if (!selected) return;
  vars["--color-sidebar-selected-bg"] = selected;
  if (!("--color-sidebar-selected-text" in vars)) {
    const fg = readableForegroundAcross([selected]);
    if (fg) vars["--color-sidebar-selected-text"] = fg;
  }
}

/**
 * The button's hover and pressed fill for a v1/v2 record: its `primary.dark`,
 * when that really is darker than `primary.main`. A record's "dark" isn't
 * always: DIGIT Orange's is #C8602B against a #C84C0E main. As the hover it
 * fails white text (4.07:1), and Pass 5, which judges the label on every state,
 * then paints the label near-black on the resting orange too, where white reads
 * at 4.67:1. In that case hover on main taken 10% darker, which keeps the
 * feedback and the white label. A record with no "dark" keeps the flat hover.
 */
function darkerShadeOf(main, dark) {
  if (!dark) return main;
  const mainLum = relativeLuminance(main);
  const darkLum = relativeLuminance(dark);
  if (mainLum === null || darkLum === null || darkLum < mainLum) return dark;
  return channelsToHex(hexChannels(main).map((c) => c * 0.9));
}

function hexToHslTriplet(hex) {
  if (typeof hex !== "string") return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h6 = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const r = parseInt(h6.slice(0, 2), 16) / 255;
  const g = parseInt(h6.slice(2, 4), 16) / 255;
  const b = parseInt(h6.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// vars already encodes record precedence (v3 > v2 > v1), so reading from it
// keeps the bridge consistent with whatever won for the legacy surfaces.
function injectV2Bridge(vars) {
  if (typeof document.createElement !== "function" || !document.head) return 0;
  const primaryHex =
    vars["--color-button-primary-bg-default"] || vars["--color-primary-main"];
  const fgHex = vars["--color-button-primary-text"];

  const decls = [];
  const primary = hexToHslTriplet(primaryHex);
  if (primary) decls.push(`--v2-primary: ${primary}`);
  // The ring is an outline on the page, not a fill: a light brand that works
  // as a button is invisible as a ring (WCAG 1.4.11).
  const ring = hexToHslTriplet(vars["--color-focus-ring"] || primaryHex);
  if (ring) decls.push(`--v2-ring: ${ring}`);
  const fg = hexToHslTriplet(fgHex);
  if (fg) decls.push(`--v2-primary-foreground: ${fg}`);
  // v2 fields draw their edge from --v2-input; give them the same field
  // border the legacy inputs use, which Pass 6 holds to 3:1.
  const input = hexToHslTriplet(vars["--color-input-border"]);
  if (input) decls.push(`--v2-input: ${input}`);
  if (decls.length === 0) return 0;

  let el = document.getElementById(V2_BRIDGE_STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = V2_BRIDGE_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = `.v2-scope { ${decls.join("; ")}; }`;
  return decls.length;
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

  // Pass 4: v3 backfill for v1/v2 records. Newer components consume v3
  // tokens directly (often via inline style, e.g. the login button's
  // `background: var(--color-button-primary-bg-default, var(--color-primary-2, …))`),
  // and the vendored :root defaults for those tokens are DIGIT-orange. A
  // tenant with a v1/v2-shaped record would theme every legacy surface while
  // v3-consuming components silently stayed on defaults. Derive the v3
  // basics from the resolved palette so older records paint consistently.
  // Real v3 records are left untouched.
  if (!v3Active) {
    const primaryMain = vars["--color-primary-main"];
    const primaryDark = vars["--color-primary-dark"];
    const pressed = darkerShadeOf(primaryMain, primaryDark);
    const backfill = {
      "--color-primary-1": primaryDark || primaryMain,
      "--color-primary-2": primaryMain,
      "--color-button-primary-bg-default": primaryMain,
      "--color-button-primary-bg-hover": pressed,
      "--color-button-primary-bg-pressed": pressed,
    };
    for (const [name, value] of Object.entries(backfill)) {
      if (typeof value === "string" && !(name in vars)) vars[name] = value;
    }
    backfillShell(vars);
  }

  // Pass 5: semantic tokens the vendored :root also defines, which means a CSS
  // fallback chain can never supply them — the var is always set, just not by
  // the tenant. Any record that leaves these out inherits a generic DIGIT
  // default that has nothing to do with its palette. Applies to every record
  // shape, v3 included: `primary-1` marks a record v3 but says nothing about
  // whether these particular keys were filled in, and partial v3 records are
  // the norm. Bomet states bg-default and bg-hover but not bg-pressed, so
  // pressing a button flashed the vendored orange.
  //
  // Order matters: fill the button's BACKGROUND states first, then choose a
  // foreground against what will actually be painted. Deriving the foreground
  // from a palette colour the CSS never uses is how a mismatched pair happens.
  const brandSurface =
    vars["--color-button-primary-bg-default"] ||
    vars["--color-primary-2"] ||
    vars["--color-primary-main"];
  if (brandSurface) {
    // Fall back to the brand surface itself, NOT to primary-1. In the v3
    // taxonomy primary-1 is a second dominant brand colour, not a darker shade
    // of the button: on a yellow-button/green-primary-1 palette it would make
    // hover green, and if that palette also states green button text the label
    // hits 1.00:1 and vanishes. A flat hover keeps the button's hue and keeps
    // whatever foreground was chosen for the resting state valid. A stated
    // hover still wins, so a record like Bomet's keeps its real one and lets
    // pressed derive from that.
    const deeper = vars["--color-button-primary-bg-hover"] || brandSurface;
    const states = {
      "--color-button-primary-bg-default": brandSurface,
      "--color-button-primary-bg-hover": deeper,
      "--color-button-primary-bg-pressed": deeper,
    };
    for (const [name, value] of Object.entries(states)) {
      if (!(name in vars)) vars[name] = value;
    }
    if (!("--color-button-primary-text" in vars)) {
      const fg = readableForegroundAcross([
        vars["--color-button-primary-bg-default"],
        vars["--color-button-primary-bg-hover"],
        vars["--color-button-primary-bg-pressed"],
      ]);
      if (fg) vars["--color-button-primary-text"] = fg;
    }
  }

  applyLegibilityFloors(vars);

  for (const name of Object.keys(vars)) {
    root.style.setProperty(name, vars[name]);
  }

  // Brand assets are files, not tokens, so no amount of colour maths makes a
  // dark-on-light lockup readable once a tenant paints its header navy. Publish
  // the header's tone so the chrome can reach for the right file — the same
  // luminance the foreground backfill above is judged on, so the two can never
  // disagree about whether a surface is dark.
  const headerLum = relativeLuminance(vars["--color-header-bg"]);
  if (headerLum === null) {
    delete root.dataset.headerTone;
  } else {
    root.dataset.headerTone =
      contrastWithLuminance(headerLum, relativeLuminance(WHITE)) >= AA_NORMAL_TEXT
        ? "dark"
        : "light";
  }

  const bridged = injectV2Bridge(vars);
  console.log(
    `[theme] applied ${Object.keys(vars).length} variables` +
      (bridged ? ` (+${bridged} v2-scope tokens)` : ""),
  );
}

module.exports = { applyTheme, SEMANTIC_EXPANSION, V3_EXPANSION, hexToHslTriplet, darkenUntilReadable };

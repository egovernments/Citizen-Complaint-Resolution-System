/**
 * Locale-configurable number DISPLAY format for the supervisor dashboard
 * (#1213, fixes #1251; per-LOCALE resolution per the #1272 requirement
 * change).
 *
 * The mask comes from MDMS — dss.DashboardConfig (state root tenant, record
 * id "default", field `numberFormat`), in either of two shapes:
 *
 * - OBJECT keyed by locale code, with an optional `default` (the canonical
 *   form — each user sees their selected language's convention):
 *
 *     { "en_IN": "#,##0.00", "pt_PT": "#.##0,00", "fr_FR": "# ##0,00",
 *       "default": "#,##0.00" }
 *
 * - STRING (legacy, kept for back-compat): ONE mask applied for every
 *   locale — the original per-tenant form.
 *
 * `resolveNumberFormatMask(numberFormat, language)` picks the mask for the
 * active language: `object[language] ?? object.default ?? null`; the string
 * form resolves to itself for every language; anything missing/malformed
 * resolves to null (unconfigured behavior). Masks look like:
 *
 *   "#,##0.00"   en    1,234,567.89
 *   "#.##0,00"   pt    1.234.567,89
 *   "# ##0,00"   fr    1 234 567,89
 *
 * The mask contributes SEPARATORS ONLY. The decimal COUNT (and rounding /
 * trim behavior) always comes from the caller — viz.format semantics:
 * percentOneDecimal → 1, percentInteger → 0, decimalTwo → 2, … Unit suffixes
 * (%, pp, /5, h, hr/hrs/day/days) stay at the call sites; this module formats
 * the numeric part only. Durations DO take the mask decimal separator ("2,5
 * hrs" under a comma-decimal mask) — they are numbers.
 *
 * Runtime pattern (mirrors src/i18n/localeRuntime.js): the presentation
 * configs are plain modules, not components — hooks can't reach them — so the
 * parsed mask lives in a module-level store. AdminDashboard primes it
 * SYNCHRONOUSLY during render (holding the dashboard until the MDMS query
 * settles), so the first painted frame is already masked. AdminDashboard
 * subscribes to the locale runtime (useDashboardT) and re-runs the same
 * synchronous prime with the newly resolved mask when the language changes —
 * parents render before children, so by the time any tile re-renders the
 * store already holds the new locale's mask.
 *
 * Fallback contract (unconfigured tenants render byte-identically):
 * `formatNumber` returns null when no mask is configured (or the value is not
 * finite); EVERY call site branches `formatNumber(...) ?? <existing
 * expression>`, so with no mask the pre-#1213 code path runs untouched —
 * including Apex formatters that must keep returning numbers.
 */

// Separator characters a mask may use. Anything else marks the mask invalid
// (=> null => unconfigured behavior) so a garbage MDMS value can never
// scramble the dashboard.
const ALLOWED_SEPARATORS = new Set([".", ",", " ", "\u00a0", "\u202f", "'", "_"]);

/**
 * Parse a display mask into `{ group, decimal, decimals }`.
 *
 * Placeholder chars [#0] are stripped FIRST; the remaining chars, in order,
 * are the separators: first = grouping, last = decimal. A single separator is
 * a GROUPING separator when it sits in the conventional thousands position
 * (exactly 3 placeholders after it, at least one before — "#,##0"); anything
 * else ("0,00", "0,0") is a decimal separator. A repeated identical separator
 * ("#,###,##0") is grouping only.
 *
 * `decimals` = placeholder count after the decimal separator — kept for
 * introspection/tests; formatNumber takes the count from its caller.
 *
 * Returns null for empty / non-string / invalid masks.
 */
export function parseMask(mask) {
  if (typeof mask !== "string") return null;
  const pattern = mask.trim();
  if (!pattern) return null;

  // R1: strip placeholders first — what remains (in order) are the separators.
  const separators = [];
  for (const ch of pattern) {
    if (ch === "#" || ch === "0") continue;
    if (!ALLOWED_SEPARATORS.has(ch)) return null;
    separators.push(ch);
  }
  if (!/[#0]/.test(pattern)) return null; // separators only — not a mask

  let group = "";
  let decimal = "";

  if (separators.length === 0) {
    // "#0" — plain integer mask: no grouping, default decimal.
  } else {
    const first = separators[0];
    const last = separators[separators.length - 1];
    if (first !== last) {
      group = first;
      decimal = last;
    } else if (separators.length > 1) {
      group = first; // repeated identical separator = grouping only
    } else {
      const at = pattern.lastIndexOf(first);
      const placeholdersAfter = pattern.length - at - 1;
      const placeholdersBefore = at;
      if (placeholdersAfter === 3 && placeholdersBefore > 0) {
        group = first; // "#,##0" — thousands position
      } else {
        decimal = first; // "0,00", "0,0" — decimal part
      }
    }
  }

  let decimals = 0;
  if (decimal) {
    decimals = pattern.length - pattern.lastIndexOf(decimal) - 1;
  }

  return {
    group,
    // Group-only masks never print a decimal separator (callers pass the
    // decimal count), but keep a sane one in case they do — never equal to
    // the grouping separator.
    decimal: decimal || (group === "." ? "," : "."),
    decimals,
  };
}

/**
 * Named presets mapping viz.format kinds to the numeric-part spec they need.
 * Call sites may pass either a preset name or an explicit { decimals, trim }.
 */
const FORMAT_PRESETS = {
  integer: { decimals: 0 },
  signedInteger: { decimals: 0 },
  percentInteger: { decimals: 0 },
  percentNoDecimal: { decimals: 0 },
  percent: { decimals: 1 },
  percentOneDecimal: { decimals: 1 },
  decimalOne: { decimals: 1 },
  decimalTwo: { decimals: 2 },
  ratingOutOfFive: { decimals: 1 },
  hoursDecimal: { decimals: 1 },
};

/* ------------------------------------------------------------------ */
/* Per-locale mask resolution                                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve the raw `dss.DashboardConfig.numberFormat` value to the mask STRING
 * for `language` (a locale code like "en_IN"), or null.
 *
 * - string  → that mask, for every locale (legacy tenant-wide form)
 * - object  → `numberFormat[language] ?? numberFormat.default ?? null`
 * - anything else (missing, array, number, non-string entry) → null
 *
 * The returned string still goes through parseMask via setNumberFormatMask,
 * so a malformed mask VALUE also ends at null — a garbage MDMS record can
 * never scramble the dashboard.
 */
export function resolveNumberFormatMask(numberFormat, language) {
  if (typeof numberFormat === "string") return numberFormat;
  if (!numberFormat || typeof numberFormat !== "object" || Array.isArray(numberFormat)) {
    return null;
  }
  const candidate =
    (language != null ? numberFormat[language] : undefined) ?? numberFormat.default ?? null;
  return typeof candidate === "string" ? candidate : null;
}

/* ------------------------------------------------------------------ */
/* Module-level mask store                                             */
/* ------------------------------------------------------------------ */

let activeMask = null; // parsed mask | null
let activeMaskSource = null; // raw string the parsed mask came from

/**
 * Prime (or clear) the active mask. Idempotent per raw string, so it is safe
 * to call on every render. Invalid masks clear the store (unconfigured
 * behavior) rather than half-applying.
 */
export function setNumberFormatMask(mask) {
  const source = typeof mask === "string" && mask.trim() ? mask.trim() : null;
  if (source === activeMaskSource) return;
  activeMaskSource = source;
  activeMask = source ? parseMask(source) : null;
}

/** The parsed active mask (tests/diagnostics). */
export function getNumberFormatMask() {
  return activeMask;
}

/**
 * The active mask's raw string (null when unconfigured) — a JSON-stringifiable
 * change stamp for the Apex options memos. react-apexcharts (1.4.1) decides
 * whether to call `updateOptions` by comparing `JSON.stringify(options)`,
 * which DROPS the formatter closures — so charts must bake this stamp into
 * their options object (and dep their memo on it) for a locale-driven mask
 * change to actually redraw baked labels/ticks/tooltips.
 */
export function getNumberFormatStamp() {
  return activeMaskSource;
}

/* ------------------------------------------------------------------ */
/* Formatter                                                           */
/* ------------------------------------------------------------------ */

/**
 * Format the NUMERIC part of `value` with the active mask's separators.
 *
 * `spec` is a FORMAT_PRESETS name or `{ decimals = 0, trim = false }`:
 *   - decimals: fixed decimal places (rounds like Number.prototype.toFixed)
 *   - trim: drop trailing zeros in the decimal part (the "2 hrs" / "2.5 hrs"
 *     display idiom), then the decimal separator when nothing remains
 *
 * Returns null when no mask is configured or `value` is not a finite number —
 * callers fall back to their existing expression (`?? <existing>`), keeping
 * unconfigured tenants byte-identical and Apex number-returning formatters
 * returning numbers.
 */
export function formatNumber(value, spec) {
  const mask = activeMask;
  if (!mask) return null;
  if (value == null || value === "") return null; // Number(null) is 0 — never turn "no value" into "0"
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const { decimals = 0, trim = false } =
    (typeof spec === "string" ? FORMAT_PRESETS[spec] : spec) || {};

  const fixed = Math.abs(n).toFixed(decimals);
  const dot = fixed.indexOf(".");
  let intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  let fracPart = dot === -1 ? "" : fixed.slice(dot + 1);

  if (trim) fracPart = fracPart.replace(/0+$/, "");
  if (mask.group) {
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, mask.group);
  }

  return (n < 0 ? "-" : "") + intPart + (fracPart ? mask.decimal + fracPart : "");
}

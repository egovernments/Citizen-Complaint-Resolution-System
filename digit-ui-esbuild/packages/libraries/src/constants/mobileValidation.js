/**
 * Default mobile-number validation values.
 *
 * Only the regex and country-code prefix are stored here. All derived values
 * (min length, max length, allowed starting digits, error message) are
 * computed at runtime from `DEFAULT_MOBILE_PATTERN` by the utility functions
 * below — there is no separate constant for each derived value.
 *
 * Resolution order at runtime (highest → lowest priority):
 *   1. MDMS `common-masters.MobileNumberValidation` — operator-managed, per-tenant.
 *      Fields: `countryCode` + `mobileNumberRegex`.  Everything else is derived.
 *   2. `window.globalConfigs.getConfig("CORE_MOBILE_CONFIGS")` — injected by
 *      Ansible/nginx.  Fields: `countryCode` + `mobileNumberRegex`.
 *      Changing this file alone does NOT override MDMS in production.
 *   3. These constants — bare-metal dev-box fallback when neither MDMS nor
 *      globalConfigs is available.
 *
 * See `products/pgr/src/hooks/pgr/useMobileValidation.js` for the hook that
 * applies this priority chain.
 */

/** Full-anchor regex — the single source of truth for all derived constraints. */
export const DEFAULT_MOBILE_PATTERN = "^[6-9][0-9]{9}$";

/**
 * Lax (no-anchor) variant for inbox search fields that accept an empty string
 * or a partial mobile number (e.g. `"^$|<lax>"`).
 */
export const DEFAULT_MOBILE_PATTERN_LAX = "[6-9][0-9]{9}";

/** E.164 country-code prefix displayed in front of mobile inputs. */
export const DEFAULT_MOBILE_PREFIX = "+91";

/**
 * Extract the set of allowed starting digits from a mobile regex pattern.
 * Parses the first mandatory character class (e.g. `[17]` → `['1','7']`,
 * `[6-9]` → `['6','7','8','9']`). Returns null when the pattern is too
 * complex to parse statically (callers fall back to globalConfigs/defaults).
 *
 * Examples:
 *   extractAllowedStartingDigits("^[17][0-9]{8}$")   → ['1', '7']
 *   extractAllowedStartingDigits("^[6-9][0-9]{9}$")  → ['6', '7', '8', '9']
 *   extractAllowedStartingDigits("^[79][0-9]{8}$")   → ['7', '9']
 */
export function extractAllowedStartingDigits(pattern) {
  if (!pattern) return null;
  const s = pattern.replace(/^\^/, "").replace(/\$$/, "");
  let i = 0;
  while (i < s.length) {
    let content = null;
    let atomEnd;
    if (s[i] === "[") {
      const end = s.indexOf("]", i + 1);
      if (end === -1) break;
      content = s.slice(i + 1, end);
      atomEnd = end + 1;
    } else if (s[i] === "\\") {
      atomEnd = i + 2;
    } else {
      // literal character — treat as a single-char class
      content = s[i];
      atomEnd = i + 1;
    }
    // Skip optional atoms (quantifier `?` makes them non-mandatory)
    if (atomEnd < s.length && s[atomEnd] === "?") { i = atomEnd + 1; continue; }
    if (!content) { i = atomEnd; continue; }
    // Expand the character class into individual digits
    const digits = [];
    let ci = 0;
    while (ci < content.length) {
      if (ci + 2 < content.length && content[ci + 1] === "-") {
        const from = content.charCodeAt(ci);
        const to = content.charCodeAt(ci + 2);
        for (let code = from; code <= to; code++) digits.push(String.fromCharCode(code));
        ci += 3;
      } else {
        digits.push(content[ci]);
        ci++;
      }
    }
    // Only return if all extracted chars are digits (0-9)
    const onlyDigits = digits.every((d) => /^[0-9]$/.test(d));
    return onlyDigits && digits.length > 0 ? digits : null;
  }
  return null;
}

/**
 * Build a localised validation error message from a mobile regex pattern.
 *
 * Accepts an optional translation function `t(key, fallback)`. When provided,
 * every token is looked up via the i18n system; when omitted, English fallbacks
 * are used so existing callers without i18n continue to work.
 *
 * Localization keys used:
 *   ERR_INVALID_MOBILE_NUMBER   — "Please enter a valid mobile number"
 *   MOBILE_VALIDATION_DIGITS    — "digits"
 *   MOBILE_VALIDATION_AT_LEAST  — "at least"
 *   MOBILE_VALIDATION_STARTING_WITH — "starting with"
 *   MOBILE_VALIDATION_OR        — "or"
 *
 * Examples (English fallback):
 *   buildMobileErrorMessage("^[6-9][0-9]{9}$")  →
 *     "Please enter a valid mobile number (10 digits, starting with 6-9)"
 *   buildMobileErrorMessage("^0?[17][0-9]{8}$") →
 *     "Please enter a valid mobile number (9-10 digits, starting with 1 or 7)"
 */
export function buildMobileErrorMessage(pattern, t) {
  const tr = typeof t === "function" ? t : (key, fallback) => fallback;

  const base = tr("ERR_INVALID_MOBILE_NUMBER", "Please enter a valid mobile number");
  if (!pattern) return base;

  const { min, max } = computeMobileLengths(pattern);
  const startDigits = extractAllowedStartingDigits(pattern);

  const digits   = tr("MOBILE_VALIDATION_DIGITS",    "digits");
  const atLeast  = tr("MOBILE_VALIDATION_AT_LEAST",  "at least");

  const lenPart =
    min === max ? `${min} ${digits}` :
    max === -1  ? `${atLeast} ${min} ${digits}` :
    `${min}-${max} ${digits}`;

  let startPart = "";
  if (startDigits && startDigits.length > 0) {
    const unique = [...new Set(startDigits)];
    const sw = tr("MOBILE_VALIDATION_STARTING_WITH", "starting with");
    const or = tr("MOBILE_VALIDATION_OR",            "or");
    if (unique.length === 1) {
      startPart = `, ${sw} ${unique[0]}`;
    } else if (unique.length === 2) {
      startPart = `, ${sw} ${unique[0]} ${or} ${unique[1]}`;
    } else {
      startPart = `, ${sw} ${unique.slice(0, -1).join(", ")}, ${or} ${unique[unique.length - 1]}`;
    }
  }

  return `${base} (${lenPart}${startPart})`;
}

/**
 * Derive { min, max } digit counts from a mobile regex pattern string.
 * `max` is -1 when the pattern is unbounded (e.g. contains `+` or `*`).
 * Use this instead of separate mobileNumberLength / maxLength config fields —
 * the regex is the single source of truth.
 *
 * Examples:
 *   computeMobileLengths("^[79][0-9]{8}$")     → { min: 9,  max: 9  }
 *   computeMobileLengths("^[6-9][0-9]{9}$")    → { min: 10, max: 10 }
 *   computeMobileLengths("^0?[17][0-9]{8}$")   → { min: 9,  max: 10 }
 */
export function computeMobileLengths(pattern) {
  if (!pattern) return { min: 0, max: -1 };
  const s = pattern.replace(/^\^/, "").replace(/\$$/, "");
  let min = 0, max = 0, i = 0;
  while (i < s.length) {
    let atomEnd = i;
    if (s[i] === "[") {
      const end = s.indexOf("]", i + 1);
      atomEnd = end === -1 ? i + 1 : end + 1;
    } else if (s[i] === "\\") {
      atomEnd = i + 2;
    } else if (s[i] === "(") {
      let depth = 1; atomEnd = i + 1;
      while (atomEnd < s.length && depth > 0) {
        if (s[atomEnd] === "(") depth++;
        else if (s[atomEnd] === ")") depth--;
        atomEnd++;
      }
    } else {
      atomEnd = i + 1;
    }
    let atomMin = 1, atomMax = 1, qi = atomEnd;
    if (qi < s.length) {
      if (s[qi] === "?") { atomMin = 0; atomMax = 1; qi++; }
      else if (s[qi] === "*") { atomMin = 0; atomMax = Infinity; qi++; }
      else if (s[qi] === "+") { atomMin = 1; atomMax = Infinity; qi++; }
      else if (s[qi] === "{") {
        const end = s.indexOf("}", qi);
        if (end !== -1) {
          const parts = s.slice(qi + 1, end).split(",");
          atomMin = parseInt(parts[0], 10) || 0;
          atomMax = parts.length > 1
            ? (parts[1].trim() ? parseInt(parts[1], 10) : Infinity)
            : atomMin;
          qi = end + 1;
        }
      }
    }
    min += atomMin;
    max += atomMax;
    i = qi;
  }
  return { min, max: isFinite(max) ? max : -1 };
}

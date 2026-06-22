/**
 * Default mobile-number validation values.
 *
 * Historically the codebase duplicated 10-digit Indian mobile defaults
 * (`[6-9][0-9]{9}`, prefix `+91`, length 10) across at least seven call
 * sites. That made it impossible to roll out a non-Indian deployment
 * without either (a) seeding MDMS on every environment or (b) editing
 * every file. This module centralises the fallback so an implementer
 * only has one place to look and one place to patch.
 *
 * Defaults here are used when both globalConfigs and MDMS are unavailable.
 * To override at runtime, prefer in this order:
 *
 *   1. `window.globalConfigs.getConfig("CORE_MOBILE_CONFIGS")` — set
 *      per-deployment in `globalConfigs.js`. Highest priority.
 *   2. MDMS `common-masters.MobileNumberValidation` — the single source of
 *      truth, queried at startup and cached for 5 minutes.
 *   3. These constants — last-resort fallback.
 *
 * See `products/pgr/src/hooks/pgr/useMobileValidation.js` for the
 * resolution code.
 */

/** Full-anchor regex (use with `new RegExp(pattern)`). */
export const DEFAULT_MOBILE_PATTERN = "^0?[17][0-9]{8}$";

/**
 * Lax (no-anchor) pattern for inbox-style search fields that want to
 * match either an empty string or a mobile number, e.g. `"^$|<lax>"`.
 */
export const DEFAULT_MOBILE_PATTERN_LAX = "0?[17][0-9]{8}";

/** Displayed as a non-editable prefix on mobile inputs. */
export const DEFAULT_MOBILE_PREFIX = "+254";

/** First digits accepted by the default pattern. */
export const DEFAULT_MOBILE_ALLOWED_STARTING_DIGITS = ["1", "7"];

/**
 * Raw (non-localised) error message — UIs that have access to the
 * translator should prefer a locale key like
 * `CORE_COMMON_MOBILE_NUMBER_INVALID` instead.
 */
export const DEFAULT_MOBILE_ERROR_MESSAGE =
  "Please enter a valid 9-10 digit mobile number starting with 7 or 1";

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
 * Build a human-readable validation error message from a mobile regex pattern.
 *
 * Examples:
 *   buildMobileErrorMessage("^[17][0-9]{8}$")   →
 *     "Please enter a valid mobile number (9-10 digits, starting with 1 or 7)"
 *   buildMobileErrorMessage("^[6-9][0-9]{9}$")  →
 *     "Please enter a valid mobile number (10 digits, starting with 6-9)"
 */
export function buildMobileErrorMessage(pattern) {
  if (!pattern) return null;
  const { min, max } = computeMobileLengths(pattern);
  const startDigits = extractAllowedStartingDigits(pattern);

  const lenPart =
    min === max ? `${min} digits` :
    max === -1  ? `at least ${min} digits` :
    `${min}-${max} digits`;

  let startPart = "";
  if (startDigits && startDigits.length > 0) {
    const unique = [...new Set(startDigits)];
    if (unique.length === 1) {
      startPart = `, starting with ${unique[0]}`;
    } else if (unique.length === 2) {
      startPart = `, starting with ${unique[0]} or ${unique[1]}`;
    } else {
      startPart = `, starting with ${unique.slice(0, -1).join(", ")}, or ${unique[unique.length - 1]}`;
    }
  }

  return `Please enter a valid mobile number (${lenPart}${startPart})`;
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

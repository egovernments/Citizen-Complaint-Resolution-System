// Postal-code validation, shared by every PGR create-complaint surface
// (employee form, legacy citizen FormExplorer, citizen v2 flow) so the
// three don't drift the way they used to (CCRS#722).
//
// `CORE_POSTAL_CONFIGS.postalCodePattern` (set per-tenant in the ansible
// inventory, see local-setup/ansible/inventory/host_vars/_example.yml) is
// the SINGLE source of truth: a regex already expresses length,
// starting-digit constraints, and alnum shapes in one place, so there's
// no separate length/message field that can go stale relative to it.
//
// The error message is always derived from this pattern rather than read
// from a config override: when the pattern is a plain `^[0-9]{N}$` shape
// we pull N out of it and resolve a length-parameterized, localized key
// (`CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN`, seeded per-locale in the
// `rainmaker-pgr` localization module — see
// utilities/default-data-handler/src/main/resources/localisations/*/rainmaker-pgr.json).
// For non-numeric-length patterns (e.g. UK alnum) we fall back to a
// generic, still-localized message instead of asserting a wrong digit
// count.

function getPostalCodePattern() {
  const cfg = (typeof window !== "undefined" && window.globalConfigs?.getConfig?.("CORE_POSTAL_CONFIGS")) || {};
  return cfg.postalCodePattern || "^[0-9]{5}$";
}

/** Digit count for a `^[0-9]{N}$`-shaped pattern, or null for anything else. */
function getPostalCodeDigitLength() {
  const m = String(getPostalCodePattern()).match(/\{\s*(\d+)\s*\}/);
  return m ? m[1] : null;
}

/** Optional field — only the format is enforced, and only when a value is present. */
export function isPostalCodeValid(value) {
  const s = String(value ?? "").trim();
  if (s.length === 0) return true;
  try {
    return new RegExp(getPostalCodePattern()).test(s);
  } catch {
    return true; // a malformed configured pattern must never hard-block the form
  }
}

/**
 * @param {(k: string, opts?: Record<string, unknown>) => string} t  i18n translate
 */
export function getPostalCodeErrorMessage(t) {
  const len = getPostalCodeDigitLength();
  if (len) {
    const key = "CS_COMPLAINT_POSTALCODE_INVALID_ERROR_LEN";
    const out = t(key, { length: len });
    return out === key ? `Please enter a valid ${len}-digit postal code` : out;
  }
  const genericKey = "CS_COMPLAINT_POSTALCODE_INVALID_ERROR_GENERIC";
  const out = t(genericKey);
  return out === genericKey ? "Please enter a valid postal code" : out;
}

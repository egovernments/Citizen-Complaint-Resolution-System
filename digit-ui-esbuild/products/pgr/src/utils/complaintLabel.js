// Resolve a ComplaintHierarchy node `code` to a display label the DIGIT way:
// key-based localization, exactly like every other service. The label is the
// localization key COMPLAINT_HIERARCHY.<CODE> so it translates per-locale once
// that locale's bundle is loaded. If the key is not (yet) seeded, fall back to
// the node `name` (from the cached code→name map / a passed-in name) so a
// missing key never renders raw.
//
// Replaces the legacy SERVICEDEFS.* keys (tied to the removed ServiceDefs
// master). Keys are seeded for every node (interior + leaf) by the configurator
// upload / migration and by docs/migration/migrate.cjs.

export const COMPLAINT_LABEL_PREFIX = "COMPLAINT_HIERARCHY.";

/** Build the localization key for a node code. */
export const complaintKey = (code) =>
  code ? COMPLAINT_LABEL_PREFIX + String(code).toUpperCase() : "";

/**
 * @param {(k: string) => string} t  i18n translate
 * @param {string} code              the node code (leaf serviceCode OR interior code)
 * @param {string} [fallbackName]    node name to use when the key isn't seeded
 */
export function complaintLabel(t, code, fallbackName) {
  if (!code) return fallbackName || "";
  const key = complaintKey(code);
  const v = typeof t === "function" ? t(key) : key;
  if (v && v !== key) return v; // seeded translation wins
  if (fallbackName) return fallbackName;
  try {
    const map =
      (typeof Digit !== "undefined" &&
        Digit.SessionStorage &&
        Digit.SessionStorage.get("complaintHierarchyNameByCode")) ||
      {};
    return map[code] || code;
  } catch (e) {
    return code;
  }
}

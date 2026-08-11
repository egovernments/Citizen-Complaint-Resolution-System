/** Companion query keys emitted by queryPlan.js for one rendered tile. */
const COMPANION_SUFFIXES = ["__prior", "__series", "__pins"];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function objectMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Convert every supported wire error into the shape KpiTile renders.
 *
 * The current backend uses {error,message} inline under results, while the
 * intended batch contract uses a top-level errors map. During the additive
 * migration an errors-map value may therefore be a code string, {error,...},
 * or {code,...}. Keeping that compatibility here stops transport history from
 * leaking into the renderer.
 */
function canonicalError(value, fallback = null) {
  const fallbackError = fallback && typeof fallback === "object" ? fallback : null;
  if (typeof value === "string" && value) {
    const fallbackCode = fallbackError?.code || fallbackError?.error;
    return {
      code: value,
      message: String(fallbackCode === value && fallbackError?.message ? fallbackError.message : value),
    };
  }
  if (value && typeof value === "object") {
    const code = value.code || value.error || fallbackError?.code || fallbackError?.error || "query_failed";
    const fallbackCode = fallbackError?.code || fallbackError?.error;
    return {
      code: String(code),
      message: String(
        value.message || (String(fallbackCode) === String(code) && fallbackError?.message) || code
      ),
    };
  }
  if (fallbackError) return canonicalError(fallbackError);
  return { code: "query_failed", message: "query_failed" };
}

/**
 * Normalize legacy and current analytics batch payloads without mutating them.
 * Successful result envelopes retain their original identity; only the error
 * index is copied/canonicalized. Inline errors stay in results for the duration
 * of the backend's wire-compatibility period.
 */
export function normalizeAnalyticsBatch(payload) {
  const source = objectMap(payload);
  const results = objectMap(source.results);
  const explicitErrors = objectMap(source.errors);
  const errors = Object.create(null);

  for (const [key, result] of Object.entries(results)) {
    if (result && typeof result === "object" && typeof result.error === "string") {
      errors[key] = canonicalError(result);
    }
  }

  // The explicit contract is authoritative. When it contains only a code,
  // retain the richer legacy inline message as a compatibility fallback.
  for (const [key, error] of Object.entries(explicitErrors)) {
    errors[key] = canonicalError(error, errors[key]);
  }

  const hasErrors = Object.keys(errors).length > 0;
  return {
    ...source,
    results,
    errors: hasErrors ? errors : null,
    partial: Boolean(source.partial) || hasErrors,
  };
}

/** Return the first failure that makes a rendered tile incomplete. */
export function errorForTile(errors, kpiId) {
  if (!errors || !kpiId) return null;
  if (hasOwn(errors, kpiId) && errors[kpiId]) return errors[kpiId];
  for (const suffix of COMPANION_SUFFIXES) {
    const key = `${kpiId}${suffix}`;
    const companion = hasOwn(errors, key) ? errors[key] : null;
    if (companion) return companion;
  }
  return null;
}

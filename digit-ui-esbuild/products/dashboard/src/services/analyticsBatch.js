/** Backend fallback for deployments that predate the advertised pack budget. */
export const DEFAULT_MAX_BATCH_QUERIES = 50;

/** Companion query keys emitted by queryPlan.js for one rendered tile. */
const COMPANION_SUFFIXES = ["__prior", "__series", "__pins"];
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function objectMap(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function batchLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BATCH_QUERIES;
}

function errorMessage(error) {
  return String(error?.payload?.message || error?.message || "Analytics request failed");
}

/**
 * Convert every supported wire error into the shape KpiTile renders.
 *
 * Deployed backends use {error,message} inline under results, while newer
 * contracts may also publish a top-level errors map. Keep both readable while
 * tenants roll independently.
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

/** Normalize legacy inline errors and the additive top-level error contract. */
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

/** Split a named-query map without changing its insertion order or keys. */
export function chunkQueryRefs(refs, maxBatchQueries) {
  const entries = Object.entries(objectMap(refs));
  const limit = batchLimit(maxBatchQueries);
  const chunks = [];
  for (let offset = 0; offset < entries.length; offset += limit) {
    chunks.push(Object.fromEntries(entries.slice(offset, offset + limit)));
  }
  return chunks;
}

/**
 * Execute bounded chunks sequentially, retaining successful chunks if a later
 * transport fails. Sequential execution preserves the backend cap's intent:
 * adding a second HTTP request must not double concurrent PostgreSQL pressure.
 */
export async function runChunkedAnalyticsBatch(refs, maxBatchQueries, executeChunk) {
  const chunks = chunkQueryRefs(refs, maxBatchQueries);
  if (!chunks.length) {
    return { results: {}, errors: null, partial: false, asOf: null, calendar: null, scope: null };
  }

  const results = Object.create(null);
  const errors = Object.create(null);
  let partial = false;
  let asOf = null;
  let calendar = null;
  let scope = null;
  let successfulChunks = 0;
  let firstFailure = null;

  for (const chunk of chunks) {
    try {
      const response = normalizeAnalyticsBatch(await executeChunk(chunk));
      successfulChunks += 1;
      Object.assign(results, response.results);
      if (response.errors) Object.assign(errors, response.errors);
      partial = partial || response.partial;
      if (typeof response.asOf === "number") {
        asOf = asOf == null ? response.asOf : Math.min(asOf, response.asOf);
      }
      if (calendar == null && response.calendar != null) calendar = response.calendar;
      if (scope == null && response.scope != null) scope = response.scope;
    } catch (error) {
      firstFailure ||= error;
      partial = true;
      const message = errorMessage(error);
      for (const key of Object.keys(chunk)) {
        errors[key] = { code: "batch_failed", message };
      }
    }
  }

  // Preserve the existing global-banner behaviour only when no data request
  // succeeded at all. A partial transport failure keeps the usable tile data.
  if (successfulChunks === 0) throw firstFailure;

  return {
    results,
    errors: Object.keys(errors).length ? errors : null,
    partial: partial || Object.keys(errors).length > 0,
    asOf,
    calendar,
    scope,
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

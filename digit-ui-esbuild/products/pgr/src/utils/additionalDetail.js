/**
 * additionalDetail helpers (CCSD-2012).
 *
 * `service.additionalDetail` is a grab-bag the backend and employee flows
 * stamp routing/bookkeeping data into — `department` (create/ASSIGN routing;
 * dept-scoped supervisors' visibility depends on it), `serviceName`,
 * `supervisorName`/`supervisorContactNumber`, and the auto-escalation state
 * (`escalationLevel`, `lastEscalatedAt`, `escalatedFrom`).
 *
 * Two citizen flows (REOPEN, RATE) used to REPLACE the whole object with just
 * their own payload. The backend then re-derived `department` from the
 * serviceCode — "NA" for unmapped codes — and department-scoped supervisors
 * lost the complaint entirely (inbox empty, details "No Results Found").
 * These helpers make "merge, never replace" cheap to do right.
 */

/**
 * Normalize a service.additionalDetail value to a plain object.
 * Live records arrive as an OBJECT on some complaints and a JSON STRING on
 * others (legacy rows round-trip double-encoded — same shape the employee
 * details page parses; see PGRDetails.js parseAdditionalDetail). Anything
 * else (null, arrays, non-JSON strings) yields {}.
 */
export const readAdditionalDetailObject = (raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch (e) {
      /* not JSON — fall through */
    }
  }
  return {};
};

/**
 * Auto-escalation bookkeeping written by pgr-services EscalationService.
 * A REOPEN starts a fresh lifecycle: carrying these over would (a) freeze
 * escalation forever once a first-life complaint hit maxDepth and (b) apply
 * the stale level-N SLA to the new cycle. The pre-fix replace reset them by
 * accident; we reset them on purpose.
 */
export const ESCALATION_KEYS = ["escalationLevel", "lastEscalatedAt", "escalatedFrom"];

/**
 * Merge `patch` into an existing additionalDetail value, preserving routing
 * data (department etc.). `resetEscalation: true` (REOPEN) drops the
 * escalation bookkeeping so the new lifecycle escalates from level 0.
 */
export const mergeAdditionalDetail = (existingRaw, patch, { resetEscalation = false } = {}) => {
  const existing = { ...readAdditionalDetailObject(existingRaw) };
  if (resetEscalation) ESCALATION_KEYS.forEach((k) => delete existing[k]);
  return { ...existing, ...patch };
};

import { translate, exists } from "./localeRuntime";

/**
 * THE single seam between raw dimension codes and display text. Every place
 * the dashboard renders a data value as a label must route through here with
 * the right `kind`.
 *
 * NO code-owned fallbacks: when no localization message exists, the raw code
 * renders — a localisation gap is surfaced, not papered over with a regex
 * humaniser. `fallbackText` is reserved for DATA-OWNED names only (boundary
 * service `localname`, MDMS ComplaintHierarchy display names — text an
 * operator authored), never for hardcoded English.
 *
 * Key conventions per kind mirror what the configurator seeds:
 *   complaintType  → COMPLAINT_HIERARCHY.<code> (SERVICEDEFS.<CODE> legacy)
 *   boundary       → bare <code> in rainmaker-boundary-<hierarchy> (#1002)
 *   department     → COMMON_MASTERS_DEPARTMENT_<CODE> in rainmaker-common
 *   workflowStatus → DASHBOARD_WF_STAGE_<STATUS>, then platform CS_COMMON_*
 *   channel/slaState/ageBucket → dashboard-owned DASHBOARD_* keys
 */
const transform = (code) =>
  String(code)
    .toUpperCase()
    .replace(/[.:\-\s/]/g, "_");

const CANDIDATES = {
  complaintType: (c) => [
    `COMPLAINT_HIERARCHY.${c}`,
    `COMPLAINT_HIERARCHY.${String(c).toUpperCase()}`,
    `SERVICEDEFS.${String(c).toUpperCase()}`,
  ],
  boundary: (c) => [String(c), transform(c)],
  department: (c) => [`COMMON_MASTERS_DEPARTMENT_${transform(c)}`, `DEPARTMENT_${transform(c)}`],
  workflowStatus: (c) => [
    `DASHBOARD_WF_STAGE_${transform(c)}`,
    `CS_COMMON_${transform(c)}`,
    `WF_PGR_${transform(c)}`,
  ],
  channel: (c) => [`DASHBOARD_CHANNEL_${transform(c)}`],
  slaState: (c) => [`DASHBOARD_SLA_${transform(c)}`],
  ageBucket: (c) => [`DASHBOARD_AGE_${transform(c)}`],
};

/**
 * @param code raw dimension value (service code, boundary code, dept code, …)
 * @param kind one of the CANDIDATES keys; unknown kinds surface the raw code
 * @param fallbackText DATA-OWNED display name (API localname / MDMS name)
 *   only — omit everywhere else so unlocalized codes surface verbatim
 */
export function dimensionLabel(code, kind, fallbackText) {
  if (code == null || code === "") return fallbackText !== undefined ? fallbackText : "";
  const candidates = (CANDIDATES[kind] || (() => []))(code);
  for (const key of candidates) {
    if (exists(key)) return translate(key);
  }
  if (fallbackText !== undefined) return fallbackText;
  return String(code);
}

/**
 * Complaint type → department mapping for dashboard rollups.
 *
 * Department is derived from the complaint *type* (service definition / MDMS config),
 * not from routing fields on the complaint record (e.g. assignee department).
 *
 * Per-type overrides can be added to COMPLAINT_TYPE_TO_DEPARTMENT. When absent, the
 * department_code materialized on complaint_facts from ServiceDefs is used.
 */

/** @type {Record<string, string>} service_code → department_code */
export const COMPLAINT_TYPE_TO_DEPARTMENT = {
  // Add explicit overrides here when MDMS ServiceDefs lag onboarding.
};

export function formatDepartmentLabel(departmentCode) {
  const code = String(departmentCode ?? "").trim();
  if (!code || code === "Unknown" || code === "Unmapped") return "Unknown";

  return code
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Resolve a department code for a filed complaint type.
 * @param {string} serviceCode
 * @param {string|null|undefined} serviceDefDepartment department from ServiceDefs (facts MV)
 */
export function resolveDepartmentForServiceType(serviceCode, serviceDefDepartment) {
  const typeKey = String(serviceCode ?? "").trim();
  if (!typeKey) return "Unknown";

  if (COMPLAINT_TYPE_TO_DEPARTMENT[typeKey]) {
    return COMPLAINT_TYPE_TO_DEPARTMENT[typeKey];
  }

  const fromServiceDef = String(serviceDefDepartment ?? "").trim();
  if (fromServiceDef && fromServiceDef !== "null" && fromServiceDef !== "undefined") {
    return fromServiceDef;
  }

  return "Unknown";
}

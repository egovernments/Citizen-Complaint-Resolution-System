/**
 * Who may be offered ESCALATE on a complaint (#2129).
 *
 * ESCALATE moves work up the CURRENT assignee's own HRMS reportingTo chain, and the
 * server resolves the target — the caller never picks it. The workflow transition is
 * role-gated, so on its own it offered Escalate to every PGR_LME holder in the tenant,
 * on every PENDINGATLME complaint, including ones that had already escalated past them.
 * Clicking it then advanced somebody else's ladder.
 *
 * Workflow stores assignees on transitions rather than on the complaint. The newest
 * transition can therefore be a COMMENT or ESCALATE row with no assignees even though
 * the complaint still has a holder. Keep the holder derivation here aligned with
 * EscalationService.assigneesInCurrentOccupancy(): walk newest-first within the current
 * state occupancy and stop at the first state boundary.
 *
 * Kept as pure functions so the rule is testable without rendering PGRDetails.
 */

const stateId = (instance) => instance?.state?.uuid ?? null;

const validAssignees = (instance) => {
  if (!Array.isArray(instance?.assignes)) return [];
  return instance.assignes.filter((assignee) => {
    const uuid = assignee && typeof assignee === "object" ? assignee.uuid : assignee;
    return typeof uuid === "string" && uuid.trim().length > 0;
  });
};

/**
 * @param {Array<{state?: {uuid?: string}, assignes?: Array<{uuid?: string}|string>}>} processInstances
 *   workflow history ordered newest-first
 * @returns {Array<{uuid?: string}|string>} assignees holding the current state occupancy
 */
export const currentAssigneesInOccupancy = (processInstances) => {
  if (!Array.isArray(processInstances) || processInstances.length === 0) return [];

  const currentState = stateId(processInstances[0]);
  for (const instance of processInstances) {
    if (stateId(instance) !== currentState) {
      // Anything older belongs to an earlier state occupancy and must not regain ownership.
      return [];
    }
    const assignees = validAssignees(instance);
    if (assignees.length > 0) return assignees;
  }
  return [];
};

/**
 * @param {Array<{uuid?: string}|string>} currentAssignees workflow assignees, objects or uuids
 * @param {string} userUuid the logged-in employee's uuid
 * @returns {boolean} true when the logged-in employee currently holds the complaint
 */
export const isCurrentAssignee = (currentAssignees, userUuid) => {
  if (!userUuid || !Array.isArray(currentAssignees) || currentAssignees.length === 0) {
    return false;
  }
  return currentAssignees.some((assignee) => {
    const uuid = assignee && typeof assignee === "object" ? assignee.uuid : assignee;
    return Boolean(uuid) && uuid === userUuid;
  });
};

export default isCurrentAssignee;

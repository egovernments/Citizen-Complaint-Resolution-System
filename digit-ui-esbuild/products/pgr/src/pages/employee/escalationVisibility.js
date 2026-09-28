/**
 * Who may be offered ESCALATE on a complaint (#2129).
 *
 * ESCALATE moves work up the CURRENT assignee's own HRMS reportingTo chain, and the
 * server resolves the target — the caller never picks it. The workflow transition is
 * role-gated, so on its own it offered Escalate to every PGR_LME holder in the tenant,
 * on every PENDINGATLME complaint, including ones that had already escalated past them.
 * Clicking it then advanced somebody else's ladder.
 *
 * Kept as a pure function so the rule is testable without rendering PGRDetails.
 */

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

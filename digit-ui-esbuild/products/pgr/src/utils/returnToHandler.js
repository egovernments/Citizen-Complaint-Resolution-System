// Field register FC-0002 — "Awaiting Information → Under Investigation": when
// staff record the citizen's answer (INFOFROMCITIZEN --COMMENT--> INVESTIGATION)
// the complaint goes BACK to the case manager who asked the question. Offering
// an operator picker on that form invited a reception officer to reassign the
// case as a side effect of typing in a reply, so the picker is dropped and the
// assignee is derived from history instead: the most recent CMS_CASE_MANAGER
// (see findLatestAssigneeUuidByRole). Keyed by the state the action leaves
// FROM, not by action name — COMMENT also exists as a self-loop on REJECTED and
// RESOLVED, where nothing should change. The standard (non-CMS) workflow has
// no INFOFROMCITIZEN state, so this is a no-op there.
export const RETURN_TO_HANDLER = Object.freeze({
  INFOFROMCITIZEN: Object.freeze({ action: "COMMENT", role: "CMS_CASE_MANAGER" }),
});

/**
 * Role whose most recent history holder should receive the complaint when
 * `action` is taken from `fromState`, or null when the action is not a
 * return-to-handler transition (picker behaviour unchanged).
 */
export const returnToHandlerRole = (action, fromState) => {
  const rule = fromState ? RETURN_TO_HANDLER[fromState] : null;
  return rule && rule.action === action ? rule.role : null;
};

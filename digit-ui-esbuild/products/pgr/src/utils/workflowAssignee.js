import { WorkflowService } from "../services/workflow/Workflow";

// CCSD-2167 — derive a workflow assignee UUID from the complaint's own history.
//
// When a citizen reopens or rates a complaint, the resulting workflow action
// must be routed to a specific staff member:
//   - Reopen  -> the SUPERVISOR   (CMS_SUPERVISOR)   who handled it
//   - Rate Us -> the CASE MANAGER (CMS_CASE_MANAGER) who last handled it
//
// The person is found by walking the application's workflow history
// (/egov-workflow-v2/egov-wf/process/_search?history=true). Every history
// step's `assignes[]` (the user the step was routed TO) and `assigner` (the
// actor) carry a structured `roles: [{ code }]` array and a `uuid` — verified
// live on cms-pilot for BOTH an employee and a CITIZEN token, so the citizen
// flows can read it. In the CMS workflow the Supervisor is the assignee of the
// REFERRED step and the Case Manager is the assignee of the INVESTIGATION step;
// matching by ROLE (rather than by state name) keeps this correct even if the
// state graph changes, and makes it a natural no-op on the standard GRO/LME
// workflow, whose history never contains these CMS roles (returns null -> the
// callers fall back to today's behaviour: no assignee).

const rolesOf = (user) => ((user && Array.isArray(user.roles)) ? user.roles : []).map((r) => r && r.code).filter(Boolean);

/**
 * Most-recent workflow-history participant holding `roleCode`, as a bare user
 * UUID (the shape the PGR workflow payload's `assignes` expects), or null.
 *
 * `assignes` (routed-to) is preferred over `assigner` (actor) because the
 * ticket's intent is "the complaint was assigned to this person"; assigner is
 * a fallback so a role that only ever appears as an actor is still found.
 *
 * @param {string} stateCode  state tenant (workflow is searched at state level)
 * @param {string} businessId complaint serviceRequestId
 * @param {string} roleCode   e.g. "CMS_SUPERVISOR" | "CMS_CASE_MANAGER"
 * @returns {Promise<string|null>}
 */
export const findLatestAssigneeUuidByRole = async (stateCode, businessId, roleCode) => {
  if (!stateCode || !businessId || !roleCode) return null;
  let response;
  try {
    response = await WorkflowService.getByBusinessId(stateCode, businessId, {}, true);
  } catch (e) {
    // Never block the citizen's reopen/rate on a history-fetch failure —
    // fall back to no assignee (the pre-2167 behaviour).
    return null;
  }
  const instances = Array.isArray(response && response.ProcessInstances) ? response.ProcessInstances : [];
  // Most-recent first: "last handled" wins when a role appears across several
  // steps (reassignment, repeated investigation rounds).
  const ordered = [...instances].sort(
    (a, b) => (b?.auditDetails?.lastModifiedTime || 0) - (a?.auditDetails?.lastModifiedTime || 0)
  );
  for (const pi of ordered) {
    for (const a of pi?.assignes || []) {
      if (a?.uuid && rolesOf(a).includes(roleCode)) return a.uuid;
    }
  }
  // Fallback: the role only surfaced as the actor of a step.
  for (const pi of ordered) {
    if (pi?.assigner?.uuid && rolesOf(pi.assigner).includes(roleCode)) return pi.assigner.uuid;
  }
  return null;
};

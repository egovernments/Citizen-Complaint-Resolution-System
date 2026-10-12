/**
 * The `_update` request for an action taken from a complaint's action modal (#1967).
 *
 * Only the fields the chosen action's own form shows are read. The modal used to merge
 * every form's values into one session object and submit all of it, so an employee
 * picked in Assign survived a cancel and rode along on a later Resolve. pgr-services
 * read that as "resolve and assign to this user" and refused it with INVALID_ASSIGNEE.
 * Reading the action's own fields keeps a value from another action out of the request
 * whatever the form state holds.
 *
 * Kept as pure functions so the rule is testable without rendering PGRDetails.
 */

/** The field keys an action's form shows. */
const actionFieldKeys = (actionConfig) =>
  new Set(
    (actionConfig?.formConfig?.form || [])
      .flatMap((section) => (section.body || []).map((field) => field.key))
      .filter(Boolean)
  );

/** `data` cut down to the fields the action's form shows. */
export const formDataForAction = (actionConfig, data) => {
  const keys = actionFieldKeys(actionConfig);
  return Object.fromEntries(Object.entries(data || {}).filter(([key]) => keys.has(key)));
};

/**
 * The workflow comment. A rejection is prefixed with its reason code, so the audit log
 * records why the complaint was rejected and not just the free text typed.
 */
const composeComment = (action, fields) => {
  const freeComment = fields.SelectedComments || "";
  if (action !== "REJECT") return freeComment;
  const reason = fields.SelectedReason;
  const reasonCode = reason?.code || reason?.name || (typeof reason === "string" ? reason : "");
  if (!reasonCode) return freeComment;
  return freeComment ? `[${reasonCode}] ${freeComment}` : `[${reasonCode}]`;
};

/**
 * The request body for `action`. `data` is the modal's form state; only the fields of
 * `actionConfig`'s form are used.
 */
export const buildWorkflowUpdate = ({ action, actionConfig, data, baseService }) => {
  const fields = formDataForAction(actionConfig, data);
  const assigneeUuid = fields.SelectedAssignee?.uuid;
  // Record where the complaint was routed: an assignee's department replaces the stale
  // type department (or "NA") carried over from filing. Actions without an assignee
  // leave additionalDetail as it is.
  const assigneeDept = assigneeUuid ? fields.SelectedAssignee?.department : undefined;
  const baseAdditionalDetail =
    baseService?.additionalDetail && typeof baseService.additionalDetail === "object" ? baseService.additionalDetail : {};

  return {
    service: assigneeDept
      ? { ...baseService, additionalDetail: { ...baseAdditionalDetail, department: assigneeDept } }
      : { ...baseService },
    workflow: {
      action,
      assignes: assigneeUuid ? [assigneeUuid] : null,
      hrmsAssignes: assigneeUuid ? [assigneeUuid] : null,
      comments: composeComment(action, fields),
    },
  };
};

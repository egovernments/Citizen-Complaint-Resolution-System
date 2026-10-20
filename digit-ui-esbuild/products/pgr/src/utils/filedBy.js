// Who a timeline shows as having filed a complaint. The workflow records the
// account that made the APPLY call, which is not always the complainant: a
// WhatsApp complaint is filed by the chatbot's service account (Kong resolves
// the caller from the token, so the bot cannot act as the citizen), and the
// timeline read "Admin" and the admin's mobile (#2503). Whenever the APPLY
// actor is not the complainant, the filing row shows the complainant instead.
//
// service.citizen comes from pgr-services' search, whose field-visibility
// policy already decides which viewers see the citizen's name and mobile. Its
// answer is shown as is: a redacted name shows as the fallback label and a
// redacted mobile is left out, never the filing account's.

/**
 * The person to show on a filing row, or null when the workflow's own actor is
 * the complainant (or either is unknown), so the row keeps showing that actor.
 * @param {object} service       the complaint, as pgr-services' search returns it
 * @param {object} actor         the APPLY process instance's assigner
 * @param {string} fallbackName  shown when the complainant's name is redacted
 * @returns {{ name: string|null, mobileNumber: string|null } | null}
 */
export function complainantFiler(service, actor, fallbackName) {
  const complainant = service?.accountId;
  if (!complainant || !actor?.uuid || actor.uuid === complainant) return null;
  return {
    name: service?.citizen?.name || fallbackName || null,
    mobileNumber: service?.citizen?.mobileNumber || null,
  };
}

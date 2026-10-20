// Who a timeline shows as having filed a complaint. A WhatsApp complaint is
// filed by the chatbot's service account (Kong resolves the caller from the
// token, so the bot cannot act as the citizen), and the workflow records that
// account as the APPLY actor: the timeline read "Admin" and the admin's mobile
// (#2503). For those complaints the filer shown is the complainant instead.
//
// service.citizen comes from pgr-services' search, which already redacts the
// citizen's name and mobile for viewers its field-visibility policy denies, so
// this never shows more than that policy allows. A confidential complaint
// shows the name only.

export const CHANNEL_FILED_SOURCES = ["whatsapp"];

/** True when the workflow's APPLY actor is a channel account, not the complainant. */
export function isFiledThroughChannel(service) {
  return CHANNEL_FILED_SOURCES.includes(String(service?.source || "").toLowerCase());
}

/**
 * The person to show on the filing row of a channel-filed complaint, or null
 * when the workflow's own actor is the right one to show.
 * @returns {{ name: string|null, mobileNumber: string|null } | null}
 */
export function channelFiler(service) {
  if (!isFiledThroughChannel(service)) return null;
  const citizen = service?.citizen;
  const confidential = service?.extendedAttributes?.isConfidential === true;
  return {
    name: citizen?.name || null,
    mobileNumber: confidential ? null : citizen?.mobileNumber || null,
  };
}

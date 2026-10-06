/** The identity BFF's resend and invite refusals, in English; describeInviteError translates them by code. */
export const INVITE_ERRORS: Record<string, string> = {
  RESEND_TOO_SOON: 'An email went to them less than a minute ago. Wait a minute before sending another.',
  DIGIT_ACCOUNT_NOT_FOUND: 'Their sign-in account no longer matches this employee. Reload the page and try again.',
  IDENTITY_DISABLED: 'Their sign-in account is disabled, so no email can be sent.',
  IDENTITY_EMAIL_CHANGED: 'The account with this email now uses a different address. Edit the employee’s email and try again.',
  BINDING_CONFLICT: 'This email already belongs to a different employee in this workspace.',
  ROLE_ESCALATION_FORBIDDEN: 'This employee has an admin role you don’t have, so you can’t invite them.',
  ADMIN_REQUIRED: 'Only an admin of this workspace can send invitations.',
  IDENTITY_BUSY: 'Their account is being changed right now. Try again in a moment.',
  BINDING_BUSY: 'Their account is being changed right now. Try again in a moment.',
};

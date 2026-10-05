const MESSAGES = {
  INVITATION_STALE: "This invitation has expired or changed. Ask your administrator for a new invitation.",
  PENDING_INVITATION: "Accept the invitation to continue to this workspace.",
  LAST_SIGNIN_METHOD: "Add another sign-in method before removing this provider.",
  PROVIDER_NOT_LINKED: "This provider is no longer linked. Refresh your account details.",
  PHONE_IN_USE: "This phone number cannot be used for this account.",
  INVALID_MOBILE_NUMBER: "This mobile number cannot be used here.",
  SESSION_REQUIRED: "Your session has ended. Sign in again.",
  SESSION_REVOKED: "Your session has ended. Sign in again.",
  SESSION_EXPIRED: "Your session has ended. Sign in again.",
  ACTION_COMPLETE: "Your account has been updated.",
  ACTION_CANCELLED: "The account change was cancelled.",
  ACTION_FAILED: "The account change could not be completed. Please try again.",
  ACCOUNT_LOCKED: "Your account is locked. Contact your administrator.",
  DIGIT_ACCOUNT_INACTIVE: "Your account is inactive. Contact your administrator.",
  IDENTITY_EMAIL_CHANGED: "Your email has changed. Sign in again.",
  EMPLOYEE_ACCOUNT_NOT_LINKED: "Your account has not been linked to this workspace. Contact your administrator.",
};

export function identityMessage(code) {
  return {
    messageKey: `CORE_IDENTITY_${code || "UNAVAILABLE"}`,
    message: MESSAGES[code] || "This account request could not be completed. Please try again.",
  };
}

/**
 * Citizen phone OTP sign-in through the Identity BFF (#2189, contract in
 * #2201 `ffe1b38fd`). The BFF issues and checks the code itself; there is no
 * Keycloak page in this flow. A verified code sets the citizen session cookie,
 * after which `establishIdentityBffSession` selects the DIGIT CITIZEN token as
 * after any other citizen sign-in.
 *
 * Framework-free so it can be unit tested with a fake fetch.
 */

const OTP_SEND_PATH = "/identity/v1/citizen/otp/_send";
const OTP_VERIFY_PATH = "/identity/v1/citizen/otp/_verify";

const getJson = async (fetchImpl, url) => {
  const response = await fetchImpl(url, { credentials: "include", headers: { Accept: "application/json" } });
  return { response, body: await response.json().catch(() => null) };
};

const postJson = async (fetchImpl, url, body) => {
  const response = await fetchImpl(url, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => null) };
};

/**
 * The citizen sign-in methods the BFF offers. `phoneOtp` is shown in digit-ui;
 * any other method is a Keycloak redirect through `/identity/v1/authorize`.
 */
export async function fetchCitizenSigninMethods({ fetchImpl }) {
  const { response, body } = await getJson(fetchImpl, "/identity/v1/auth-methods?intent=signin&surface=citizen");
  if (!response.ok) return { ok: false, phoneOtp: false, redirect: false };
  const methods = Array.isArray(body?.methods) ? body.methods : [];
  return {
    ok: true,
    phoneOtp: methods.some((method) => method?.type === "phone_otp"),
    redirect: methods.some((method) => method?.type !== "phone_otp"),
  };
}

// messageKey and English fallback per BFF error code. `{{seconds}}` and
// `{{attempts}}` are filled from the response.
const OTP_ERRORS = Object.freeze({
  INVALID_MOBILE_NUMBER: ["CORE_IDENTITY_OTP_INVALID_MOBILE", "This mobile number cannot be used here."],
  OTP_CHANNEL_UNAVAILABLE: [
    "CORE_IDENTITY_OTP_CHANNEL_UNAVAILABLE",
    "We can't send a code right now. Please try again later.",
  ],
  OTP_RESEND_TOO_SOON: ["CORE_IDENTITY_OTP_RESEND_TOO_SOON", "Please wait {{seconds}} seconds before requesting another code."],
  OTP_RATE_LIMITED: ["CORE_IDENTITY_OTP_RATE_LIMITED", "Too many codes requested. Try again in {{seconds}} seconds."],
  OTP_LOCKED: ["CORE_IDENTITY_OTP_LOCKED", "Too many wrong codes for this number. Try again in {{seconds}} seconds."],
  OTP_INVALID: ["CORE_IDENTITY_OTP_INVALID", "That code is not correct. {{attempts}} attempts left."],
  OTP_EXPIRED: ["CORE_IDENTITY_OTP_EXPIRED", "This code has expired. Request a new one."],
  IDENTITY_DISABLED: ["CORE_IDENTITY_ACCOUNT_DISABLED", "This account is disabled."],
  IDENTITY_CONFLICT: ["CORE_IDENTITY_SIGNIN_FAILED", "Sign-in could not be completed. Please try again."],
  IDENTITY_UNAVAILABLE: ["CORE_IDENTITY_SIGNIN_FAILED", "Sign-in could not be completed. Please try again."],
});

const retryAfterOf = (response, body) => {
  const value = Number(body?.retryAfter ?? response.headers?.get?.("Retry-After"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : undefined;
};

/**
 * `{ ok: false, code, messageKey, message, params, retryAfter?, attemptsRemaining? }`
 * for a failed call. `message` is the English fallback with params filled in.
 */
export function citizenOtpFailure(response, body) {
  const code = typeof body?.code === "string" ? body.code : undefined;
  const retryAfter = retryAfterOf(response, body);
  const attemptsRemaining = Number.isInteger(body?.attemptsRemaining) ? body.attemptsRemaining : undefined;
  const [messageKey, template] = OTP_ERRORS[code] ||
    (response.status === 404
      ? ["CORE_IDENTITY_TENANT_UNAVAILABLE", "This site is not available."]
      : ["CORE_IDENTITY_SIGNIN_UNAVAILABLE", "Sign-in is temporarily unavailable. Please try again."]);
  const params = { seconds: retryAfter ?? "", attempts: attemptsRemaining ?? "" };
  return {
    ok: false,
    code,
    messageKey,
    params,
    message: fillMessage(template, params),
    ...(retryAfter !== undefined ? { retryAfter } : {}),
    ...(attemptsRemaining !== undefined ? { attemptsRemaining } : {}),
  };
}

export function fillMessage(template, params) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    params?.[name] !== undefined ? String(params[name]) : match);
}

/**
 * Sends a code to `mobileNumber` (national number, no country code; the BFF
 * adds the route tenant's). Resolves to
 * `{ ok: true, challengeId, expiresIn, resendAfter }` or a failure.
 */
export async function sendCitizenOtp({ tenant, mobileNumber, locale, fetchImpl }) {
  const { response, body } = await postJson(fetchImpl, OTP_SEND_PATH, {
    tenantSlug: tenant.urlSlug,
    mobileNumber,
    ...(locale ? { locale } : {}),
  });
  if (response.status === 202 && typeof body?.challengeId === "string") {
    return {
      ok: true,
      challengeId: body.challengeId,
      expiresIn: Number(body.expiresIn) || undefined,
      resendAfter: Number(body.resendAfter) || 0,
    };
  }
  return citizenOtpFailure(response, body);
}

/** Checks `code`; on success the BFF has set the citizen session cookie. */
export async function verifyCitizenOtp({ tenant, challengeId, code, fetchImpl }) {
  const { response, body } = await postJson(fetchImpl, OTP_VERIFY_PATH, {
    tenantSlug: tenant.urlSlug,
    challengeId,
    code,
  });
  if (response.ok && body?.authenticated === true) return { ok: true };
  return citizenOtpFailure(response, body);
}

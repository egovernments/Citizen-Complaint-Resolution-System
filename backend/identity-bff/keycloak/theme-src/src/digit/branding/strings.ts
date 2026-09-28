/**
 * The DIGIT localization keys the login screens read from `branding.messages`,
 * each with the English text digit-ui itself falls back to.
 *
 * Where the legacy page has an explicit fallback (`tr(key, "…")` in
 * login.js / SelectMobileNumber.js / SelectOtp.js) that string is used
 * verbatim. Where it has none (it renders `t(key)`), the fallback is the
 * English seed text of the key, so a tenant with no localization still reads
 * as English rather than as raw keys.
 *
 * The BFF filters the tenant's localization to these keys (plus the dynamic
 * `TENANT_TENANTS_*` and privacy-policy keys, see `dynamicMessageKeys`).
 */
export const LOGIN_MESSAGE_FALLBACKS = {
    // Employee (pages/employee/Login/login.js, PrivacyComponent.js)
    CORE_COMMON_LOGIN: "Login",
    CORE_LOGIN_USERNAME: "Username",
    CORE_LOGIN_PASSWORD: "Password",
    CORE_COMMON_FORGOT_PASSWORD: "Forgot password?",
    ES_BY_CLICKING: "I agree to the DIGIT's",
    ES_PRIVACY_POLICY: "Privacy Policy",
    DIGIT_I_ACCEPT: "I accept",
    DIGIT_I_DO_NOT_ACCEPT: "I do not accept",
    DIGIT_TABLE_OF_CONTENTS: "Privacy Policy",
    INVALID_LOGIN_CREDENTIALS: "Invalid login credentials",
    ES_ERROR_USER_NOT_PERMITTED: "User is not permitted",
    CORE_COMMON_CONTINUE: "Continue",
    CORE_COMMON_CHANGE_PASSWORD: "Change Password",
    CORE_LOGIN_NEW_PASSWORD: "New Password",
    CORE_LOGIN_CONFIRM_NEW_PASSWORD: "Confirm New Password",
    CORE_COMMON_GO_BACK: "Go Back",
    // Citizen (pages/citizen/Login/config.js, SelectMobileNumber.js, SelectOtp.js)
    CS_LOGIN_PROVIDE_MOBILE_NUMBER: "Sign in",
    CS_LOGIN_TEXT: "We'll send you a one-time password to verify your number.",
    CORE_COMMON_MOBILE_NUMBER: "Mobile number",
    CS_COMMONS_NEXT: "Continue",
    ERR_INVALID_MOBILE_NUMBER: "Please enter a valid mobile number",
    MOBILE_VALIDATION_DIGITS: "digits",
    MOBILE_VALIDATION_AT_LEAST: "at least",
    MOBILE_VALIDATION_STARTING_WITH: "starting with",
    CS_LOGIN_OTP: "Verify your number",
    CS_LOGIN_OTP_TEXT: "Enter the 6-digit code we just sent.",
    CS_INVALID_OTP: "The OTP you entered is invalid.",
    CS_RESEND_ANOTHER_OTP: "Resend OTP in",
    CS_RESEND_SECONDS: "s",
    CS_RESEND_OTP: "Resend OTP",
    OTP_RESEND_ERROR: "Failed to resend OTP",
    CS_LOGIN_PROVIDE_NAME: "Provide your Name",
    CS_LOGIN_NAME_TEXT: "Provide the name of the person to make your experience more personalised",
    CORE_COMMON_NAME: "Name",
    CORE_COMMON_NAME_VALIDMSG: "Please enter a valid Name",
    CORE_COMMON_REQUIRED_ERRMSG: "Required"
} as const;

export type LoginMessageKey = keyof typeof LOGIN_MESSAGE_FALLBACKS;

export const LOGIN_MESSAGE_KEYS = Object.keys(LOGIN_MESSAGE_FALLBACKS) as LoginMessageKey[];

/** Digit.Utils.locale.getTransformedLocale. */
export function getTransformedLocale(label: string): string {
    return label.toUpperCase().replace(/[.:\-\s/]/g, "_");
}

/** `TENANT_TENANTS_{CODE}` for the header next to the logo. */
export function tenantLabelKey(code: string | undefined): string | undefined {
    return code ? getTransformedLocale(`TENANT_TENANTS_${code}`) : undefined;
}

export type Translator = {
    /** Localized text, else the key's English fallback. */
    t: (key: LoginMessageKey) => string;
    /** Localized text for a key only known at runtime, else `fallback`. */
    tr: (key: string | undefined, fallback: string) => string;
    /** True when the tenant localized this key. */
    has: (key: string) => boolean;
};

export function makeTranslator(messages: Record<string, string> | undefined): Translator {
    const table = messages ?? {};
    // digit-ui's `tr`: a translation that equals its key is "missing".
    const lookup = (key: string) => {
        const value = table[key];
        return typeof value === "string" && value !== "" && value !== key ? value : undefined;
    };
    return {
        t: key => lookup(key) ?? LOGIN_MESSAGE_FALLBACKS[key],
        tr: (key, fallback) => (key === undefined ? fallback : lookup(key) ?? fallback),
        has: key => lookup(key) !== undefined
    };
}

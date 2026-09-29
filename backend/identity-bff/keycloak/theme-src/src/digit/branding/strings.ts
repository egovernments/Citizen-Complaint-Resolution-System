/**
 * The DIGIT localization keys the login screens read from `branding.messages`,
 * each with the English text digit-ui itself falls back to.
 *
 * Where the legacy page has an explicit fallback (`tr(key, "…")` in
 * login.js) that string is used verbatim. Where it has none (it renders
 * `t(key)`), the fallback is the English seed text of the key, so a tenant
 * with no localization still reads as English rather than as raw keys.
 *
 * The BFF filters the tenant's localization to these keys (its
 * `LOGIN_MESSAGE_KEYS`, kept in step by the BFF's
 * `tests/unit/login-message-keys.test.ts`) plus the keys it derives from the
 * tenant's records (`dynamicMessageKeys`: `TENANT_TENANTS_*`, LoginConfig
 * texts/bannerImages, PrivacyPolicy).
 */
export const LOGIN_MESSAGE_FALLBACKS = {
    // Employee (pages/employee/Login/login.js, PrivacyComponent.js)
    CORE_COMMON_LOGIN: "Login",
    CORE_LOGIN_USERNAME: "Username",
    CORE_LOGIN_PASSWORD: "Password",
    CORE_COMMON_FORGOT_PASSWORD: "Forgot password?",
    ES_BY_CLICKING: "I agree to the DIGIT's",
    ES_PRIVACY_POLICY: "Privacy Policy",
    INVALID_LOGIN_CREDENTIALS: "Invalid login credentials",
    ES_ERROR_USER_NOT_PERMITTED: "User is not permitted",
    CORE_COMMON_CONTINUE: "Continue",
    CORE_COMMON_CHANGE_PASSWORD: "Change Password",
    CORE_LOGIN_NEW_PASSWORD: "New Password",
    CORE_LOGIN_CONFIRM_NEW_PASSWORD: "Confirm New Password",
    CORE_COMMON_GO_BACK: "Go Back"
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

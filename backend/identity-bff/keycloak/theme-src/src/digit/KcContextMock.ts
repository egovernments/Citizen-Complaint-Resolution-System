import { createGetKcContextMock } from "keycloakify/login/KcContext";
import { kcEnvDefaults, type ThemeName } from "../kc.gen";
import type { KcContextExtension, KcContextExtensionPerPage } from "../login/KcContext";
import { withFieldErrors } from "../login/mockStates";

/**
 * Mock Keycloak contexts for digit-employee and digit-citizen, used by the dev
 * server, the rendering tests and the screenshot baselines. Never bundled into
 * the theme (only dev.tsx and the tests import it).
 *
 * The action URL carries a `tab_id` like Keycloak's, so the slug fallback
 * (sessionStorage keyed by tab_id) is exercised the way it runs for real.
 */
export const MOCK_LOGIN_ACTION =
    "/auth/realms/digit/login-actions/authenticate?session_code=mock&execution=mock&client_id=digit-ui&tab_id=mockTab123";

const kcContextExtensionPerPage: KcContextExtensionPerPage = {
    "login-phone-number.ftl": { countryCode: "+254", mobileNumberRegex: "^(0?[17][0-9]{8}|[6-9][0-9]{9})$" },
    "login-sms-otp.ftl": { maskedPhoneNumber: "+254 7•••••678", resendAvailableInSeconds: 30, otpLength: 6 },
    "login-phone-profile.ftl": {}
};

function makeGetter(themeName: ThemeName, clientId: string) {
    const kcContextExtension: KcContextExtension = {
        themeName,
        properties: { ...kcEnvDefaults },
        client: { baseUrl: `https://digit.example.org/bomet/digit-ui/${themeName === "digit-citizen" ? "citizen" : "employee"}/` },
        digitTenant: "bomet"
    };
    return createGetKcContextMock({
        kcContextExtension,
        kcContextExtensionPerPage,
        overrides: {
            realm: { displayName: "DIGIT", displayNameHtml: "DIGIT" },
            url: { loginAction: MOCK_LOGIN_ACTION.replace("digit-ui", clientId) },
            locale: {
                currentLanguageTag: "en",
                supported: [
                    { languageTag: "en", label: "English", url: "?kc_locale=en" },
                    { languageTag: "fr", label: "Français", url: "?kc_locale=fr" }
                ]
            } as never
        },
        overridesPerPage: {
            "login.ftl": { realm: { resetPasswordAllowed: true } }
        }
    }).getKcContextMock;
}

const getEmployee = makeGetter("digit-employee", "digit-ui-employee");
const getCitizen = makeGetter("digit-citizen", "digit-ui-citizen");

export const DIGIT_EMPLOYEE_PAGES = [
    "login.ftl",
    "login-reset-password.ftl",
    "login-update-password.ftl",
    "login-page-expired.ftl",
    "info.ftl",
    "error.ftl"
] as const;

export const DIGIT_CITIZEN_PAGES = [
    "login-phone-number.ftl",
    "login-sms-otp.ftl",
    "login-phone-profile.ftl",
    "login-page-expired.ftl",
    "info.ftl",
    "error.ftl"
] as const;

export type DigitMockState =
    | "default"
    | "invalid-credentials"
    | "account-disabled"
    | "invalid-phone"
    | "invalid-otp"
    | "resend-ready"
    | "sms-failed"
    | "no-tenant";

/**
 * A digit theme context for `pageId`, optionally in one of the error states
 * the screenshot suite records. `tenant` replaces the SPI's `digitTenant`.
 */
export function getDigitKcContextMock(params: {
    themeName: "digit-employee" | "digit-citizen";
    pageId: string;
    state?: DigitMockState;
    tenant?: string | null;
}) {
    const get = params.themeName === "digit-employee" ? getEmployee : getCitizen;
    let kcContext = get({ pageId: params.pageId as never }) as ReturnType<typeof getEmployee> & Record<string, unknown>;

    if (params.tenant !== undefined) {
        kcContext = { ...kcContext, digitTenant: params.tenant ?? undefined };
    }

    switch (params.state) {
        case "invalid-credentials":
            // What Keycloak renders for a wrong password: the global message
            // and both field errors.
            kcContext = withFieldErrors(
                {
                    ...kcContext,
                    message: { type: "error", summary: "Invalid username or password." }
                },
                { username: "Invalid username or password.", password: "Invalid username or password." }
            );
            break;
        case "account-disabled":
            kcContext = { ...kcContext, message: { type: "error", summary: "Account is disabled, contact your administrator." } };
            break;
        case "invalid-phone":
            kcContext = {
                ...kcContext,
                phoneNumber: "12345",
                message: { type: "error", summary: "Please enter a valid mobile number" }
            };
            break;
        case "invalid-otp":
            kcContext = { ...kcContext, message: { type: "error", summary: "The OTP you entered is invalid." } };
            break;
        case "resend-ready":
            kcContext = { ...kcContext, resendAvailableInSeconds: 0 };
            break;
        case "sms-failed":
            kcContext = { ...kcContext, message: { type: "error", summary: "Failed to send OTP. Please try again." } };
            break;
        case "no-tenant":
            kcContext = { ...kcContext, digitTenant: undefined };
            break;
        default:
            break;
    }
    return kcContext;
}

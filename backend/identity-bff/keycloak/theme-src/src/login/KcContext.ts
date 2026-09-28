import type { ExtendKcContext } from "keycloakify/login";
import type { KcEnvName, ThemeName } from "../kc.gen";

export type KcContextExtension = {
    themeName: ThemeName;
    properties: Record<KcEnvName, string> & {};
    /**
     * Keycloak exposes the client's registered base URL on every login page;
     * Keycloakify's `Common` type only declares it on some. The theme uses it
     * to offer the way back to the Configurator, so declare it once here. It
     * is the client's own registered URL, never a request parameter.
     */
    client: {
        baseUrl?: string;
    };
    /**
     * The DIGIT tenant slug the digit-employee / digit-citizen screens are
     * branded for (#2167). Put on every page by the DIGIT FreeMarker provider
     * from the auth-session note `client_request_param_digit_tenant`, already
     * validated against `^[a-z0-9-]{2,63}$`. Display only.
     */
    digitTenant?: string;
};

/**
 * The phone + SMS OTP authenticator's own pages (digit-citizen-browser flow).
 * Keycloakify reads the page ids from this file to emit their .ftl files.
 */
export type KcContextExtensionPerPage = {
    "login-phone-number.ftl": {
        /** E.164 country code shown as the prefix, e.g. "+254". */
        countryCode?: string;
        /** The tenant's MobileNumberValidation.mobileNumberRegex (national part). */
        mobileNumberRegex?: string;
        /** The national number the user submitted, re-shown after an error. */
        phoneNumber?: string;
    };
    "login-sms-otp.ftl": {
        maskedPhoneNumber?: string;
        /** Seconds until `resend=true` is accepted; 0 when it already is. */
        resendAvailableInSeconds?: number;
        otpLength?: number;
    };
    "login-phone-profile.ftl": {
        firstName?: string;
        lastName?: string;
    };
};

export type KcContext = ExtendKcContext<KcContextExtension, KcContextExtensionPerPage>;

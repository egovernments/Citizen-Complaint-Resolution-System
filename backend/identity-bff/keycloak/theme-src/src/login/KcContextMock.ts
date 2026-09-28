import { createGetKcContextMock } from "keycloakify/login/KcContext";
import { kcEnvDefaults } from "../kc.gen";
import type { KcContextExtension, KcContextExtensionPerPage } from "./KcContext";

/**
 * The mock Keycloak context used by the dev server, the rendering tests and
 * the screenshot baselines. It is never bundled into the theme itself.
 */
const kcContextExtension: KcContextExtension = {
    themeName: "configurator-blue",
    properties: { ...kcEnvDefaults },
    client: { baseUrl: "https://digit.example.org/configurator/" }
};

// The phone/OTP pages belong to digit-citizen (src/digit/KcContextMock.ts).
const kcContextExtensionPerPage: KcContextExtensionPerPage = {
    "login-phone-number.ftl": {},
    "login-sms-otp.ftl": {},
    "login-phone-profile.ftl": {}
};

export const { getKcContextMock } = createGetKcContextMock({
    kcContextExtension,
    kcContextExtensionPerPage,
    overrides: {
        realm: { displayName: "DIGIT", displayNameHtml: "DIGIT" }
    },
    overridesPerPage: {
        "login.ftl": {
            social: {
                displayInfo: true,
                providers: [
                    {
                        alias: "google",
                        displayName: "Google",
                        loginUrl: "/auth/realms/digit/broker/google/login",
                        providerId: "google"
                    },
                    {
                        alias: "github",
                        displayName: "GitHub",
                        loginUrl: "/auth/realms/digit/broker/github/login",
                        providerId: "github"
                    }
                ]
            }
        },
        "login-username.ftl": {
            social: {
                displayInfo: true,
                providers: [
                    {
                        alias: "google",
                        displayName: "Google",
                        loginUrl: "/auth/realms/digit/broker/google/login",
                        providerId: "google"
                    },
                    {
                        alias: "github",
                        displayName: "GitHub",
                        loginUrl: "/auth/realms/digit/broker/github/login",
                        providerId: "github"
                    }
                ]
            }
        },
        "login-reset-password.ftl": {
            realm: {
                loginWithEmailAllowed: true,
                duplicateEmailsAllowed: false
            }
        }
    }
});

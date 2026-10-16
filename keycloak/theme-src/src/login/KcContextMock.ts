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

const kcContextExtensionPerPage: KcContextExtensionPerPage = {};

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

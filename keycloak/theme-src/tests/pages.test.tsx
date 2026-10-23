import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import KcPage from "../src/login/KcPage";
import { getKcContextMock } from "../src/login/KcContextMock";
import { withFieldErrors } from "../src/login/mockStates";
import { LOST_SESSION_MESSAGE_KEYS, lostSessionThemeProperties } from "../src/digit/shared/lostSession";

/** Every page this theme claims to cover, i.e. the supported password journey. */
const COVERED_PAGES = [
    "login.ftl",
    "login-username.ftl",
    "login-password.ftl",
    "login-reset-password.ftl",
    "login-update-password.ftl",
    "login-verify-email.ftl",
    "login-idp-link-confirm.ftl",
    "login-idp-link-email.ftl",
    "login-page-expired.ftl",
    "info.ftl",
    "error.ftl"
] as const;

async function renderPage(pageId: (typeof COVERED_PAGES)[number], patch?: (context: any) => any) {
    const base = getKcContextMock({ pageId });
    const kcContext = patch ? patch(base) : base;
    const view = render(<KcPage kcContext={kcContext as never} />);
    // The pages are lazy and the template waits for its (empty) stylesheet set.
    await waitFor(() => expect(document.querySelector(".digit-card")).not.toBeNull());
    return view;
}

describe("every covered page renders in the DIGIT shell", () => {
    it.each(COVERED_PAGES)("%s", async pageId => {
        const { container } = await renderPage(pageId);

        expect(container.querySelector(".digit-shell")).not.toBeNull();
        expect(container.querySelector(".digit-card")).not.toBeNull();
        expect(container.querySelector("#kc-page-title")).not.toBeNull();
        // The stock Keycloak/PatternFly class names must not survive: seeing
        // them means the page fell through to the default appearance.
        expect(container.querySelector(".pf-c-alert, .kc-form-card, #kc-header")).toBeNull();
    });
});

describe("login.ftl", () => {
    it("posts credentials to Keycloak's own action and nowhere else", async () => {
        const { container } = await renderPage("login.ftl");

        const form = container.querySelector<HTMLFormElement>("#kc-form-login")!;
        expect(form.getAttribute("method")).toBe("post");
        expect(form.getAttribute("action")).toBe(
            getKcContextMock({ pageId: "login.ftl" }).url.loginAction
        );
        expect(within(form).getByLabelText("Password")).toHaveAttribute("name", "password");
        // No other form on the page may accept the password field.
        const formsWithPassword = Array.from(container.querySelectorAll("form")).filter(
            candidate => candidate.querySelector("input[name='password']") !== null
        );
        expect(formsWithPassword).toHaveLength(1);
    });

    it("keeps Keycloak's hidden credentialId", async () => {
        const { container } = await renderPage("login.ftl");
        expect(container.querySelector("#id-hidden-input")).toHaveAttribute("name", "credentialId");
    });

    it("shows an invalid-credential error on the field, without naming which half failed", async () => {
        const { container } = await renderPage("login.ftl", context =>
            withFieldErrors(context, {
                username: "Invalid username or password.",
                password: "Invalid username or password."
            })
        );

        const error = container.querySelector("#username-error")!;
        expect(error).toHaveTextContent("Invalid username or password.");
        expect(container.querySelector("#username")).toHaveAttribute("aria-invalid", "true");
        expect(container.querySelector("#username")).toHaveAttribute(
            "aria-describedby",
            "username-error"
        );
    });

    it("offers the enabled identity providers as links to Keycloak's broker", async () => {
        const { container } = await renderPage("login.ftl", context => ({
            ...context,
            social: {
                ...context.social,
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
        }));

        const google = container.querySelector<HTMLAnchorElement>("#social-google")!;
        expect(google.getAttribute("href")).toBe("/auth/realms/digit/broker/google/login");
        expect(google).toHaveTextContent("Log in with Google");
        expect(google.querySelector("svg.digit-provider-logo")).not.toBeNull();
        const github = container.querySelector<HTMLAnchorElement>("#social-github")!;
        expect(github).toHaveTextContent("Log in with GitHub");
        expect(github.querySelector("svg.digit-provider-logo")).not.toBeNull();
        expect(github.querySelector("path")).toHaveAttribute("fill", "#181717");
    });

    it("keeps the way back to the Configurator for password help", async () => {
        const { container } = await renderPage("login.ftl");
        const help = container.querySelector<HTMLAnchorElement>("#kc-digit-password-help a")!;
        expect(help).toHaveTextContent("Set up or reset your password");
        expect(help.getAttribute("href")).toBe(
            "https://digit.example.org/configurator/?passwordHelp=1"
        );
    });
});

describe("login-update-password.ftl", () => {
    it("asks for the new password twice and reports a mismatch on the confirm field", async () => {
        const { container } = await renderPage("login-update-password.ftl", context =>
            withFieldErrors(context, { "password-confirm": "Passwords don't match." })
        );

        expect(container.querySelector("#password-new")).toHaveAttribute("name", "password-new");
        expect(container.querySelector("#password-confirm")).toHaveAttribute(
            "name",
            "password-confirm"
        );
        expect(container.querySelector("#password-confirm-error")).toHaveTextContent(
            "Passwords don't match."
        );
    });

    it("offers logging other sessions out", async () => {
        const { container } = await renderPage("login-update-password.ftl");
        expect(container.querySelector("#logout-sessions")).toHaveAttribute(
            "name",
            "logout-sessions"
        );
    });
});

describe("login-reset-password.ftl", () => {
    it("explains the reset and uses a specific action label without enumerating accounts", async () => {
        await renderPage("login-reset-password.ftl");
        expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
        expect(screen.getByLabelText("Email address or username")).toBeInTheDocument();
        expect(
            screen.getByText("Enter the email address or username associated with your account.")
        ).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Email me a reset link" })).toBeInTheDocument();
        expect(
            screen.getByText(/never reveal which sign-in methods an email uses/i)
        ).toBeInTheDocument();
    });
});

describe("login-page-expired.ftl", () => {
    it("keeps both of Keycloak's recovery routes", async () => {
        const { container } = await renderPage("login-page-expired.ftl");
        expect(container.querySelector("#loginRestartLink")).not.toBeNull();
        expect(container.querySelector("#loginContinueLink")).not.toBeNull();
    });
});

describe("error.ftl", () => {
    it("shows the server message in the themed alert and links back to the application", async () => {
        const { container } = await renderPage("error.ftl");
        expect(container.querySelector(".digit-alert--error")).not.toBeNull();
        expect(container.querySelector("#backToApplication")).not.toBeNull();
    });
});

describe("digit-employee error.ftl", () => {
    const COOKIE_NOT_FOUND = "Cookie not found. Please make sure cookies are enabled in your browser.";
    // Keycloak's base-theme wording: server text that differs from keycloakify's client-side copy.
    const KC_COOKIE_NOT_FOUND =
        "Restart login cookie not found. It may have expired; it may have been deleted or cookies are disabled in your browser. If cookies are disabled then enable them. Click Back to Application to login again.";
    const KC_COOKIE_NOT_FOUND_FR =
        "Cookie de redémarrage de la connexion non trouvé. Il peut avoir expiré, il peut avoir été supprimé ou les cookies peuvent avoir été sur votre navigateur. Assurez-vous que les cookies soient activés dans votre navigateur. Cliquez sur Retour à l'application pour vous connecter à nouveau.";
    const BASE_URL = "https://digit.example.org/digit-ui/employee/user/login";
    const TENANT_SIGN_IN = "https://digit.example.org/testj01/digit-ui/employee/user/login";

    afterEach(() => {
        vi.unstubAllGlobals();
        sessionStorage.clear();
        window.history.replaceState(null, "", "/");
    });

    // Keycloak renders a lost sign-in's error page with no form action, as the
    // answer to the sign-in form's post: only the page address carries tab_id.
    // `serverMessages` stands for what keycloakify had the server resolve for
    // the keys theme.properties names (lostSession.ts): Keycloak's own wording,
    // a realm override, in the page's locale.
    async function renderEmployeeError(
        summary: string,
        options: { serverMessages?: Record<string, string>; languageTag?: string; baseUrl?: string } = {}
    ) {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
        window.history.replaceState(null, "", "/auth/realms/digit/login-actions/authenticate?client_id=digit-ui-employee&tab_id=tab-1");
        const base = getKcContextMock({ pageId: "error.ftl" });
        const kcContext = {
            ...base,
            themeName: "digit-employee",
            url: { ...base.url, loginAction: undefined },
            client: { ...base.client, baseUrl: options.baseUrl ?? BASE_URL },
            message: { type: "error", summary },
            locale: { ...base.locale, currentLanguageTag: options.languageTag ?? "en" },
            "x-keycloakify": { ...base["x-keycloakify"], messages: options.serverMessages ?? {} }
        };
        render(<KcPage kcContext={kcContext as never} />);
        await waitFor(() => expect(document.querySelector("#kc-error-message")).not.toBeNull());
    }

    it("starts a lost sign-in again at the tenant this tab signed in to, on the client's origin", async () => {
        sessionStorage.setItem("digit_tenant:tab-1", "testj01");
        await renderEmployeeError(COOKIE_NOT_FOUND);
        const link = document.querySelector("#restartSignIn");
        expect(link).toHaveTextContent("Start sign-in again");
        // Not Keycloak's origin (the page's): digit-ui may be elsewhere.
        expect(link).toHaveAttribute("href", TENANT_SIGN_IN);
        expect(document.querySelector("#backToApplication")).toBeNull();
    });

    it("starts it at the client's base URL when the tab's tenant is unknown", async () => {
        await renderEmployeeError(COOKIE_NOT_FOUND);
        expect(document.querySelector("#restartSignIn")).toHaveAttribute("href", BASE_URL);
    });

    it("recognises the text this Keycloak rendered, not only keycloakify's copy", async () => {
        sessionStorage.setItem("digit_tenant:tab-1", "testj01");
        await renderEmployeeError(KC_COOKIE_NOT_FOUND, { serverMessages: { cookieNotFoundMessage: KC_COOKIE_NOT_FOUND } });
        expect(document.querySelector("#restartSignIn")).toHaveAttribute("href", TENANT_SIGN_IN);
    });

    it("recognises a realm override of the message", async () => {
        const reworded = "Your sign-in was interrupted. Please sign in again.";
        await renderEmployeeError(reworded, { serverMessages: { expiredCodeMessage: reworded } });
        expect(document.querySelector("#restartSignIn")).toHaveAttribute("href", BASE_URL);
    });

    it("recognises an override written with HTML entities", async () => {
        // keycloakify entity-decodes the server-resolved message, not the summary.
        await renderEmployeeError("Session lost &mdash; please sign in again", {
            serverMessages: { cookieNotFoundMessage: "Session lost \u2014 please sign in again" }
        });
        expect(document.querySelector("#restartSignIn")).toHaveAttribute("href", BASE_URL);
    });

    it("recognises the server's French text", async () => {
        await renderEmployeeError(KC_COOKIE_NOT_FOUND_FR, {
            languageTag: "fr",
            serverMessages: { cookieNotFoundMessage: KC_COOKIE_NOT_FOUND_FR }
        });
        expect(document.querySelector("#restartSignIn")).toHaveTextContent("Recommencer la connexion");
    });

    it("falls back to keycloakify's French copy when the server resolved none", async () => {
        await renderEmployeeError("Connexion expirée. Veuillez vous reconnecter.", { languageTag: "fr" });
        await waitFor(() => expect(document.querySelector("#restartSignIn")).toHaveAttribute("href", BASE_URL));
    });

    it("shows no restart link without the client's base URL, rather than one on Keycloak's origin", async () => {
        sessionStorage.setItem("digit_tenant:tab-1", "testj01");
        await renderEmployeeError(COOKIE_NOT_FOUND, { baseUrl: "" });
        expect(document.querySelector("#restartSignIn")).toBeNull();
    });

    it("keeps Back to Application for other errors", async () => {
        sessionStorage.setItem("digit_tenant:tab-1", "testj01");
        await renderEmployeeError("Invalid parameter: redirect_uri", {
            serverMessages: { cookieNotFoundMessage: KC_COOKIE_NOT_FOUND }
        });
        expect(document.querySelector("#restartSignIn")).toBeNull();
        expect(document.querySelector("#backToApplication")).toHaveAttribute("href", BASE_URL);
    });
});

describe("lost-session theme properties", () => {
    it("name every key as a value keycloakify asks the server to resolve", () => {
        expect(lostSessionThemeProperties).toHaveLength(LOST_SESSION_MESSAGE_KEYS.length);
        LOST_SESSION_MESSAGE_KEYS.forEach((key, i) => {
            const [name, value] = lostSessionThemeProperties[i]!.split("=");
            expect(value).toBe(key);
            // keycloakify resolves values matching this; it drops kc* properties.
            expect(value).toMatch(/^[a-zA-Z0-9-_.]*$/);
            expect(name).not.toMatch(/^kc/);
        });
    });
});

describe("password reveal", () => {
    it("labels the toggle and points it at the input it controls", async () => {
        await renderPage("login.ftl");
        const toggle = screen.getByRole("button", { name: /show password/i });
        expect(toggle).toHaveAttribute("aria-controls", "password");
        expect(toggle).toHaveAttribute("type", "button");
    });
});

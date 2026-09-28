import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import KcPage from "../src/login/KcPage";
import { getKcContextMock } from "../src/login/KcContextMock";
import { withFieldErrors } from "../src/login/mockStates";

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

describe("password reveal", () => {
    it("labels the toggle and points it at the input it controls", async () => {
        await renderPage("login.ftl");
        const toggle = screen.getByRole("button", { name: /show password/i });
        expect(toggle).toHaveAttribute("aria-controls", "password");
        expect(toggle).toHaveAttribute("type", "button");
    });
});

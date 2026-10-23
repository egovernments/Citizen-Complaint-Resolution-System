import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import KcPage from "../src/login/KcPage";
import { getKcContextMock } from "../src/login/KcContextMock";

const LOGIN_ACTION = "/auth/realms/digit/login-actions/authenticate?session_code=s&execution=e&client_id=digit-ui-employee&tab_id=tab-1";

/** digit-employee's login.ftl for tenant testj01, with `query` on the page's own URL as Keycloak serves it. */
async function renderLogin(path: string, username?: string) {
    window.history.replaceState(null, "", path);
    const base = getKcContextMock({ pageId: "login.ftl" });
    const kcContext = {
        ...base,
        themeName: "digit-employee",
        digitTenant: "testj01",
        url: { ...base.url, loginAction: LOGIN_ACTION },
        login: { ...base.login, username }
    };
    const view = render(<KcPage kcContext={kcContext as never} />);
    await waitFor(() => expect(view.container.querySelector("#kc-form-login")).not.toBeNull());
    return view;
}

const authorize = (query: string) => `/auth/realms/digit/protocol/openid-connect/auth?client_id=digit-ui-employee&digit_tenant=testj01${query}`;

beforeEach(() => {
    // No tenant branding: the page renders with its built-in strings.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
});
afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
});

describe("digit-employee login.ftl before an account action (#2645)", () => {
    it.each([
        ["UPDATE_PASSWORD", "Confirm it's you to change your password"],
        ["CONFIGURE_TOTP", "Confirm it's you to set up an authenticator"],
        ["UPDATE_EMAIL", "Confirm it's you to change your email"],
        ["delete_credential:otp-1", "Confirm it's you to continue"]
    ])("%s: says it is a confirmation, for the signed-in person, with a way back", async (action, heading) => {
        const { container } = await renderLogin(authorize(`&kc_action=${action}&login_hint=purity`), "purity");

        expect(container.querySelector("#kc-page-title")).toHaveTextContent(heading);
        expect(screen.getByLabelText(/Username/)).toHaveValue("purity");
        expect(screen.getByLabelText(/Username/)).toHaveAttribute("readonly");
        expect(container.querySelector("#kc-cancel")).toHaveAttribute("href", "/testj01/digit-ui/employee/user/account");
    });

    it("stays the confirmation on the page after a wrong password", async () => {
        const first = await renderLogin(authorize("&kc_action=UPDATE_PASSWORD&login_hint=purity"), "purity");
        first.unmount();
        // Keycloak re-renders the form from its own action URL, without kc_action.
        const { container } = await renderLogin(LOGIN_ACTION, "purity");

        expect(container.querySelector("#kc-page-title")).toHaveTextContent("Confirm it's you to change your password");
        expect(container.querySelector("#kc-cancel")).not.toBeNull();
    });

    it("leaves the username editable when Keycloak had no hint to fill in", async () => {
        await renderLogin(authorize("&kc_action=UPDATE_PASSWORD"));

        expect(screen.getByLabelText(/Username/)).not.toHaveAttribute("readonly");
    });

    it("leaves a normal sign-in unchanged", async () => {
        const { container } = await renderLogin(authorize(""));

        expect(container.querySelector("#kc-page-title")).toHaveTextContent("Login");
        expect(screen.getByLabelText(/Username/)).not.toHaveAttribute("readonly");
        expect(container.querySelector("#kc-cancel")).toBeNull();
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import KcPage from "../../src/login/KcPage";
import {
    DIGIT_CITIZEN_PAGES,
    DIGIT_EMPLOYEE_PAGES,
    getDigitKcContextMock,
    type DigitMockState
} from "../../src/digit/KcContextMock";
import fixture from "./fixtures/branding-bomet.json";

let fetchMock: ReturnType<typeof vi.fn>;

function serveBranding(body: unknown = fixture, status = 200) {
    fetchMock = vi.fn(async () =>
        status === 200 ? new Response(JSON.stringify(body), { status }) : new Response("", { status })
    );
    vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
    sessionStorage.clear();
    document.documentElement.removeAttribute("style");
    delete document.documentElement.dataset.headerTone;
    serveBranding();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

async function renderDigit(
    themeName: "digit-employee" | "digit-citizen",
    pageId: string,
    state?: DigitMockState,
    tenant?: string | null
) {
    const kcContext = getDigitKcContextMock({ themeName, pageId, state, tenant });
    const view = render(<KcPage kcContext={kcContext as never} />);
    await waitFor(() => expect(document.querySelector(".dg-root")).not.toBeNull());
    return { ...view, kcContext };
}

describe("every covered page renders in the legacy chrome", () => {
    it.each(DIGIT_EMPLOYEE_PAGES)("digit-employee %s", async pageId => {
        const { container } = await renderDigit("digit-employee", pageId);
        expect(container.querySelector(".dg-banner .dg-card--employee")).not.toBeNull();
        expect(container.querySelector("#kc-page-title")).not.toBeNull();
        expect(container.querySelector(".pf-c-alert, .kc-form-card, #kc-header, .digit-shell")).toBeNull();
    });

    it.each(DIGIT_CITIZEN_PAGES)("digit-citizen %s", async pageId => {
        const { container } = await renderDigit("digit-citizen", pageId);
        expect(container.querySelector(".dg-navbar")).not.toBeNull();
        expect(container.querySelector(".dg-citizen-footer")).not.toBeNull();
        expect(container.querySelector("#kc-page-title")).not.toBeNull();
        expect(container.querySelector(".pf-c-alert, .kc-form-card, #kc-header, .digit-shell")).toBeNull();
    });
});

describe("tenant branding", () => {
    it("fetches the slug's branding and paints the tenant's ThemeConfig", async () => {
        await renderDigit("digit-employee", "login.ftl");
        expect(fetchMock).toHaveBeenCalledWith("/identity/v1/tenant-contexts/bomet/branding", expect.anything());
        const style = document.documentElement.style;
        expect(style.getPropertyValue("--color-button-primary-bg-default")).toBe("#2563EB");
        expect(style.getPropertyValue("--color-digitv2-header-sidenav")).toBe("#0B1F3A");
        expect(document.documentElement.dataset.headerTone).toBe("dark");
        expect(screen.getByText("Bomet County")).toBeInTheDocument();
        expect(screen.getByAltText("Digit Banner")).toHaveAttribute("src", "/dev-fixtures/bomet-county-logo.svg");
    });

    it("falls back to the default DIGIT look when branding fails", async () => {
        serveBranding(undefined, 500);
        const { container } = await renderDigit("digit-employee", "login.ftl");
        expect(document.documentElement.style.getPropertyValue("--color-button-primary-bg-default")).toBe("#c84c0e");
        expect(container.querySelector(".dg-banner-header")).toBeNull();
        // No policy, so no consent gate.
        expect(container.querySelector("#privacy-component-check")).toBeNull();
        expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
    });

    it("renders the default look without fetching when there is no tenant at all", async () => {
        await renderDigit("digit-citizen", "login-phone-number.ftl", undefined, null);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    });
});

describe("digit-employee login.ftl", () => {
    it("posts username/password and Keycloak's credentialId to the login action only", async () => {
        const { container, kcContext } = await renderDigit("digit-employee", "login.ftl");
        const form = container.querySelector<HTMLFormElement>("#kc-form-login")!;
        expect(form.getAttribute("action")).toBe(kcContext.url.loginAction);
        expect(form.getAttribute("method")).toBe("post");
        expect(within(form).getByLabelText(/User Name/)).toHaveAttribute("name", "username");
        expect(form.querySelector("input[name='password']")).toHaveAttribute("type", "password");
        expect(form.querySelector("#id-hidden-input")).toHaveAttribute("name", "credentialId");
        const withPassword = Array.from(container.querySelectorAll("form")).filter(
            f => f.querySelector("input[name='password']") !== null
        );
        expect(withPassword).toHaveLength(1);
    });

    it("keeps Login disabled until both fields are filled and the privacy policy is accepted", async () => {
        const { container } = await renderDigit("digit-employee", "login.ftl");
        const submit = screen.getByRole("button", { name: "Login" });
        expect(submit).toBeDisabled();
        fireEvent.change(container.querySelector("#username")!, { target: { value: "KE_GRO" } });
        fireEvent.change(container.querySelector("#password")!, { target: { value: "secret" } });
        expect(submit).toBeDisabled();

        fireEvent.click(screen.getByRole("button", { name: "Privacy Policy" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("What we collect", { selector: "div" })).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole("button", { name: "I accept" }));
        expect(container.querySelector<HTMLInputElement>("#privacy-component-check")!.checked).toBe(true);
        expect(submit).toBeEnabled();

        fireEvent.click(screen.getByRole("button", { name: "Privacy Policy" }));
        fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "I do not accept" }));
        expect(submit).toBeDisabled();
    });

    it("toggles the password between hidden and shown", async () => {
        const { container } = await renderDigit("digit-employee", "login.ftl");
        const toggle = screen.getByRole("button", { name: "Show password" });
        expect(toggle).toHaveAttribute("aria-controls", "password");
        fireEvent.click(toggle);
        expect(container.querySelector("#password")).toHaveAttribute("type", "text");
        expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
    });

    it("sends 'Forgot password?' to Keycloak's reset-credentials URL", async () => {
        const { kcContext } = await renderDigit("digit-employee", "login.ftl");
        expect(screen.getByRole("link", { name: "Forgot Password?" })).toHaveAttribute(
            "href",
            (kcContext.url as { loginResetCredentialsUrl: string }).loginResetCredentialsUrl
        );
    });

    it("reports bad credentials with the legacy toast, not by field", async () => {
        const { container } = await renderDigit("digit-employee", "login.ftl", "invalid-credentials");
        expect(screen.getByRole("alert")).toHaveTextContent("Invalid username or password. Please try again.");
        expect(container.querySelector("#username")).not.toHaveAttribute("aria-invalid");
        expect(screen.queryByText("Invalid username or password.")).toBeNull();
    });

    it("raises any other Keycloak error as the toast too", async () => {
        await renderDigit("digit-employee", "login.ftl", "account-disabled");
        expect(screen.getByRole("alert")).toHaveTextContent("Account is disabled");
    });
});

describe("digit-citizen login-phone-number.ftl", () => {
    it("shows the tenant's prefix and the regex-derived hint, and posts phoneNumber", async () => {
        const { container, kcContext } = await renderDigit("digit-citizen", "login-phone-number.ftl");
        expect(container.querySelector("#login-mobile-prefix")).toHaveTextContent("+254");
        expect(container.querySelector("#login-mobile-hint")).toHaveTextContent(
            "Please enter a valid mobile number (9-10 digits)"
        );
        const form = container.querySelector<HTMLFormElement>("#kc-phone-number-form")!;
        expect(form.getAttribute("action")).toBe(kcContext.url.loginAction);
        const input = container.querySelector<HTMLInputElement>("#login-mobile")!;
        expect(input).toHaveAttribute("name", "phoneNumber");
        expect(input).toHaveAttribute("maxLength", "10");
        expect(screen.getByRole("heading", { name: "Provide your mobile number" })).toBeInTheDocument();
        expect(screen.getByText("Bomet County")).toBeInTheDocument();
    });

    it("keeps digits only, flags a non-matching number and enables Next on a valid one", async () => {
        const { container } = await renderDigit("digit-citizen", "login-phone-number.ftl");
        const input = container.querySelector<HTMLInputElement>("#login-mobile")!;
        const next = screen.getByRole("button", { name: "Next" });
        fireEvent.change(input, { target: { value: "5a1" } });
        expect(input.value).toBe("51");
        expect(container.querySelector("#login-mobile-hint")).toHaveClass("is-error");
        expect(next).toBeDisabled();
        fireEvent.change(input, { target: { value: "712345678" } });
        expect(container.querySelector("#login-mobile-hint")).not.toHaveClass("is-error");
        expect(next).toBeEnabled();
    });

    it("maps the SPI's digitInvalidPhone to the red hint instead of a toast", async () => {
        const { container } = await renderDigit("digit-citizen", "login-phone-number.ftl", "invalid-phone");
        expect(container.querySelector("#login-mobile-hint")).toHaveClass("is-error");
        expect(container.querySelector<HTMLInputElement>("#login-mobile")!.value).toBe("12345");
        expect(screen.queryByRole("alert")).toBeNull();
    });
});

describe("digit-citizen login-sms-otp.ftl", () => {
    it("renders one box per digit, the first with one-time-code autofill, and the masked number", async () => {
        const { container } = await renderDigit("digit-citizen", "login-sms-otp.ftl");
        const boxes = container.querySelectorAll<HTMLInputElement>(".dg-otp__box");
        expect(boxes).toHaveLength(6);
        expect(boxes[0]).toHaveAttribute("autocomplete", "one-time-code");
        expect(boxes[1]).toHaveAttribute("autocomplete", "off");
        expect(screen.getByText("Enter the OTP sent to +254 7•••••678")).toBeInTheDocument();
    });

    it("auto-advances, accepts a pasted code and posts it as `otp`", async () => {
        const { container } = await renderDigit("digit-citizen", "login-sms-otp.ftl");
        const boxes = container.querySelectorAll<HTMLInputElement>(".dg-otp__box");
        const hidden = container.querySelector<HTMLInputElement>("input[name='otp']")!;
        const next = screen.getByRole("button", { name: "Next" });

        fireEvent.change(boxes[0]!, { target: { value: "4" } });
        expect(document.activeElement).toBe(boxes[1]);
        expect(hidden.value).toBe("4");
        expect(next).toBeDisabled();

        fireEvent.paste(container.querySelector(".dg-otp")!, {
            clipboardData: { getData: () => "12-34 56" }
        });
        expect(hidden.value).toBe("123456");
        expect(Array.from(boxes).map(box => box.value).join("")).toBe("123456");
        expect(next).toBeEnabled();
        expect(container.querySelector("#kc-otp-form")).toContainElement(hidden);
    });

    it("replaces the digit when typing into an already-filled box", async () => {
        const { container } = await renderDigit("digit-citizen", "login-sms-otp.ftl");
        const boxes = container.querySelectorAll<HTMLInputElement>(".dg-otp__box");
        const hidden = container.querySelector<HTMLInputElement>("input[name='otp']")!;
        fireEvent.paste(container.querySelector(".dg-otp")!, {
            clipboardData: { getData: () => "123456" }
        });
        // The first box keeps the old digit and the new one side by side.
        fireEvent.change(boxes[0]!, { target: { value: "17" } });
        expect(hidden.value).toBe("723456");
        expect(document.activeElement).toBe(boxes[1]);
        fireEvent.change(boxes[0]!, { target: { value: "97" } });
        expect(hidden.value).toBe("923456");
    });

    it("counts down 30s, then offers a resend that posts resend=true", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const { container } = await renderDigit("digit-citizen", "login-sms-otp.ftl");
        expect(container.querySelector("#otp-resend-countdown")).toHaveTextContent("Resend another OTP 30 secs");
        for (let i = 0; i < 30; i++) {
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1000);
            });
        }
        await waitFor(() => expect(container.querySelector("#kc-otp-resend-form")).not.toBeNull());
        const resend = container.querySelector<HTMLFormElement>("#kc-otp-resend-form")!;
        expect(resend.querySelector("input[name='resend']")).toHaveAttribute("value", "true");
        expect(within(resend).getByRole("button", { name: "Resend OTP" })).toBeInTheDocument();
    });

    it("starts at Keycloak's resendAvailableInSeconds", async () => {
        const { container } = await renderDigit("digit-citizen", "login-sms-otp.ftl", "resend-ready");
        expect(container.querySelector("#kc-otp-resend-form")).not.toBeNull();
    });

    it("shows CS_INVALID_OTP under the boxes for a wrong code", async () => {
        const { container } = await renderDigit("digit-citizen", "login-sms-otp.ftl", "invalid-otp");
        expect(container.querySelector("#otp-error")).toHaveTextContent("Invalid OTP");
        expect(container.querySelector(".dg-otp__box")).toHaveAttribute("aria-invalid", "true");
        expect(screen.queryByRole("alert", { name: "" })).toBe(container.querySelector("#otp-error"));
    });

    it("raises other authenticator errors as the legacy toast", async () => {
        const { container } = await renderDigit("digit-citizen", "login-sms-otp.ftl", "sms-failed");
        expect(container.querySelector("#dg-toast")).toHaveTextContent("Failed to send OTP. Please try again.");
        expect(container.querySelector("#otp-error")).toBeNull();
    });
});

describe("digit-citizen login-phone-profile.ftl", () => {
    it("asks for a single name, validated like the server, posted as firstName", async () => {
        const { container } = await renderDigit("digit-citizen", "login-phone-profile.ftl");
        expect(screen.getByRole("heading", { name: "Provide your Name" })).toBeInTheDocument();
        const input = container.querySelector<HTMLInputElement>("#firstName")!;
        expect(input).toHaveAttribute("name", "firstName");
        fireEvent.change(input, { target: { value: "Jane <b>" } });
        fireEvent.blur(input);
        expect(container.querySelector("#firstName-error")).toHaveTextContent("Please enter a valid Name");
        fireEvent.change(input, { target: { value: "Jane Chebet" } });
        expect(container.querySelector("#firstName-error")).toBeNull();
    });

    it("accepts the Unicode names the server accepts and rejects its prohibited characters", async () => {
        const { container } = await renderDigit("digit-citizen", "login-phone-profile.ftl");
        const input = container.querySelector<HTMLInputElement>("#firstName")!;
        fireEvent.blur(input);
        for (const ok of ["João", "O’Brien", "O'Brien", "Anne-Marie", "Zoë  Wanjiru "]) {
            fireEvent.change(input, { target: { value: ok } });
            expect(container.querySelector("#firstName-error"), ok).toBeNull();
        }
        for (const bad of ["a/b", "x=y", "(Jane)", "Jane;", "Jane$", "Ja\u0007ne"]) {
            fireEvent.change(input, { target: { value: bad } });
            expect(container.querySelector("#firstName-error"), bad).not.toBeNull();
        }
    });
});

describe("configurator-blue is untouched", () => {
    it("does not load the digit stylesheet classes or fetch branding", async () => {
        const { getKcContextMock } = await import("../../src/login/KcContextMock");
        render(<KcPage kcContext={getKcContextMock({ pageId: "login.ftl" }) as never} />);
        await waitFor(() => expect(document.querySelector(".digit-card")).not.toBeNull());
        expect(document.querySelector(".dg-root")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EmployeeKcPage from "../src/digit/employee/EmployeeKcPage";
import { getKcContextMock } from "../src/login/KcContextMock";

afterEach(() => vi.unstubAllGlobals());

describe("digit-employee login.ftl (#2646)", () => {
    it("asks for the email, and hints when the value is not one", async () => {
        // No public API in the test: branding falls back to the built-in strings.
        vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
        const { container } = render(<EmployeeKcPage kcContext={getKcContextMock({ pageId: "login.ftl" }) as never} />);
        await waitFor(() => expect(container.querySelector("#username")).not.toBeNull());

        const label = container.querySelector("label[for='username']")!;
        expect(label.textContent).toMatch(/^Email\s*\*?$/);
        expect(label.textContent).not.toMatch(/user\s*name/i);
        const field = within(container).getByLabelText(/^Email/);
        expect(field).toHaveAttribute("name", "username");
        expect(screen.queryByRole("note")).toBeNull();

        fireEvent.change(field, { target: { value: "EMP-0001" } });
        expect(screen.getByRole("note")).toHaveTextContent(/email address, not your employee code/i);
        expect(field).toHaveAccessibleDescription(/email address, not your employee code/i);

        fireEvent.change(field, { target: { value: "asha@example.org" } });
        expect(screen.queryByRole("note")).toBeNull();
        expect(field).not.toHaveAttribute("aria-describedby");
    });
});

describe("digit-employee forgot password (#2700)", () => {
    it("opens the email form in the page's one Template, and a reply after Go back is dropped", async () => {
        // Branding fetches reject; the reset request waits until the test answers it.
        let answerReset: ((response: Response) => void) | undefined;
        let resetRequests = 0;
        vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
            const isReset = String(input instanceof Request ? input.url : input).endsWith("/password/setup-requests");
            if (isReset) resetRequests++;
            return isReset && answerReset === undefined
                ? new Promise<Response>(resolve => (answerReset = resolve))
                : Promise.reject(new Error("offline"));
        });
        const { container } = render(<EmployeeKcPage kcContext={getKcContextMock({ pageId: "login.ftl" }) as never} />);
        await waitFor(() => expect(container.querySelector("#kc-forgot-password")).not.toBeNull());
        // A second Template mount makes keycloakify call location.reload() in a real browser
        // (jsdom only logs it), so the check is that the Template's DOM survives.
        const title = container.querySelector("#kc-page-title")!;
        const page = within(container);
        const openForgot = async () => {
            fireEvent.click(container.querySelector("#kc-forgot-password")!);
            await waitFor(() => expect(container.querySelector("#kc-reset-password-form")).not.toBeNull());
        };
        const goBack = async () => {
            fireEvent.click(page.getByRole("button", { name: /go back/i }));
            await waitFor(() => expect(container.querySelector("#kc-form-login")).not.toBeNull());
        };
        const expectFreshForm = () => {
            expect(page.getByLabelText(/^Email/)).toHaveAttribute("name", "email");
            expect(page.queryByText(/we've sent it a link/i)).toBeNull();
            expect(page.queryByRole("alert")).toBeNull();
        };

        // A half-typed address is not carried over.
        fireEvent.change(page.getByLabelText(/^Email/), { target: { value: "asha@" } });
        await openForgot();
        expect(page.getByLabelText(/^Email/)).toHaveValue("");
        await goBack();

        fireEvent.change(page.getByLabelText(/^Email/), { target: { value: "asha@example.org" } });
        await openForgot();
        expect(title.isConnected).toBe(true);
        expect(title).toHaveTextContent(/forgot password/i);
        // The address typed on the sign-in form carries over.
        expect(page.getByLabelText(/^Email/)).toHaveValue("asha@example.org");

        // A reply that lands after Go back must not show on the next visit.
        // Two submits before React re-renders send one request.
        const resetForm = container.querySelector<HTMLFormElement>("#kc-reset-password-form")!;
        act(() => {
            resetForm.requestSubmit();
            resetForm.requestSubmit();
        });
        await waitFor(() => expect(answerReset).toBeDefined());
        expect(resetRequests).toBe(1);
        await goBack();
        expect(title.isConnected).toBe(true);
        answerReset!(new Response(null, { status: 202 }));
        await new Promise(resolve => setTimeout(resolve, 0));
        await openForgot();
        expectFreshForm();

        // A failed request raises the toast; Go back and reopening clears it.
        fireEvent.click(page.getByRole("button", { name: /continue/i }));
        await waitFor(() => expect(page.getByRole("alert")).toHaveTextContent(/could not send the link/i));
        await goBack();
        await openForgot();
        expectFreshForm();
        expect(title.isConnected).toBe(true);
    });

    it("does not raise the last sign-in error again after Go back", async () => {
        vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
        const kcContext = getKcContextMock({
            pageId: "login.ftl",
            overrides: { messagesPerField: { existsError: (...fields: string[]) => fields.includes("username") } }
        });
        const { container } = render(<EmployeeKcPage kcContext={kcContext as never} />);
        const page = within(container);
        await waitFor(() => expect(page.getByRole("alert")).toHaveTextContent(/invalid/i));
        fireEvent.click(container.querySelector("#kc-forgot-password")!);
        await waitFor(() => expect(container.querySelector("#kc-reset-password-form")).not.toBeNull());
        fireEvent.click(page.getByRole("button", { name: /go back/i }));
        await waitFor(() => expect(container.querySelector("#kc-form-login")).not.toBeNull());
        expect(page.queryByRole("alert")).toBeNull();
    });
});

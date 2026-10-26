import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    it("opens the email form in the page's one Template, so keycloakify does not reload the page", async () => {
        vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
        const { container } = render(<EmployeeKcPage kcContext={getKcContextMock({ pageId: "login.ftl" }) as never} />);
        await waitFor(() => expect(container.querySelector("#kc-forgot-password")).not.toBeNull());
        // A second Template mount makes keycloakify call location.reload() in a real browser.
        const title = container.querySelector("#kc-page-title")!;

        fireEvent.click(container.querySelector("#kc-forgot-password")!);

        await waitFor(() => expect(container.querySelector("#kc-reset-password-form")).not.toBeNull());
        expect(title.isConnected).toBe(true);
        expect(title).toHaveTextContent(/forgot password/i);

        fireEvent.click(within(container).getByRole("button", { name: /go back/i }));
        await waitFor(() => expect(container.querySelector("#kc-form-login")).not.toBeNull());
        expect(title.isConnected).toBe(true);
    });
});

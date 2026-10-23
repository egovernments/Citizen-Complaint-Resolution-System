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

        fireEvent.change(field, { target: { value: "asha@example.org" } });
        expect(screen.queryByRole("note")).toBeNull();
    });
});

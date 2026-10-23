import { describe, expect, it } from "vitest";
import { employeeReturnTo, employeeSignInUrl, requestPasswordSetup } from "../src/digit/shared/passwordHelp";

function capture() {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
}

describe("requestPasswordSetup", () => {
    it("asks for the employee surface's email and returns to the tenant's employee app (item 5)", async () => {
        const { calls, fetchImpl } = capture();
        const ok = await requestPasswordSetup({
            baseUrl: "https://digit.example.org/",
            email: " asha@example.org ",
            returnTo: employeeReturnTo("pg"),
            surface: "employee",
            tenantSlug: "pg",
            fetchImpl
        });
        expect(ok).toBe(true);
        expect(calls).toEqual([{
            url: "https://digit.example.org/identity/v1/password/setup-requests",
            body: { email: "asha@example.org", returnTo: "/pg/digit-ui/employee/", surface: "employee", tenantSlug: "pg" }
        }]);
    });

    it("sends no surface without a tenant, so the BFF uses its default", async () => {
        const { calls, fetchImpl } = capture();
        await requestPasswordSetup({ email: "asha@example.org", surface: "employee", fetchImpl });
        expect(calls[0]!.body).toEqual({ email: "asha@example.org" });
    });
});

describe("employeeSignInUrl", () => {
    it("puts the tenant's sign-in on the client base URL's origin, not Keycloak's", () => {
        // local-setup: Keycloak on :18180, digit-ui (the client baseUrl) on :80.
        expect(employeeSignInUrl("testj01", "http://localhost/digit-ui/employee/user/login"))
            .toBe("http://localhost/testj01/digit-ui/employee/user/login");
    });

    it("gives nothing without a usable base URL (a path would land on Keycloak's origin) or a tenant", () => {
        expect(employeeSignInUrl("testj01", undefined)).toBeUndefined();
        expect(employeeSignInUrl("testj01", "/digit-ui/employee/user/login")).toBeUndefined();
        expect(employeeSignInUrl(undefined, "https://digit.example.org/")).toBeUndefined();
    });
});

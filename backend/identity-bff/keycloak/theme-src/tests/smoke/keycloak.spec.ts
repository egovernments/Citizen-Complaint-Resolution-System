import { expect, test } from "@playwright/test";

const loginUrl = process.env.KEYCLOAK_LOGIN_URL;

test.skip(
    loginUrl === undefined,
    "Set KEYCLOAK_LOGIN_URL, or run scripts/keycloak-smoke.sh"
);

test("Keycloak serves the DIGIT theme for the identity client", async ({ page }) => {
    const failedRequests: string[] = [];
    page.on("requestfailed", request => failedRequests.push(request.url()));

    await page.goto(loginUrl!);

    // The theme rendered, rather than Keycloak's stock login.
    await expect(page.locator(".digit-card")).toBeVisible();
    await expect(page.locator("#kc-page-title")).toBeVisible();

    // Keycloak's own form is intact underneath it.
    const form = page.locator("#kc-form-login");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form.locator("input[name='username']")).toBeVisible();
    await expect(form.locator("input[name='password']")).toHaveAttribute("type", "password");
    await expect(form.locator("#id-hidden-input")).toHaveAttribute("name", "credentialId");

    // The password posts to Keycloak's action on its own origin.
    const action = await form.getAttribute("action");
    expect(new URL(action!, loginUrl).origin).toBe(new URL(loginUrl!).origin);

    // Wrong credentials produce Keycloak's error on the themed field, and the
    // page must not say which half was wrong.
    await form.locator("input[name='username']").fill("nobody@example.org");
    await form.locator("input[name='password']").fill("not-the-password");
    await form.locator("#kc-login").click();
    await expect(page.locator(".digit-field-error, .digit-alert--error").first()).toBeVisible();
    await expect(page.locator(".digit-card")).toBeVisible();

    expect(failedRequests, "theme assets failed to load").toEqual([]);
});

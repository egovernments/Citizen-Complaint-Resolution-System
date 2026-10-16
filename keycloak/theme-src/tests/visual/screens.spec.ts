import { expect, test } from "@playwright/test";

/**
 * One screenshot per screen reachable from the supported password journey, at
 * desktop and at phone width. The left brand panel is hidden below `lg`, so the
 * mobile baselines are what prove the card still works on its own.
 */
const SCREENS: { name: string; page: string; state?: string }[] = [
    { name: "login", page: "login.ftl" },
    { name: "login-invalid-credentials", page: "login.ftl", state: "invalid-credentials" },
    { name: "login-username", page: "login-username.ftl" },
    { name: "login-password", page: "login-password.ftl" },
    { name: "login-reset-password", page: "login-reset-password.ftl" },
    { name: "login-update-password", page: "login-update-password.ftl" },
    {
        name: "login-update-password-mismatch",
        page: "login-update-password.ftl",
        state: "password-mismatch"
    },
    { name: "login-verify-email", page: "login-verify-email.ftl" },
    { name: "login-idp-link-confirm", page: "login-idp-link-confirm.ftl" },
    { name: "login-idp-link-email", page: "login-idp-link-email.ftl" },
    { name: "login-page-expired", page: "login-page-expired.ftl" },
    { name: "info", page: "info.ftl" },
    { name: "error", page: "error.ftl" }
];

for (const screen of SCREENS) {
    test(screen.name, async ({ page }) => {
        const state = screen.state === undefined ? "" : `&state=${screen.state}`;
        await page.goto(`/dev.html?page=${screen.page}${state}`);
        await page.waitForSelector(".digit-card");
        // The photograph is the last thing to land and it drives the panel's
        // tone, so wait for it before comparing.
        await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all(
                Array.from(document.images)
                    .filter(image => !image.complete)
                    .map(
                        image =>
                            new Promise(resolve => {
                                image.addEventListener("load", resolve, { once: true });
                                image.addEventListener("error", resolve, { once: true });
                            })
                    )
            );
        });
        await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: true });
    });
}

import { expect, test, type Page } from "@playwright/test";

/**
 * digit-employee and digit-citizen, one screenshot per screen and state, at
 * 1440×900 and on a Pixel 7. Branding comes from the dev server's fixture
 * endpoint (tests/digit/fixtures/branding-bomet.json: Bomet County's real
 * ThemeConfig v3 and login strings, a placeholder crest).
 *
 * The page clock is installed before load so the OTP countdown and the
 * carousel stay put; the page is compared once fonts and images are in.
 */
type Screen = { name: string; theme: "digit-employee" | "digit-citizen"; page: string; state?: string; tenant?: string; action?: (page: Page) => Promise<void> };

const SCREENS: Screen[] = [
    { name: "digit-employee-login", theme: "digit-employee", page: "login.ftl" },
    { name: "digit-employee-login-invalid-credentials", theme: "digit-employee", page: "login.ftl", state: "invalid-credentials" },
    {
        name: "digit-employee-login-privacy-policy",
        theme: "digit-employee",
        page: "login.ftl",
        action: async page => {
            await page.click("#user-login-privacy-policy");
            await page.waitForSelector("[role=dialog]");
        }
    },
    {
        name: "digit-employee-login-ready",
        theme: "digit-employee",
        page: "login.ftl",
        action: async page => {
            await page.fill("#username", "KE_GRO");
            await page.fill("#password", "not-a-real-password");
            await page.check("#privacy-component-check", { force: true });
            await page.mouse.move(0, 0);
        }
    },
    { name: "digit-employee-login-default-branding", theme: "digit-employee", page: "login.ftl", tenant: "none" },
    { name: "digit-employee-login-carousel", theme: "digit-employee", page: "login.ftl", tenant: "bomet-carousel" },
    { name: "digit-employee-reset-password", theme: "digit-employee", page: "login-reset-password.ftl" },
    { name: "digit-employee-update-password", theme: "digit-employee", page: "login-update-password.ftl" },
    { name: "digit-employee-page-expired", theme: "digit-employee", page: "login-page-expired.ftl" },
    { name: "digit-employee-info", theme: "digit-employee", page: "info.ftl" },
    { name: "digit-employee-error", theme: "digit-employee", page: "error.ftl" },
    { name: "digit-citizen-phone", theme: "digit-citizen", page: "login-phone-number.ftl" },
    { name: "digit-citizen-phone-invalid", theme: "digit-citizen", page: "login-phone-number.ftl", state: "invalid-phone" },
    { name: "digit-citizen-phone-default-branding", theme: "digit-citizen", page: "login-phone-number.ftl", tenant: "none" },
    { name: "digit-citizen-otp", theme: "digit-citizen", page: "login-sms-otp.ftl" },
    { name: "digit-citizen-otp-invalid", theme: "digit-citizen", page: "login-sms-otp.ftl", state: "invalid-otp" },
    { name: "digit-citizen-otp-resend", theme: "digit-citizen", page: "login-sms-otp.ftl", state: "resend-ready" },
    { name: "digit-citizen-otp-sms-failed", theme: "digit-citizen", page: "login-sms-otp.ftl", state: "sms-failed" },
    { name: "digit-citizen-profile", theme: "digit-citizen", page: "login-phone-profile.ftl" },
    { name: "digit-citizen-page-expired", theme: "digit-citizen", page: "login-page-expired.ftl" },
    { name: "digit-citizen-info", theme: "digit-citizen", page: "info.ftl" },
    { name: "digit-citizen-error", theme: "digit-citizen", page: "error.ftl" }
];

for (const screen of SCREENS) {
    test(screen.name, async ({ page }) => {
        await page.clock.install({ time: new Date("2026-09-28T09:00:00Z") });
        const query = new URLSearchParams({ theme: screen.theme, page: screen.page });
        if (screen.state) query.set("state", screen.state);
        if (screen.tenant) query.set("tenant", screen.tenant);
        await page.goto(`/dev.html?${query}`);
        await page.waitForSelector(".dg-root");
        await page.waitForLoadState("networkidle");
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
        if (screen.action) await screen.action(page);
        await expect(page).toHaveScreenshot(`${screen.name}.png`, { fullPage: true });
    });
}

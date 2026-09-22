import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-level smoke test against a real Keycloak running the built theme.
 *
 * Driven by `scripts/keycloak-smoke.sh`, which builds the image, seeds a realm
 * and a client with `login_theme=digit`, and passes the authorization URL in
 * `KEYCLOAK_LOGIN_URL`. There are no screenshots here — this asserts that the
 * theme is selected, loads, and renders Keycloak's real form.
 */
export default defineConfig({
    testDir: "tests/smoke",
    reporter: "line",
    use: { ...devices["Desktop Chrome"] }
});

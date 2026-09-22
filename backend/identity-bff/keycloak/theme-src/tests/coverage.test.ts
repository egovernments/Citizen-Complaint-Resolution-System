// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The screens reachable from the supported password journey, from #2108's
 * scope list. A new one must be themed deliberately rather than quietly
 * inheriting `DefaultPage`, so this asserts the switch in KcPage still names
 * each of them.
 */
const REQUIRED_PAGES = [
    "login.ftl",
    "login-username.ftl",
    "login-password.ftl",
    "login-reset-password.ftl",
    "login-update-password.ftl",
    "login-verify-email.ftl",
    "login-idp-link-confirm.ftl",
    "login-idp-link-confirm-override.ftl",
    "login-idp-link-email.ftl",
    "login-page-expired.ftl",
    "info.ftl",
    "error.ftl"
];

describe("page coverage", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/login/KcPage.tsx"), "utf8");

    it.each(REQUIRED_PAGES)("%s has an explicit override", pageId => {
        expect(source).toContain(`case "${pageId}":`);
    });

    it("still falls back to a themed DefaultPage for anything else", () => {
        expect(source).toContain("<DefaultPage");
        expect(source).toContain("doUseDefaultCss: false");
    });
});

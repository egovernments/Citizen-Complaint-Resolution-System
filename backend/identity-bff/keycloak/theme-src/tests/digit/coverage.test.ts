// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The screens each digit flow can reach. A new one must be themed on purpose
 * rather than silently inheriting DefaultPage, so assert each switch names it.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "../../src/digit", path), "utf8");

const REQUIRED = {
    "employee/EmployeeKcPage.tsx": [
        "login.ftl",
        "login-reset-password.ftl",
        "login-update-password.ftl",
        "login-page-expired.ftl",
        "info.ftl",
        "error.ftl"
    ],
    "citizen/CitizenKcPage.tsx": [
        "login-phone-number.ftl",
        "login-sms-otp.ftl",
        "login-phone-profile.ftl",
        "login-page-expired.ftl",
        "info.ftl",
        "error.ftl"
    ]
};

describe.each(Object.entries(REQUIRED))("%s", (file, pages) => {
    const source = read(file);
    it.each(pages)("%s has an explicit override", pageId => {
        expect(source).toContain(`case "${pageId}":`);
    });
    it("falls back to a themed DefaultPage", () => {
        expect(source).toContain("<DefaultPage");
        expect(source).toContain("doUseDefaultCss: false");
    });
});

describe("the custom FreeMarker pages are declared for Keycloakify", () => {
    it("KcContext.ts names all three, so the build emits their .ftl files", () => {
        const source = readFileSync(join(here, "../../src/login/KcContext.ts"), "utf8");
        for (const pageId of ["login-phone-number.ftl", "login-sms-otp.ftl", "login-phone-profile.ftl"]) {
            expect(source).toContain(`"${pageId}":`);
        }
    });
});

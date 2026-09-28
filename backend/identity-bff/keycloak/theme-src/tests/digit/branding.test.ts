import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/branding-bomet.json";
import {
    brandingUrl,
    digitLocaleOf,
    fetchBranding,
    normalizeBranding,
    resolveTenantSlug,
    tabIdOf
} from "../../src/digit/branding/branding";
import { LOGIN_MESSAGE_KEYS, getTransformedLocale, makeTranslator, tenantLabelKey } from "../../src/digit/branding/strings";
import { buildMobileErrorMessage, computeMobileLengths } from "../../src/digit/shared/mobileValidation";
import { pickPrivacyPolicy, privacyMessageKeys } from "../../src/digit/components/Privacy";

const ACTION = "/auth/realms/digit/login-actions/authenticate?session_code=a&execution=b&client_id=c&tab_id=TAB1";

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("tenant slug", () => {
    it("prefers the SPI's digitTenant and remembers it for the tab", () => {
        expect(resolveTenantSlug({ digitTenant: "bomet", loginAction: ACTION, search: "?digit_tenant=other" })).toBe(
            "bomet"
        );
        expect(resolveTenantSlug({ loginAction: ACTION, search: "" })).toBe("bomet");
    });

    it("falls back to digit_tenant on the authorization URL, then to the tab's stored slug", () => {
        expect(resolveTenantSlug({ loginAction: ACTION, search: "?client_id=x&digit_tenant=nairobi" })).toBe("nairobi");
        // The page after the first form post has no query parameter any more.
        expect(resolveTenantSlug({ loginAction: ACTION, search: "?execution=x" })).toBe("nairobi");
        // Another tab does not see it.
        expect(resolveTenantSlug({ loginAction: ACTION.replace("TAB1", "TAB2"), search: "" })).toBeUndefined();
    });

    it("ignores slugs that fail the contract's pattern", () => {
        expect(resolveTenantSlug({ digitTenant: "../evil", loginAction: ACTION, search: "?digit_tenant=A%20B" })).toBe(
            undefined
        );
        expect(resolveTenantSlug({ digitTenant: "x", loginAction: ACTION, search: "" })).toBeUndefined();
    });

    it("reads tab_id from Keycloak's form action", () => {
        expect(tabIdOf(ACTION)).toBe("TAB1");
        expect(tabIdOf(undefined)).toBeUndefined();
    });
});

describe("branding request", () => {
    it("targets the BFF's public endpoint, with a DIGIT locale only when not English", () => {
        expect(brandingUrl({ slug: "bomet" })).toBe("/identity/v1/tenant-contexts/bomet/branding");
        expect(brandingUrl({ baseUrl: "https://x.org/", slug: "bomet", locale: "fr_FR" })).toBe(
            "https://x.org/identity/v1/tenant-contexts/bomet/branding?locale=fr_FR"
        );
        expect(digitLocaleOf("en")).toBeUndefined();
        expect(digitLocaleOf("fr")).toBe("fr_FR");
        expect(digitLocaleOf("pt-BR")).toBe("pt_BR");
        expect(digitLocaleOf(undefined)).toBeUndefined();
    });

    it("fetches, normalizes and caches the document for the session", async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
        const first = await fetchBranding({ slug: "bomet", fetchImpl: fetchImpl as never });
        const second = await fetchBranding({ slug: "bomet", fetchImpl: fetchImpl as never });
        expect(first?.tenant.name).toBe("Bomet County");
        expect(second?.stateInfo.code).toBe("ke");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("returns undefined on a 404, a network error or a non-object body", async () => {
        expect(await fetchBranding({ slug: "nope", fetchImpl: (async () => new Response("", { status: 404 })) as never })).toBe(
            undefined
        );
        expect(
            await fetchBranding({
                slug: "down",
                fetchImpl: (async () => {
                    throw new TypeError("offline");
                }) as never
            })
        ).toBeUndefined();
        expect(normalizeBranding("nope")).toBeUndefined();
    });

    it("drops fields of the wrong type instead of trusting them", () => {
        const branding = normalizeBranding({
            tenant: { name: 42 },
            stateInfo: { logoUrl: ["x"], languages: [{ label: "English", value: "en_IN" }, "bad"] },
            mobileValidation: { countryCode: "+254" },
            messages: { A: "a", B: 3 }
        })!;
        expect(branding.tenant.name).toBe("");
        expect(branding.stateInfo.logoUrl).toBeUndefined();
        expect(branding.stateInfo.languages).toEqual([{ label: "English", value: "en_IN" }]);
        expect(branding.mobileValidation).toBeNull();
        expect(branding.messages).toEqual({ A: "a" });
    });
});

describe("login strings", () => {
    it("uses the tenant's text, else digit-ui's English fallback, and treats key-echoes as missing", () => {
        const t = makeTranslator({ CORE_COMMON_LOGIN: "Ingia", CS_COMMONS_NEXT: "CS_COMMONS_NEXT" });
        expect(t.t("CORE_COMMON_LOGIN")).toBe("Ingia");
        expect(t.t("CS_COMMONS_NEXT")).toBe("Continue");
        expect(t.t("CS_LOGIN_PROVIDE_MOBILE_NUMBER")).toBe("Sign in");
        expect(t.has("CS_COMMONS_NEXT")).toBe(false);
    });

    it("builds the tenant label key the way Digit.Utils.locale does", () => {
        expect(getTransformedLocale("TENANT_TENANTS_ke.bomet")).toBe("TENANT_TENANTS_KE_BOMET");
        expect(tenantLabelKey("ke")).toBe("TENANT_TENANTS_KE");
    });

    it("the fixture localizes every login key Bomet has", () => {
        const missing = LOGIN_MESSAGE_KEYS.filter(key => !(key in fixture.messages));
        expect(missing).toEqual(["CORE_COMMON_GO_BACK", "OTP_RESEND_ERROR"]);
    });
});

describe("mobile rule", () => {
    it("derives lengths and the always-visible hint like digit-ui", () => {
        expect(computeMobileLengths("^[6-9][0-9]{9}$")).toEqual({ min: 10, max: 10 });
        expect(computeMobileLengths("^0?[17][0-9]{8}$")).toEqual({ min: 9, max: 10 });
        expect(computeMobileLengths("^(0?[17][0-9]{8}|[6-9][0-9]{9})$")).toEqual({ min: 9, max: 10 });
        expect(buildMobileErrorMessage("^[6-9][0-9]{9}$")).toBe(
            "Please enter a valid mobile number (10 digits, starting with 6, 7, 8, 9)"
        );
        expect(buildMobileErrorMessage("^0?[17][0-9]{8}$")).toBe(
            "Please enter a valid mobile number (9-10 digits, starting with 1, 7)"
        );
        // Bomet's alternation has no single starting class: length only.
        expect(buildMobileErrorMessage("^(0?[17][0-9]{8}|[6-9][0-9]{9})$")).toBe(
            "Please enter a valid mobile number (9-10 digits)"
        );
    });
});

describe("privacy policy", () => {
    it("picks the HCM policy from a list and lists the keys it needs localized", () => {
        const policy = pickPrivacyPolicy([{ module: "Sandbox", contents: [] }, fixture.privacyPolicy]);
        expect(policy?.module).toBe("HCM");
        expect(privacyMessageKeys(policy)).toContain("DIGIT_PRIVACY_POLICY_USE_2");
        expect(pickPrivacyPolicy(null)).toBeUndefined();
        expect(pickPrivacyPolicy([{ module: "Sandbox" }, { module: "Other" }])).toBeUndefined();
    });
});

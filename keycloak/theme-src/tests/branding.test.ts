import { beforeEach, describe, expect, it, vi } from "vitest";
import { digitLocaleOf, fetchBranding, resolveTenantSlug } from "../src/digit/branding/branding";

const tenant = { tenantId: "bomet", urlSlug: "bomet-county", name: "Bomet County" };
const masters = { MdmsRes: {
    "common-masters": {
        StateInfo: [{ code: "bomet", name: "Bomet", logoUrl: "/logo.png", languages: [{ label: "ENGLISH", value: "en_IN" }] }],
        ThemeConfig: [{ isActive: false, colors: { primary: "red" } }, { colors: { primary: "#c84c0e" } }]
    },
    commonMDMSConfig: {
        LoginConfig: [{ texts: { header: "LOGIN_TITLE" }, bannerImages: [{ title: "BANNER_TITLE" }] }],
        PrivacyPolicy: [{ header: "PRIVACY_TITLE", contents: [{ header: "PRIVACY_SECTION" }] }]
    }
} };
const translations = { messages: [
    { code: "CORE_COMMON_LOGIN", message: "Login" }, { code: "LOGIN_TITLE", message: "Welcome" },
    { code: "BANNER_TITLE", message: "Report it" }, { code: "PRIVACY_TITLE", message: "Privacy" },
    { code: "TENANT_TENANTS_BOMET", message: "Bomet County Government" },
    { code: "UNRELATED_MESSAGE", message: "Must not reach the theme" }, { code: "LOGIN_TITLE", message: 42 }
] };
function fixture(localized = translations) {
    return vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify({ tenant })))
        .mockResolvedValueOnce(new Response(JSON.stringify(masters)))
        .mockResolvedValueOnce(new Response(JSON.stringify(localized)));
}

beforeEach(() => sessionStorage.clear());

describe("public MDMS branding (replacement for the BFF relay)", () => {
    it("resolves only the tenant through the BFF, then reads public masters and localization without credentials", async () => {
        const fetchImpl = fixture();
        const result = await fetchBranding({ slug: tenant.urlSlug, fetchImpl });
        expect(result).toMatchObject({ tenant, stateInfo: { logoUrl: "/logo.png", defaultLocale: "en_IN" },
            themeConfig: { colors: { primary: "#c84c0e" } },
            loginConfig: masters.MdmsRes.commonMDMSConfig.LoginConfig[0],
            privacyPolicy: masters.MdmsRes.commonMDMSConfig.PrivacyPolicy,
            messages: { CORE_COMMON_LOGIN: "Login", LOGIN_TITLE: "Welcome", BANNER_TITLE: "Report it",
                PRIVACY_TITLE: "Privacy", TENANT_TENANTS_BOMET: "Bomet County Government" } });
        expect(result?.messages).not.toHaveProperty("UNRELATED_MESSAGE");
        const calls = fetchImpl.mock.calls;
        expect(calls[0][0]).toBe("/identity/v1/tenant-contexts/bomet-county");
        expect(calls[1][0]).toBe("/mdms-v2/v1/_search?tenantId=bomet");
        expect(JSON.parse(calls[1][1]?.body as string)).toMatchObject({ MdmsCriteria: { tenantId: "bomet", moduleDetails: [
            { moduleName: "common-masters", masterDetails: [{ name: "StateInfo" }, { name: "ThemeConfig" }] },
            { moduleName: "commonMDMSConfig", masterDetails: [{ name: "LoginConfig" }, { name: "PrivacyPolicy" }] }
        ] } });
        expect(calls[2][0]).toContain("/localization/messages/v1/_search?tenantId=bomet&locale=en_IN");
        for (const [url, init] of calls) {
            expect(url).not.toContain("/branding");
            expect(init?.credentials).toBe("omit");
            expect(init?.headers).not.toHaveProperty("Authorization");
        }
    });

    it("caches complete results and partitions the cache by locale", async () => {
        const fetchImpl = fixture();
        const first = await fetchBranding({ slug: tenant.urlSlug, fetchImpl });
        expect(await fetchBranding({ slug: tenant.urlSlug, fetchImpl })).toEqual(first);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        const french = fixture({ messages: [{ code: "CORE_COMMON_LOGIN", message: "Connexion" }] });
        expect((await fetchBranding({ slug: tenant.urlSlug, locale: "fr_FR", fetchImpl: french }))?.messages)
            .toEqual({ CORE_COMMON_LOGIN: "Connexion" });
        expect(french.mock.calls[2][0]).toContain("locale=fr_FR");
    });

    it("expires the cached tenant name and branding after ten minutes", async () => {
        const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
        try {
            await fetchBranding({ slug: tenant.urlSlug, fetchImpl: fixture() });
            clock.mockReturnValue(601001);
            const fetchImpl = fixture();
            await fetchBranding({ slug: tenant.urlSlug, fetchImpl });
            expect(fetchImpl).toHaveBeenCalledTimes(3);
        } finally { clock.mockRestore(); }
    });

    it("uses deployment public URLs, locale and footer overrides", async () => {
        const fetchImpl = fixture();
        const result = await fetchBranding({ slug: tenant.urlSlug, fetchImpl, baseUrl: "https://bff.example/",
            publicApiBaseUrl: "https://digit.example/", mdmsPath: "/egov-mdms-service/v1/_search",
            defaultLocale: "sw_KE", footer: { digitFooter: "", digitFooterBw: "", digitHomeUrl: "https://tenant.example" } });
        expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/bff.example\/identity\//);
        expect(fetchImpl.mock.calls[1][0]).toMatch(/^https:\/\/digit.example\/egov-mdms-service\//);
        expect(fetchImpl.mock.calls[2][0]).toContain("locale=sw_KE");
        expect(result?.footer.digitFooter).toBeUndefined();
        expect(result?.footer.digitHomeUrl).toBe("https://tenant.example");
    });

    it("uses a configured LoginConfig module", async () => {
        const fetchImpl = fixture();
        await fetchBranding({ slug: tenant.urlSlug, configModule: "customUI", fetchImpl });
        expect(JSON.parse(fetchImpl.mock.calls[1][1]?.body as string).MdmsCriteria.moduleDetails[1].moduleName).toBe("customUI");
    });

    it.each([404, 503])("falls back on a %s tenant resolution failure", async status => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status }));
        expect(await fetchBranding({ slug: tenant.urlSlug, fetchImpl })).toBeUndefined();
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("falls back on malformed public masters", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ tenant })))
            .mockResolvedValueOnce(new Response("{}"));
        expect(await fetchBranding({ slug: tenant.urlSlug, fetchImpl })).toBeUndefined();
    });

    it("keeps tenant assets during a localization outage and retries instead of caching the failure", async () => {
        const fetchImpl = fixture();
        fetchImpl.mockReset().mockResolvedValueOnce(new Response(JSON.stringify({ tenant })))
            .mockResolvedValueOnce(new Response(JSON.stringify(masters))).mockRejectedValueOnce(new Error("offline"));
        const result = await fetchBranding({ slug: tenant.urlSlug, fetchImpl });
        expect(result?.stateInfo.logoUrl).toBe("/logo.png");
        expect(result?.messages).toEqual({});
        const retry = fixture();
        expect((await fetchBranding({ slug: tenant.urlSlug, fetchImpl: retry }))?.messages.CORE_COMMON_LOGIN).toBe("Login");
        expect(retry).toHaveBeenCalledTimes(3);
    });

    it("aborts stalled public reads and lets the page use its default look", async () => {
        const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("timeout")));
        }));
        expect(await fetchBranding({ slug: tenant.urlSlug, timeoutMs: 1, fetchImpl })).toBeUndefined();
    });

    it("rejects invalid slugs without making a request", async () => {
        const fetchImpl = fixture();
        expect(await fetchBranding({ slug: "../other", fetchImpl })).toBeUndefined();
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("keeps display-only tenant slugs isolated by login tab", () => {
        expect(resolveTenantSlug({ search: "?digit_tenant=bomet-county", loginAction: "/login?tab_id=a" })).toBe("bomet-county");
        expect(resolveTenantSlug({ search: "", loginAction: "/login?tab_id=a" })).toBe("bomet-county");
        expect(resolveTenantSlug({ search: "", loginAction: "/login?tab_id=b" })).toBeUndefined();
    });

    it("maps language tags and degrades unsupported tags to the deployment default", () => {
        expect(digitLocaleOf("fr-FR")).toBe("fr_FR");
        expect(digitLocaleOf("en")).toBeUndefined();
        expect(digitLocaleOf("invalid!")).toBeUndefined();
    });
});

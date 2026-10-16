/** Public tenant branding, fetched by the theme directly from DIGIT. */
import { dynamicMessageKeys, requestedBrandingLocale } from "./messages";
import { LOGIN_MESSAGE_KEYS } from "./strings";

export type BrandingLanguage = { label: string; value: string };

export type Branding = {
    tenant: { urlSlug: string; tenantId: string; name: string };
    stateInfo: {
        code?: string;
        name?: string;
        logoUrl?: string;
        logoUrlWhite?: string;
        bannerUrl?: string;
        languages?: BrandingLanguage[];
        defaultLocale?: string;
    };
    /** Raw `common-masters.ThemeConfig[0]`, applied with the applyTheme port. */
    themeConfig: unknown;
    /** Raw `{UICONFIG_MODULENAME}.LoginConfig[0]`. */
    loginConfig: unknown;
    /** Raw PrivacyPolicy (a record, or the list digit-ui filters by module). */
    privacyPolicy: unknown;
    footer: { digitFooter?: string; digitFooterBw?: string; digitHomeUrl?: string };
    messages: Record<string, string>;
};

const SLUG_PATTERN = /^[a-z0-9-]{2,63}$/;
const STORAGE_PREFIX = "digit_tenant:";
const CACHE_PREFIX = "digit_branding:";
const CACHE_TTL_MS = 10 * 60 * 1000;

export function isValidSlug(value: unknown): value is string {
    return typeof value === "string" && SLUG_PATTERN.test(value);
}

function safeSession(): Storage | undefined {
    try {
        return window.sessionStorage;
    } catch {
        return undefined;
    }
}

/** Keycloak's `tab_id` for this login tab, read from the form action. */
export function tabIdOf(loginAction: string | undefined, base = window.location.href): string | undefined {
    if (!loginAction) return undefined;
    try {
        return new URL(loginAction, base).searchParams.get("tab_id") ?? undefined;
    } catch {
        return undefined;
    }
}

/**
 * Which tenant these screens are for.
 *
 * 1. `digitTenant`, when a Keycloak login-forms provider puts it on the page
 *    (none is installed; the DIGIT SPI was removed with SMS OTP, #2189).
 * 2. `digit_tenant` on the current URL — present on the first page, which
 *    Keycloak renders straight off the authorization request — remembered in
 *    sessionStorage under this tab's `tab_id` so the pages that follow a
 *    form post (errors, further steps) still know it.
 */
export function resolveTenantSlug(params: {
    digitTenant?: string;
    loginAction?: string;
    search?: string;
}): string | undefined {
    const storage = safeSession();
    const tabId = tabIdOf(params.loginAction);
    const remember = (slug: string) => {
        if (tabId === undefined || storage === undefined) return;
        try {
            storage.setItem(STORAGE_PREFIX + tabId, slug);
        } catch {
            // Private mode or quota: later pages fall back to the default look.
        }
    };

    if (isValidSlug(params.digitTenant)) {
        remember(params.digitTenant);
        return params.digitTenant;
    }
    const fromQuery = new URLSearchParams(params.search ?? window.location.search).get("digit_tenant");
    if (isValidSlug(fromQuery)) {
        remember(fromQuery);
        return fromQuery;
    }
    if (tabId !== undefined && storage !== undefined) {
        try {
            const stored = storage.getItem(STORAGE_PREFIX + tabId);
            if (isValidSlug(stored)) return stored;
        } catch {
            return undefined;
        }
    }
    return undefined;
}

/** Bare English uses the configured deployment default locale. */
export function digitLocaleOf(languageTag: string | undefined): string | undefined {
    try {
        return !languageTag || languageTag === "en" ? undefined : requestedBrandingLocale(languageTag);
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Accept the contract's shape and nothing that could break rendering: every
 * field is optional downstream, and strings are checked to be strings.
 */
export function normalizeBranding(raw: unknown): Branding | undefined {
    if (!isRecord(raw)) return undefined;
    const tenant = isRecord(raw.tenant) ? raw.tenant : {};
    const stateInfo = isRecord(raw.stateInfo) ? raw.stateInfo : {};
    const footer = isRecord(raw.footer) ? raw.footer : {};
    const messages: Record<string, string> = {};
    if (isRecord(raw.messages)) {
        for (const [key, value] of Object.entries(raw.messages)) {
            if (typeof value === "string") messages[key] = value;
        }
    }
    const languages = Array.isArray(stateInfo.languages)
        ? stateInfo.languages.filter(
              (l): l is BrandingLanguage => isRecord(l) && typeof l.label === "string" && typeof l.value === "string"
          )
        : undefined;
    return {
        tenant: {
            urlSlug: asString(tenant.urlSlug) ?? "",
            tenantId: asString(tenant.tenantId) ?? "",
            name: asString(tenant.name) ?? ""
        },
        stateInfo: {
            code: asString(stateInfo.code),
            name: asString(stateInfo.name),
            logoUrl: asString(stateInfo.logoUrl),
            logoUrlWhite: asString(stateInfo.logoUrlWhite),
            bannerUrl: asString(stateInfo.bannerUrl),
            languages,
            defaultLocale: asString(stateInfo.defaultLocale)
        },
        themeConfig: raw.themeConfig ?? null,
        loginConfig: raw.loginConfig ?? null,
        privacyPolicy: raw.privacyPolicy ?? null,
        footer: {
            digitFooter: asString(footer.digitFooter),
            digitFooterBw: asString(footer.digitFooterBw),
            digitHomeUrl: asString(footer.digitHomeUrl)
        },
        messages
    };
}

function readCache(url: string): Branding | undefined {
    const storage = safeSession();
    if (storage === undefined) return undefined;
    try {
        const cached = storage.getItem(CACHE_PREFIX + url);
        if (cached === null) return undefined;
        const { at, branding } = JSON.parse(cached) as { at: number; branding: unknown };
        if (typeof at !== "number" || Date.now() - at > CACHE_TTL_MS) return undefined;
        return normalizeBranding(branding);
    } catch {
        return undefined;
    }
}

function writeCache(url: string, branding: Branding) {
    const storage = safeSession();
    if (storage === undefined) return;
    try {
        storage.setItem(CACHE_PREFIX + url, JSON.stringify({ at: Date.now(), branding }));
    } catch {
        // Not worth failing a login page over.
    }
}

export async function fetchBranding(params: {
    baseUrl?: string;
    publicApiBaseUrl?: string;
    mdmsPath?: string;
    configModule?: string;
    defaultLocale?: string;
    footer?: Branding["footer"];
    slug: string;
    locale?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}): Promise<Branding | undefined> {
    if (!isValidSlug(params.slug)) return undefined;
    const bffBase = (params.baseUrl ?? "").replace(/\/+$/, "");
    const apiBase = (params.publicApiBaseUrl ?? "").replace(/\/+$/, "");
    const mdmsPath = params.mdmsPath || "/mdms-v2/v1/_search";
    const moduleName = params.configModule || "commonMDMSConfig";
    const defaultLocale = params.defaultLocale || "en_IN";
    const locale = params.locale || defaultLocale;
    const cacheKey = JSON.stringify([bffBase, apiBase, mdmsPath, moduleName, params.slug, locale, params.footer]);
    const cached = readCache(cacheKey);
    if (cached !== undefined) return cached;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 6000);
    const request = async (url: string, body?: unknown): Promise<Record<string, unknown>> => {
        const response = await (params.fetchImpl ?? fetch)(url, {
            method: body === undefined ? "GET" : "POST",
            credentials: "omit",
            headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: controller.signal
        });
        if (!response.ok) throw new Error("Public branding unavailable");
        const result: unknown = await response.json();
        if (!isRecord(result)) throw new Error("Invalid public branding response");
        return result;
    };
    try {
        // Only slug resolution belongs to the BFF; no branding is relayed through it.
        const context = await request(`${bffBase}/identity/v1/tenant-contexts/${encodeURIComponent(params.slug)}`);
        const tenant = context.tenant;
        if (!isRecord(tenant) || !asString(tenant.tenantId)) return undefined;
        const tenantId = tenant.tenantId as string;
        const RequestInfo = { apiId: "digit-keycloak-theme" };
        const result = await request(`${apiBase}${mdmsPath}?tenantId=${encodeURIComponent(tenantId)}`, {
            RequestInfo,
            MdmsCriteria: { tenantId, moduleDetails: [
                { moduleName: "common-masters", masterDetails: [{ name: "StateInfo" }, { name: "ThemeConfig" }] },
                { moduleName, masterDetails: [{ name: "LoginConfig" }, { name: "PrivacyPolicy" }] }
            ] }
        });
        if (!isRecord(result.MdmsRes)) return undefined;
        const records = (module: string, master: string): Record<string, unknown>[] => {
            const values = (result.MdmsRes as Record<string, Record<string, unknown>>)[module]?.[master];
            return Array.isArray(values) ? values.filter(v => isRecord(v) && v.isActive !== false) : [];
        };
        const stateInfo = records("common-masters", "StateInfo")[0] ?? {};
        const masters = {
            stateInfo,
            themeConfig: records("common-masters", "ThemeConfig")[0] ?? null,
            loginConfig: records(moduleName, "LoginConfig")[0] ?? null,
            privacyPolicy: records(moduleName, "PrivacyPolicy")
        };
        const messages: Record<string, string> = {};
        let complete = true;
        try {
            const modules = ["rainmaker-common", "digit-ui", "digit-tenants", `rainmaker-${tenantId}`];
            const query = new URLSearchParams({ tenantId, locale, module: modules.join(",") });
            const localized = await request(`${apiBase}/localization/messages/v1/_search?${query}`, { RequestInfo });
            if (!Array.isArray(localized.messages)) throw new Error("Invalid localization response");
            const wanted = dynamicMessageKeys({ tenantId, rootTenantId: tenantId }, masters);
            for (const key of [...LOGIN_MESSAGE_KEYS, "CORE_COMMON_LANGUAGE", "CS_COMMON_CHOOSE_LANGUAGE"]) wanted.add(key);
            for (const entry of localized.messages) {
                if (isRecord(entry) && typeof entry.code === "string" && typeof entry.message === "string" && wanted.has(entry.code)) {
                    messages[entry.code] = entry.message;
                }
            }
        } catch {
            // Still show the tenant's assets, with built-in strings; retry next time.
            complete = false;
        }
        const languages = Array.isArray(stateInfo.languages) ? stateInfo.languages.filter(isRecord) : [];
        const branding = normalizeBranding({
            tenant: { ...tenant, urlSlug: params.slug },
            ...masters,
            stateInfo: { ...stateInfo, defaultLocale: !languages.length || languages.some(l => l.value === defaultLocale)
                ? defaultLocale : languages[0].value },
            footer: { digitFooter: `${apiBase}/digit-ui/brand/digit-footer.png`,
                digitFooterBw: `${apiBase}/digit-ui/brand/digit-footer-bw.png`, digitHomeUrl: "https://www.digit.org/", ...params.footer },
            messages
        });
        if (branding !== undefined && complete) writeCache(cacheKey, branding);
        return branding;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

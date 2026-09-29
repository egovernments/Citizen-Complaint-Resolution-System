/**
 * Tenant branding for the digit-employee / digit-citizen themes.
 *
 * Keycloak renders these screens for a tenant that only the BFF knows about:
 * the tenant comes from `/{slug}/digit-ui/{surface}/...` and the BFF passes the
 * slug to Keycloak as `digit_tenant` (display only; see resolveTenantSlug).
 * The theme then asks the BFF for that tenant's public branding (#2167
 * contract) — logo, ThemeConfig, login config, privacy policy and the login
 * strings — and paints the legacy digit-ui login with it.
 *
 * Nothing here is trusted for authorization. The slug only picks which
 * public branding document to show; a wrong or missing one degrades to the
 * default DIGIT look, never to a different tenant's session.
 */

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

/**
 * Keycloak language tag → the DIGIT locale the branding endpoint localizes to.
 * English is the BFF's default (en_IN), so it sends no parameter at all.
 */
const DEFAULT_REGION: Record<string, string> = { fr: "FR", pt: "PT", sw: "KE", hi: "IN", es: "ES" };

export function digitLocaleOf(languageTag: string | undefined): string | undefined {
    if (!languageTag) return undefined;
    const [language, region] = languageTag.split(/[-_]/);
    if (!language || language.toLowerCase() === "en") return undefined;
    const lang = language.toLowerCase();
    const reg = (region ?? DEFAULT_REGION[lang] ?? "IN").toUpperCase();
    return `${lang}_${reg}`;
}

export function brandingUrl(params: { baseUrl?: string; slug: string; locale?: string }): string {
    const base = (params.baseUrl ?? "").replace(/\/+$/, "");
    const query = params.locale ? `?locale=${encodeURIComponent(params.locale)}` : "";
    return `${base}/identity/v1/tenant-contexts/${encodeURIComponent(params.slug)}/branding${query}`;
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
    slug: string;
    locale?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}): Promise<Branding | undefined> {
    const url = brandingUrl(params);
    const cached = readCache(url);
    if (cached !== undefined) return cached;

    const controller = typeof AbortController === "undefined" ? undefined : new AbortController();
    const timer = setTimeout(() => controller?.abort(), params.timeoutMs ?? 6000);
    try {
        const response = await (params.fetchImpl ?? fetch)(url, {
            credentials: "omit",
            headers: { Accept: "application/json" },
            signal: controller?.signal
        });
        if (!response.ok) return undefined;
        const branding = normalizeBranding(await response.json());
        if (branding !== undefined) writeCache(url, branding);
        return branding;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
    }
}

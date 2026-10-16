import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import defaultTheme from "../theme/default.json";
import { applyTheme } from "../theme/applyTheme";
import { digitLocaleOf, fetchBranding, resolveTenantSlug, type Branding } from "./branding";
import { makeTranslator, type Translator } from "./strings";

export type BrandingState = {
    /** "loading" renders nothing, so a tenant's colours never flash in late. */
    status: "loading" | "ready" | "fallback";
    slug: string | undefined;
    branding: Branding | undefined;
    i18n: Translator;
};

const BrandingContext = createContext<BrandingState>({
    status: "fallback",
    slug: undefined,
    branding: undefined,
    i18n: makeTranslator(undefined)
});

export function useBranding(): BrandingState {
    return useContext(BrandingContext);
}

/**
 * Resolves the tenant, fetches its branding and applies its ThemeConfig the
 * way digit-ui's src/index.js does: the default theme first, the tenant's
 * record on top. If anything fails the page renders the default DIGIT look.
 *
 * `initial` lets tests and the dev server inject branding without a fetch.
 */
export function BrandingProvider(props: {
    digitTenant?: string;
    loginAction?: string;
    languageTag?: string;
    bffBaseUrl?: string;
    publicApiBaseUrl?: string;
    mdmsPath?: string;
    configModule?: string;
    defaultLocale?: string;
    footer?: Branding["footer"];
    initial?: Branding | null;
    children: ReactNode;
}) {
    const { digitTenant, loginAction, languageTag, bffBaseUrl, publicApiBaseUrl, mdmsPath, configModule, defaultLocale, footer, initial, children } = props;
    const slug = useMemo(
        () => resolveTenantSlug({ digitTenant, loginAction }),
        [digitTenant, loginAction]
    );
    const [branding, setBranding] = useState<Branding | undefined>(initial ?? undefined);
    const [status, setStatus] = useState<BrandingState["status"]>(() =>
        initial !== undefined ? (initial === null ? "fallback" : "ready") : slug === undefined ? "fallback" : "loading"
    );

    useEffect(() => {
        if (initial !== undefined || slug === undefined) return;
        let cancelled = false;
        fetchBranding({ baseUrl: bffBaseUrl, publicApiBaseUrl, mdmsPath, configModule, defaultLocale, footer, slug, locale: digitLocaleOf(languageTag) }).then(result => {
            if (cancelled) return;
            setBranding(result);
            setStatus(result === undefined ? "fallback" : "ready");
        });
        return () => {
            cancelled = true;
        };
    }, [slug, languageTag, bffBaseUrl, publicApiBaseUrl, mdmsPath, configModule, defaultLocale, footer, initial]);

    // Layout effect: the variables land before the first paint of the real
    // content (the provider withholds children while loading).
    useLayoutEffect(() => {
        if (typeof document === "undefined" || status === "loading") return;
        applyTheme(defaultTheme);
        if (branding?.themeConfig) applyTheme(branding.themeConfig);
    }, [status, branding]);

    const value = useMemo<BrandingState>(
        () => ({ status, slug, branding, i18n: makeTranslator(branding?.messages) }),
        [status, slug, branding]
    );

    return (
        <BrandingContext.Provider value={value}>{status === "loading" ? null : children}</BrandingContext.Provider>
    );
}

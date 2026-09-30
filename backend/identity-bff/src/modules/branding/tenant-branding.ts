import { config } from "../../infrastructure/config.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import type { PublicTenantRoute } from "../access-context/tenant-route.js";

/**
 * Every static i18n key the Keycloak `digit-employee` / `digit-citizen`
 * themes read from `messages` (#2167) — the keys of `LOGIN_MESSAGE_FALLBACKS`
 * in `keycloak/theme-src/src/digit/branding/strings.ts`. The theme owns the
 * list (it also carries each key's English fallback); the BFF image cannot
 * import it, so `tests/unit/login-message-keys.test.ts` fails on drift.
 * Tenant-specific keys are derived from the fetched records instead
 * (`dynamicMessageKeys`).
 */
export const LOGIN_MESSAGE_KEYS = [
  // Employee (pages/employee/Login/login.js, PrivacyComponent.js)
  "CORE_COMMON_LOGIN",
  "CORE_LOGIN_USERNAME",
  "CORE_LOGIN_PASSWORD",
  "CORE_COMMON_FORGOT_PASSWORD",
  "ES_BY_CLICKING",
  "ES_PRIVACY_POLICY",
  "INVALID_LOGIN_CREDENTIALS",
  "ES_ERROR_USER_NOT_PERMITTED",
  "CORE_COMMON_CONTINUE",
  "CORE_COMMON_CHANGE_PASSWORD",
  "CORE_LOGIN_NEW_PASSWORD",
  "CORE_LOGIN_CONFIRM_NEW_PASSWORD",
  "CORE_COMMON_GO_BACK",
  "CORE_LOGIN_EMAIL",
  "CORE_LOGIN_FORGOT_PASSWORD_TEXT",
  "CORE_LOGIN_RESET_LINK_SENT",
  "CORE_LOGIN_RESET_LINK_FAILED",
  // Shared chrome
  "CORE_COMMON_LANGUAGE",
  "CS_COMMON_CHOOSE_LANGUAGE",
] as const;

const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/;
/** Keycloak/BCP-47 tags as the themes and `ui_locales` send them: fr, fr-FR, pt_mz. */
const LANGUAGE_TAG = /^([a-zA-Z]{2,3})(?:[-_]([a-zA-Z]{2}))?$/;
/** Region DIGIT seeds for a bare language (matches the theme's `digitLocaleOf`). */
const DEFAULT_LOCALE_REGION: Record<string, string> = {
  en: "IN", fr: "FR", pt: "PT", sw: "KE", hi: "IN", es: "ES",
};
const MAX_KEY_LENGTH = 128;
const MAX_REFERENCED_KEYS = 200;
/** Locale is caller-chosen, so the per-(tenant, locale) cache is bounded. */
const MAX_BRANDING_CACHE_ENTRIES = 500;

export class BrandingRequestError extends Error {}

export interface MobileValidation {
  countryCode: string;
  mobileNumberRegex: string;
  errorMessage?: string;
}

export interface TenantBranding {
  tenant: { urlSlug: string; tenantId: string; name: string };
  stateInfo: {
    code: string | null;
    name: string | null;
    logoUrl: string | null;
    logoUrlWhite: string | null;
    bannerUrl: string | null;
    languages: Array<{ label: string; value: string }>;
    defaultLocale: string;
  };
  themeConfig: unknown;
  loginConfig: unknown;
  privacyPolicy: unknown;
  footer: { digitFooter: string; digitFooterBw: string; digitHomeUrl: string };
  messages: Record<string, string>;
}

type MdmsRes = Record<string, Record<string, unknown[]>>;

interface TenantMasters {
  stateInfo: Record<string, unknown> | null;
  themeConfig: unknown;
  mobileValidation: MobileValidation | null;
  loginConfig: unknown;
  privacyPolicy: unknown;
}

const mastersCache = new Map<string, { expiresAt: number; promise: Promise<TenantMasters> }>();
const brandingCache = new Map<string, { expiresAt: number; value: TenantBranding }>();

export function clearBrandingCaches(): void {
  mastersCache.clear();
  brandingCache.clear();
}

async function searchMdmsV1(tenantId: string): Promise<MdmsRes> {
  if (!config.digitMdmsSearchUrl) {
    throw new DigitUnavailableError("DIGIT MDMS search is not configured");
  }
  const url = new URL(config.digitMdmsSearchUrl);
  url.searchParams.set("tenantId", tenantId);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RequestInfo: { apiId: "digit-identity-bff" },
        MdmsCriteria: {
          tenantId,
          moduleDetails: [
            {
              moduleName: "common-masters",
              masterDetails: [
                { name: "StateInfo" }, { name: "ThemeConfig" }, { name: "MobileNumberValidation" },
              ],
            },
            {
              moduleName: config.digitUiConfigModuleName,
              masterDetails: [{ name: "LoginConfig" }, { name: "PrivacyPolicy" }],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(config.digitTimeoutMs),
    });
  } catch {
    throw new DigitUnavailableError("DIGIT branding lookup failed");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DigitUnavailableError(`DIGIT branding lookup returned ${response.status}`);
  }
  const body = await response.json().catch(() => null) as { MdmsRes?: MdmsRes } | null;
  if (!body) throw new DigitUnavailableError("DIGIT branding lookup returned invalid JSON");
  return body.MdmsRes || {};
}

function records(res: MdmsRes, moduleName: string, master: string): unknown[] {
  const values = res[moduleName]?.[master];
  return Array.isArray(values)
    ? values.filter((value) => (value as { isActive?: unknown })?.isActive !== false)
    : [];
}

/** Same selection as digit-ui citizen Login: the active default, else any active rule. */
export function pickMobileValidation(values: unknown[]): MobileValidation | null {
  const rules = values as Array<Record<string, unknown>>;
  const rule = rules.find((candidate) => candidate?.default === true) || rules[0];
  if (!rule || typeof rule.countryCode !== "string" || !rule.countryCode ||
      typeof rule.mobileNumberRegex !== "string" || !rule.mobileNumberRegex) {
    return null;
  }
  return {
    countryCode: rule.countryCode,
    mobileNumberRegex: rule.mobileNumberRegex,
    ...(typeof rule.errorMessage === "string" && rule.errorMessage && {
      errorMessage: rule.errorMessage,
    }),
  };
}

/**
 * Route tenant first, then its root. DIGIT MDMS has no read-time tenant
 * inheritance, so a subtenant without its own MobileNumberValidation (or
 * branding) uses the root's record.
 */
async function loadTenantMasters(route: PublicTenantRoute): Promise<TenantMasters> {
  const tenants = [...new Set([route.tenantId, route.rootTenantId])];
  const results = await Promise.all(tenants.map(searchMdmsV1));
  const first = (moduleName: string, master: string): unknown[] => {
    for (const result of results) {
      const values = records(result, moduleName, master);
      if (values.length) return values;
    }
    return [];
  };
  const module = config.digitUiConfigModuleName;
  const privacyPolicy = first(module, "PrivacyPolicy");
  return {
    stateInfo: (first("common-masters", "StateInfo")[0] as Record<string, unknown>) || null,
    themeConfig: first("common-masters", "ThemeConfig")[0] ?? null,
    mobileValidation: pickMobileValidation(first("common-masters", "MobileNumberValidation")),
    loginConfig: first(module, "LoginConfig")[0] ?? null,
    privacyPolicy: privacyPolicy.length ? privacyPolicy : null,
  };
}

async function tenantMasters(route: PublicTenantRoute): Promise<TenantMasters> {
  const key = `${route.tenantId}|${route.rootTenantId}`;
  const now = Date.now();
  const cached = mastersCache.get(key);
  if (cached && now < cached.expiresAt) return cached.promise;
  const promise = loadTenantMasters(route);
  mastersCache.set(key, { expiresAt: now + config.identityBrandingCacheSeconds * 1000, promise });
  try {
    return await promise;
  } catch (error) {
    if (mastersCache.get(key)?.promise === promise) mastersCache.delete(key);
    throw error;
  }
}

/** The mobile-number rule for a route tenant (route tenant, then root). */
export async function mobileValidationForRoute(
  route: PublicTenantRoute,
): Promise<MobileValidation | null> {
  return (await tenantMasters(route)).mobileValidation;
}

async function searchLocalization(
  tenantId: string,
  locale: string,
  modules: string[],
): Promise<Array<{ code: string; message: string }>> {
  const url = new URL(config.digitLocalizationSearchUrl);
  url.searchParams.set("tenantId", tenantId);
  url.searchParams.set("locale", locale);
  url.searchParams.set("module", modules.join(","));
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ RequestInfo: { apiId: "digit-identity-bff" } }),
      signal: AbortSignal.timeout(config.digitTimeoutMs),
    });
  } catch {
    throw new DigitUnavailableError("DIGIT localization lookup failed");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DigitUnavailableError(`DIGIT localization lookup returned ${response.status}`);
  }
  const body = await response.json().catch(() => null) as {
    messages?: Array<{ code?: unknown; message?: unknown }>;
  } | null;
  return (body?.messages || []).flatMap((entry) =>
    typeof entry?.code === "string" && typeof entry.message === "string"
      ? [{ code: entry.code, message: entry.message }]
      : []);
}

/** `TENANT_TENANTS_{CODE}` as digit-ui's getTransformedLocale spells it. */
export function tenantMessageKey(tenantId: string): string {
  return `TENANT_TENANTS_${tenantId}`.toUpperCase().replace(/[.:\-\s/]/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asList(value: unknown): Record<string, unknown>[] {
  return (Array.isArray(value) ? value : [value]).filter(isRecord);
}

/**
 * Localization keys the themes look up for this tenant's records, read the
 * way the theme reads them: the header `TENANT_TENANTS_{CODE}`,
 * `LoginConfig.texts.*` and `bannerImages[].title / description` (Carousel), and every heading/text of the PrivacyPolicy
 * records (Privacy popup). Bounded so an oversized MDMS record cannot grow
 * the response without limit.
 */
export function dynamicMessageKeys(
  route: Pick<PublicTenantRoute, "tenantId" | "rootTenantId">,
  masters: Pick<TenantMasters, "stateInfo" | "loginConfig" | "privacyPolicy">,
): Set<string> {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    if (keys.size < MAX_REFERENCED_KEYS && typeof value === "string" && value.trim() &&
        value.length <= MAX_KEY_LENGTH) {
      keys.add(value);
    }
  };
  add(tenantMessageKey(route.tenantId));
  add(tenantMessageKey(route.rootTenantId));
  const stateCode = masters.stateInfo?.code;
  if (typeof stateCode === "string" && stateCode) add(tenantMessageKey(stateCode));

  for (const loginConfig of asList(masters.loginConfig)) {
    const texts = isRecord(loginConfig.texts) ? loginConfig.texts : {};
    add(texts.header);
    add(texts.submitButtonLabel);
    add(texts.secondaryButtonLabel);
    for (const banner of asList(loginConfig.bannerImages)) {
      add(banner.title);
      add(banner.description);
    }
  }
  for (const policy of asList(masters.privacyPolicy)) {
    add(policy.header);
    for (const content of asList(policy.contents)) {
      add(content.header);
      for (const description of asList(content.descriptions)) {
        add(description.text);
        for (const sub of asList(description.subDescriptions)) add(sub.text);
      }
    }
  }
  return keys;
}

function wantedKeys(route: PublicTenantRoute, masters: TenantMasters): (key: string) => boolean {
  const exact = dynamicMessageKeys(route, masters);
  for (const key of LOGIN_MESSAGE_KEYS) exact.add(key);
  return (key) => exact.has(key);
}

async function loginMessages(
  route: PublicTenantRoute,
  masters: TenantMasters,
  locale: string,
): Promise<Record<string, string>> {
  const modules = [...new Set([
    "rainmaker-common", "digit-ui", "digit-tenants",
    `rainmaker-${route.tenantId}`, `rainmaker-${route.rootTenantId}`,
  ])];
  // Localization is exact-match per tenant: root rows first, then the route
  // tenant's own rows override them.
  const tenants = [...new Set([route.rootTenantId, route.tenantId])];
  const results = await Promise.all(
    tenants.map((tenantId) => searchLocalization(tenantId, locale, modules)),
  );
  const wanted = wantedKeys(route, masters);
  const messages: Record<string, string> = {};
  for (const entries of results) {
    for (const { code, message } of entries) {
      if (wanted(code)) messages[code] = message;
    }
  }
  return Object.fromEntries(Object.entries(messages).sort(([left], [right]) =>
    left.localeCompare(right)));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function languages(value: unknown): Array<{ label: string; value: string }> {
  return Array.isArray(value)
    ? value.flatMap((entry) => typeof entry?.value === "string" && entry.value
      ? [{ label: typeof entry.label === "string" ? entry.label : entry.value, value: entry.value }]
      : [])
    : [];
}

/**
 * The DIGIT locale (`fr_FR`) for a `locale` query value. DIGIT codes pass
 * through; Keycloak/BCP-47 tags (`fr`, `fr-FR`) are mapped the same way the
 * theme maps them, so either spelling hits the same cache entry.
 */
export function requestedBrandingLocale(value: unknown): string {
  if (value === undefined || value === "") return config.identityBrandingDefaultLocale;
  if (typeof value !== "string") throw new BrandingRequestError("Unsupported locale");
  if (LOCALE.test(value)) return value;
  const tag = LANGUAGE_TAG.exec(value);
  if (!tag) throw new BrandingRequestError("Unsupported locale");
  const language = tag[1].toLowerCase();
  const region = tag[2]?.toUpperCase() ?? DEFAULT_LOCALE_REGION[language];
  if (!region) throw new BrandingRequestError("Unsupported locale");
  const locale = `${language}_${region}`;
  if (language === "en" && !tag[2] &&
      config.identityBrandingDefaultLocale.startsWith("en_")) {
    return config.identityBrandingDefaultLocale;
  }
  return locale;
}

/**
 * Public login branding for a route tenant: only what the legacy login pages
 * already show to anonymous visitors. Cached per (tenant, locale) for
 * `IDENTITY_BRANDING_CACHE_SECONDS`; a localization outage degrades to no
 * messages (not cached) rather than failing the sign-in page.
 */
export async function tenantBranding(
  route: PublicTenantRoute,
  locale: string,
): Promise<TenantBranding> {
  const key = `${route.urlSlug}|${route.tenantId}|${locale}`;
  const cached = brandingCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const masters = await tenantMasters(route);
  let messages: Record<string, string> = {};
  let complete = true;
  try {
    messages = await loginMessages(route, masters, locale);
  } catch (error) {
    if (!(error instanceof DigitUnavailableError)) throw error;
    console.warn("Login branding messages unavailable:", error.message);
    complete = false;
  }
  const stateInfo = masters.stateInfo || {};
  const stateLanguages = languages(stateInfo.languages);
  const value: TenantBranding = {
    tenant: { urlSlug: route.urlSlug, tenantId: route.tenantId, name: route.name },
    stateInfo: {
      code: stringOrNull(stateInfo.code),
      name: stringOrNull(stateInfo.name),
      logoUrl: stringOrNull(stateInfo.logoUrl),
      logoUrlWhite: stringOrNull(stateInfo.logoUrlWhite),
      bannerUrl: stringOrNull(stateInfo.bannerUrl),
      languages: stateLanguages,
      defaultLocale: !stateLanguages.length ||
        stateLanguages.some((language) => language.value === config.identityBrandingDefaultLocale)
        ? config.identityBrandingDefaultLocale
        : stateLanguages[0].value,
    },
    themeConfig: masters.themeConfig,
    loginConfig: masters.loginConfig,
    privacyPolicy: masters.privacyPolicy,
    footer: {
      digitFooter: config.digitFooterUrl,
      digitFooterBw: config.digitFooterBwUrl,
      digitHomeUrl: config.digitHomeUrl,
    },
    messages,
  };
  if (complete) {
    if (brandingCache.size >= MAX_BRANDING_CACHE_ENTRIES) {
      brandingCache.delete(brandingCache.keys().next().value!);
    }
    brandingCache.set(key, {
      expiresAt: Date.now() + config.identityBrandingCacheSeconds * 1000,
      value,
    });
  }
  return value;
}

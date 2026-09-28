import { config } from "../../infrastructure/config.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import type { PublicTenantRoute } from "../access-context/tenant-route.js";

/**
 * Every i18n key the legacy digit-ui employee and citizen login screens use
 * (#2167). The Keycloak `digit-employee` / `digit-citizen` themes render
 * from exactly these, so this list is the single place to add a key.
 */
export const LOGIN_MESSAGE_KEYS = [
  // Employee (pages/employee/Login)
  "CORE_COMMON_LOGIN",
  "CORE_LOGIN_USERNAME",
  "CORE_LOGIN_PASSWORD",
  "CORE_COMMON_FORGOT_PASSWORD",
  "ES_BY_CLICKING",
  "ES_PRIVACY_POLICY",
  "INVALID_LOGIN_CREDENTIALS",
  "CORE_COMMON_REQUIRED_ERRMSG",
  // Citizen (pages/citizen/Login: SelectMobileNumber, SelectOtp, SelectName)
  "CS_LOGIN_PROVIDE_MOBILE_NUMBER",
  "CS_LOGIN_TEXT",
  "CORE_COMMON_MOBILE_NUMBER",
  "ERR_INVALID_MOBILE_NUMBER",
  "CORE_COMMON_MOBILE_ERROR",
  "CS_COMMONS_NEXT",
  "CS_LOGIN_OTP",
  "CS_LOGIN_OTP_TEXT",
  "CS_INVALID_OTP",
  "CS_RESEND_ANOTHER_OTP",
  "CS_RESEND_OTP",
  "CS_LOGIN_PROVIDE_NAME",
  "CORE_COMMON_NAME",
  // Shared chrome
  "CORE_COMMON_LANGUAGE",
  "CS_COMMON_CHOOSE_LANGUAGE",
] as const;

/** Key families included whole (e.g. MOBILE_VALIDATION_* regex hints). */
export const LOGIN_MESSAGE_KEY_PREFIXES = ["MOBILE_VALIDATION_"] as const;

const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/;
const I18N_KEY = /^[A-Z][A-Z0-9_]{2,127}$/;
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
  mobileValidation: MobileValidation | null;
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

export function tenantMessageKey(tenantId: string): string {
  return `TENANT_TENANTS_${tenantId.toUpperCase().replace(/[.-]/g, "_")}`;
}

/** UPPER_SNAKE strings inside a raw MDMS record, e.g. privacy-policy headings. */
function referencedKeys(value: unknown, into: Set<string>, depth = 0): void {
  if (into.size >= MAX_REFERENCED_KEYS || depth > 8) return;
  if (typeof value === "string") {
    if (I18N_KEY.test(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) referencedKeys(item, into, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) referencedKeys(item, into, depth + 1);
  }
}

function wantedKeys(route: PublicTenantRoute, masters: TenantMasters): (key: string) => boolean {
  const exact = new Set<string>(LOGIN_MESSAGE_KEYS);
  exact.add(tenantMessageKey(route.tenantId));
  exact.add(tenantMessageKey(route.rootTenantId));
  const stateCode = masters.stateInfo?.code;
  if (typeof stateCode === "string" && stateCode) exact.add(tenantMessageKey(stateCode));
  if (masters.mobileValidation?.errorMessage) exact.add(masters.mobileValidation.errorMessage);
  referencedKeys(masters.loginConfig, exact);
  referencedKeys(masters.privacyPolicy, exact);
  return (key) => exact.has(key) ||
    LOGIN_MESSAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
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

export function requestedBrandingLocale(value: unknown): string {
  if (value === undefined) return config.identityBrandingDefaultLocale;
  if (typeof value !== "string" || !LOCALE.test(value)) {
    throw new BrandingRequestError("Unsupported locale");
  }
  return value;
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
    mobileValidation: masters.mobileValidation,
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

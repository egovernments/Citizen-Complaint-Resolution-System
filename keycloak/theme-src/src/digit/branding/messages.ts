const LOCALE = /^[a-z]{2,3}_[A-Z]{2}$/;
/** Keycloak/BCP-47 tags as the themes and `ui_locales` send them: fr, fr-FR, pt_mz. */
const LANGUAGE_TAG = /^([a-zA-Z]{2,3})(?:[-_]([a-zA-Z]{2}))?$/;
/** Region DIGIT seeds for a bare language (matches the theme's `digitLocaleOf`). */
const DEFAULT_LOCALE_REGION: Record<string, string> = {
  en: "IN", fr: "FR", pt: "PT", sw: "KE", hi: "IN", es: "ES",
};
const MAX_KEY_LENGTH = 128;
const MAX_REFERENCED_KEYS = 200;

export class BrandingRequestError extends Error {}
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
  route: { tenantId: string; rootTenantId: string },
  masters: { stateInfo: Record<string, unknown> | null; loginConfig: unknown; privacyPolicy: unknown },
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

/**
 * The DIGIT locale (`fr_FR`) for a `locale` query value. DIGIT codes pass
 * through; Keycloak/BCP-47 tags (`fr`, `fr-FR`) are mapped the same way the
 * theme maps them, so either spelling hits the same cache entry.
 */
export function requestedBrandingLocale(value: unknown, defaultLocale = "en_IN"): string {
  if (value === undefined || value === "") return defaultLocale;
  if (typeof value !== "string") throw new BrandingRequestError("Unsupported locale");
  if (LOCALE.test(value)) return value;
  const tag = LANGUAGE_TAG.exec(value);
  if (!tag) throw new BrandingRequestError("Unsupported locale");
  const language = tag[1].toLowerCase();
  const region = tag[2]?.toUpperCase() ?? DEFAULT_LOCALE_REGION[language];
  if (!region) throw new BrandingRequestError("Unsupported locale");
  const locale = `${language}_${region}`;
  if (language === "en" && !tag[2] &&
      defaultLocale.startsWith("en_")) {
    return defaultLocale;
  }
  return locale;
}


import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LOGIN_MESSAGE_KEYS,
  dynamicMessageKeys,
  requestedBrandingLocale,
  tenantMessageKey,
} from "../../src/modules/branding/tenant-branding.js";

/**
 * The theme's `LOGIN_MESSAGE_FALLBACKS` is the source of the static login
 * keys; the BFF image cannot import it (separate build), so this fails when
 * a key is added there but not to the BFF's filter.
 */
function themeStaticKeys(): string[] {
  const source = readFileSync(fileURLToPath(new URL(
    "../../keycloak/theme-src/src/digit/branding/strings.ts", import.meta.url,
  )), "utf8");
  const block = /export const LOGIN_MESSAGE_FALLBACKS = \{([\s\S]*?)\n\} as const;/.exec(source);
  expect(block, "LOGIN_MESSAGE_FALLBACKS block not found in theme strings.ts").not.toBeNull();
  return [...block![1].matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]);
}

describe("login message keys shared with the Keycloak theme", () => {
  it("covers every key the digit-employee/digit-citizen themes read", () => {
    const themeKeys = themeStaticKeys();
    expect(themeKeys.length).toBeGreaterThan(10);
    const bff = new Set<string>(LOGIN_MESSAGE_KEYS);
    const missing = themeKeys.filter((key) => !bff.has(key));
    expect(missing).toEqual([]);
  });

  it("derives tenant, LoginConfig and PrivacyPolicy keys from the records", () => {
    const keys = dynamicMessageKeys(
      { tenantId: "ke.bomet.ulb1", rootTenantId: "ke.bomet" },
      {
        stateInfo: { code: "ke.bomet" },
        loginConfig: {
          texts: { header: "LOGIN_HEADER", submitButtonLabel: "LOGIN_SUBMIT", secondaryButtonLabel: "LOGIN_FORGOT" },
          bannerImages: [{ image: "a.png", title: "BANNER_TITLE_1", description: "BANNER_DESC_1" }],
        },
        privacyPolicy: [{
          module: "HCM",
          header: "PP_HEADER",
          contents: [{
            header: "PP_SECTION",
            descriptions: [{ text: "PP_TEXT", subDescriptions: [{ text: "PP_SUB" }] }],
          }],
        }],
      },
    );
    expect([...keys].sort()).toEqual([
      "BANNER_DESC_1", "BANNER_TITLE_1", "LOGIN_FORGOT", "LOGIN_HEADER", "LOGIN_SUBMIT",
      "PP_HEADER", "PP_SECTION", "PP_SUB", "PP_TEXT",
      "TENANT_TENANTS_KE_BOMET", "TENANT_TENANTS_KE_BOMET_ULB1",
    ]);
    // Same spelling as the theme's tenantLabelKey (getTransformedLocale).
    expect(tenantMessageKey("pb.amritsar-x")).toBe("TENANT_TENANTS_PB_AMRITSAR_X");
  });

  it("maps Keycloak language tags to DIGIT locales", () => {
    expect(requestedBrandingLocale("fr_FR")).toBe("fr_FR");
    expect(requestedBrandingLocale("fr")).toBe("fr_FR");
    expect(requestedBrandingLocale("fr-FR")).toBe("fr_FR");
    expect(requestedBrandingLocale("pt-mz")).toBe("pt_MZ");
    expect(requestedBrandingLocale("sw")).toBe("sw_KE");
    expect(requestedBrandingLocale("en")).toBe("en_IN");
    expect(() => requestedBrandingLocale("zz")).toThrow(/Unsupported locale/);
    expect(() => requestedBrandingLocale("fr_FR;x")).toThrow(/Unsupported locale/);
    expect(() => requestedBrandingLocale(["fr"])).toThrow(/Unsupported locale/);
  });
});

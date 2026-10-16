import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import {
  isTenantBoundSurface,
  parseSurface,
  sessionCookieName,
  surfaceReturnPrefix,
  surfaceRegistry,
} from "../../src/modules/authentication/surfaces.js";
import {
  authorizationUrl,
  oidcClient,
  oidcClientForSurface,
} from "../../src/modules/authentication/oidc.js";
import {
  clearedLoginCookie,
  loginCookie,
  loginStateFromCookie,
  sessionCookie,
  sessionIdFromCookie,
} from "../../src/modules/sessions/session-store.js";
import { pickMobileValidation } from "../../src/modules/citizen-otp/mobile-validation.js";
import {
  parseCitizenRegistration,
  splitE164,
} from "../../src/modules/citizens/citizen-registration.js";
import {
  citizenDigitRoles,
  citizenIdentity,
  digitCitizenTenantId,
  managedIdentity,
} from "../../src/modules/managed-accounts/managed-account-service.js";

const saved = { ...config };
afterEach(() => {
  Object.assign(config as any, saved);
});

describe("sign-in surfaces", () => {
  it("defaults to the configurator and rejects unknown surfaces", () => {
    expect(parseSurface(undefined)).toBe("configurator");
    expect(parseSurface("employee")).toBe("employee");
    expect(parseSurface("citizen")).toBe("citizen");
    expect(parseSurface("admin")).toBeNull();
    expect(parseSurface(["employee"])).toBeNull();
    expect(isTenantBoundSurface("configurator")).toBe(false);
    expect(isTenantBoundSurface("citizen")).toBe(true);
    expect(surfaceReturnPrefix("employee", "bomet-county")).toBe("/bomet-county/digit-ui/employee/");
  });

  it("parses the registry once per configuration", () => {
    config.identitySurfacesJson = JSON.stringify({ reviewer: { contextKind: "employee", clientId: "reviewer", clientSecret: "", scope: "openid", cookieName: "reviewer_session" } });
    const first = surfaceRegistry();
    expect(surfaceRegistry()).toBe(first);
    expect(parseSurface("reviewer")).toBe("reviewer");
    config.identitySurfacesJson = "";
    expect(surfaceRegistry()).not.toBe(first);
    expect(parseSurface("reviewer")).toBeNull();
  });

  it("rejects unsafe registry entries and colliding cookies at startup", () => {
    for (const override of [
      { "../bad": {} }, { employee: { contextKind: "unknown" } },
      { employee: { cookieName: "digit_identity_session_login" } },
      { employee: { cookieName: "bad;cookie" } }, { employee: { prompt: "bad" } },
    ]) {
      config.identitySurfacesJson = JSON.stringify(override);
      expect(() => surfaceRegistry()).toThrow();
    }
  });

  it("keeps the configurator cookie and gives each surface its own cookies", () => {
    expect(sessionCookieName("configurator")).toBe("digit_identity_session");
    expect(sessionCookieName("employee")).toBe("digit_identity_session_employee");
    expect(sessionCookieName("citizen")).toBe("digit_identity_session_citizen");
    expect(sessionCookie("s1", 60)).toMatch(/^digit_identity_session=s1;/);
    expect(sessionCookie("s1", 60, "citizen")).toMatch(/^digit_identity_session_citizen=s1;/);
    expect(loginCookie("st", "employee")).toMatch(/^digit_identity_session_employee_login=st;/);
    expect(clearedLoginCookie("employee")).toContain("Max-Age=0");
    const header = "digit_identity_session=a; digit_identity_session_employee=b; digit_identity_session_citizen_login=c";
    expect(sessionIdFromCookie(header)).toBe("a");
    expect(sessionIdFromCookie(header, "employee")).toBe("b");
    expect(sessionIdFromCookie(header, "citizen")).toBeNull();
    expect(loginStateFromCookie(header, "citizen")).toBe("c");
    expect(loginStateFromCookie(header)).toBeNull();
  });
});

describe("OIDC client table", () => {
  it("chooses the client from the surface and ignores unconfigured clients", () => {
    Object.assign(config as any, {
      keycloakBffClientId: "digit-identity-bff",
      keycloakBffClientSecret: "bff",
      keycloakMagicLinkClientSecret: "",
      keycloakEmployeeClientId: "digit-ui-employee",
      keycloakEmployeeClientSecret: "emp",
      keycloakCitizenClientId: "digit-ui-citizen",
      keycloakCitizenClientSecret: "",
      identityEmployeeScope: "openid profile email",
    });
    expect(oidcClientForSurface("configurator", "password")).toMatchObject({
      clientId: "digit-identity-bff", surface: "configurator", scope: config.identityScope,
    });
    expect(oidcClientForSurface("configurator", "magic_link")).toBeNull();
    expect(oidcClientForSurface("employee", "password")).toEqual({
      clientId: "digit-ui-employee", clientSecret: "emp", surface: "employee",
      scope: "openid profile email",
    });
    expect(oidcClientForSurface("employee", "magic_link")).toBeNull();
    expect(() => oidcClient("digit-ui-citizen")).toThrow(/Unknown identity OIDC client/);
    expect(oidcClient("digit-ui-employee").clientSecret).toBe("emp");
  });

  it("adds scope and display-only parameters without letting them override PKCE", () => {
    const url = new URL(authorizationUrl("state-1", "challenge", "nonce-1", "digit-ui-citizen", {
      scope: "openid profile phone",
      extraParams: { digit_tenant: "bomet-county", prompt: "login", ui_locales: "sw_KE" },
    }));
    expect(url.searchParams.get("scope")).toBe("openid profile phone");
    expect(url.searchParams.get("digit_tenant")).toBe("bomet-county");
    expect(url.searchParams.get("prompt")).toBe("login");
    expect(url.searchParams.get("ui_locales")).toBe("sw_KE");
    expect(url.searchParams.has("kc_idp_hint")).toBe(false);
    expect(() => authorizationUrl("s", "c", "n", "x", { extraParams: { state: "evil" } }))
      .toThrow(/reserved/);
    const configurator = new URL(authorizationUrl("s", "c", "n", "digit-identity-bff", { idpHint: "google" }));
    expect(configurator.searchParams.get("scope")).toBe(config.identityScope);
    expect(configurator.searchParams.get("kc_idp_hint")).toBe("google");
  });
});

describe("citizen phone numbers and registrations", () => {
  const kenya = { countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$" };

  it("splits verified E.164 numbers with the tenant rule", () => {
    expect(splitE164("+254712345678", kenya)).toEqual({ countryCode: "+254", mobileNumber: "712345678" });
    expect(splitE164("+254712345678", { ...kenya, countryCode: "254" }))
      .toEqual({ countryCode: "254", mobileNumber: "712345678" });
    expect(splitE164("+14155550100", kenya)).toBeNull();
    expect(splitE164("+254012345678", kenya)).toBeNull();
    expect(splitE164("0712345678", kenya)).toBeNull();
    expect(splitE164("+254712345678", { ...kenya, mobileNumberRegex: "([" })).toBeNull();
  });

  it("parses only well-formed registration values", () => {
    expect(parseCitizenRegistration("v1|ke.bomet|ke.bomet|ACTIVE|uuid-1", "sub-1", "iss")).toEqual({
      principalId: { issuer: "iss", subject: "sub-1" },
      rootTenantId: "ke.bomet", tenantId: "ke.bomet", status: "ACTIVE", digitUserUuid: "uuid-1",
    });
    expect(parseCitizenRegistration("v1|ke.bomet|ke.bomet|UNKNOWN|uuid-1", "s")).toBeNull();
    expect(parseCitizenRegistration("v2|ke.bomet|ke.bomet|ACTIVE|uuid-1", "s")).toBeNull();
    expect(parseCitizenRegistration("v1|ke.bomet|ke.bomet|ACTIVE|uuid-1|x", "s")).toBeNull();
  });

  it("namespaces citizen accounts apart from employee accounts", () => {
    const employee = managedIdentity("iss", "sub", "ke.bomet");
    const citizen = citizenIdentity("iss", "sub", "ke.bomet");
    expect(employee.userType).toBe("EMPLOYEE");
    expect(employee.username).toMatch(/^kcbff-[0-9a-f]{40}$/);
    expect(citizen.userType).toBe("CITIZEN");
    expect(citizen.username).toMatch(/^kcbffc-[0-9a-f]{40}$/);
    expect(citizen.key).not.toBe(employee.key);
    // egov-user keeps citizens at the first dotted segment, so the account
    // (username, marker, token cache) is per state root, not per city.
    expect(citizen.tenantId).toBe("ke");
    expect(citizen.marker).toMatch(/^keycloak-bff:citizen:v1:[0-9a-f]{64}:ke$/);
    expect(citizenDigitRoles(citizen.tenantId)).toEqual([{ code: "CITIZEN", name: "CITIZEN", tenantId: "ke" }]);
  });

  it("derives the citizen account tenant the way egov-user does", () => {
    expect(digitCitizenTenantId("ke")).toBe("ke");
    expect(digitCitizenTenantId("ke.bomet")).toBe("ke");
    expect(digitCitizenTenantId("ke.bomet.ulb1")).toBe("ke");
    const root = citizenIdentity("iss", "sub", "ke");
    for (const city of ["ke.bomet", "ke.bomet.ulb1", "ke.kisumu"]) {
      const identity = citizenIdentity("iss", "sub", city);
      expect(identity.username).toBe(root.username);
      expect(identity.key).toBe(root.key);
      expect(identity.marker).toBe(root.marker);
    }
    expect(citizenIdentity("iss", "sub", "pg.citya").username).not.toBe(root.username);
    expect(citizenIdentity("iss", "other", "ke.bomet").username).not.toBe(root.username);
  });
});

describe("mobile validation helpers", () => {
  it("selects the default active mobile rule like digit-ui", () => {
    expect(pickMobileValidation([
      { countryCode: "+1", mobileNumberRegex: "^x$" },
      { countryCode: "+254", mobileNumberRegex: "^[17]\\d{8}$", default: true, errorMessage: "MOBILE_VALIDATION_KE" },
    ])).toEqual({ countryCode: "+254", mobileNumberRegex: "^[17]\\d{8}$", errorMessage: "MOBILE_VALIDATION_KE" });
    expect(pickMobileValidation([{ countryCode: "+254" }])).toBeNull();
    expect(pickMobileValidation([])).toBeNull();
  });


});

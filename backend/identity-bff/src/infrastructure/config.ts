const keycloakBffClientId =
  process.env.KEYCLOAK_BFF_CLIENT_ID || "digit-identity-bff";
const digitMdmsCreateUrl = process.env.DIGIT_MDMS_CREATE_URL || "";
const identityCookieName =
  process.env.IDENTITY_COOKIE_NAME || "digit_identity_session";
const digitGatewayHost =
  (process.env.DIGIT_GATEWAY_HOST || "http://gateway:8080").replace(/\/$/, "");

function csv(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function parseAllowedOrigins(value: string): string[] {
  return [...new Set(csv(value).map((candidate) => {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`IDENTITY_ALLOWED_ORIGINS contains an invalid URL: ${candidate}`);
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
        parsed.username || parsed.password || parsed.pathname !== "/" ||
        parsed.search || parsed.hash) {
      throw new Error(`IDENTITY_ALLOWED_ORIGINS must contain origins only: ${candidate}`);
    }
    return parsed.origin;
  }))];
}

function cookieSameSite(value: string): "Lax" | "None" | "Strict" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "lax") return "Lax";
  if (normalized === "none") return "None";
  if (normalized === "strict") return "Strict";
  throw new Error("IDENTITY_COOKIE_SAME_SITE must be Lax, None, or Strict");
}

function keycloakIssuerRealm(): string {
  const issuer = process.env.KEYCLOAK_ISSUER ||
    "http://localhost:8180/auth/realms/digit-sandbox";
  return issuer.split("/realms/").pop() || "digit-sandbox";
}

export const config = {
  port: parseInt(process.env.PORT || "3000"),

  // Keycloak
  keycloakIssuer: process.env.KEYCLOAK_ISSUER || "http://localhost:8180/auth/realms/digit-sandbox",
  keycloakOidcBackchannelUrl:
    process.env.KEYCLOAK_OIDC_BACKCHANNEL_URL ||
    process.env.KEYCLOAK_ISSUER ||
    "http://localhost:8180/auth/realms/digit-sandbox",
  keycloakJwksUri: process.env.KEYCLOAK_JWKS_URI || "http://localhost:8180/auth/realms/digit-sandbox/protocol/openid-connect/certs",
  keycloakBffClientId,
  keycloakBffClientSecret:
    process.env.KEYCLOAK_BFF_CLIENT_SECRET || "dev-only-change-me",
  keycloakBffAudience:
    process.env.KEYCLOAK_BFF_AUDIENCE || keycloakBffClientId,
  keycloakMagicLinkClientId:
    process.env.KEYCLOAK_MAGIC_LINK_CLIENT_ID || "digit-identity-bff-magic-link",
  keycloakMagicLinkClientSecret:
    process.env.KEYCLOAK_MAGIC_LINK_CLIENT_SECRET || "",
  // digit-ui employee and citizen sign-in (#2167). Each surface has its own
  // confidential client, flow and theme; an empty secret leaves the surface
  // unconfigured (503) rather than silently falling back to another client.
  keycloakEmployeeClientId:
    process.env.KEYCLOAK_EMPLOYEE_CLIENT_ID || "digit-ui-employee",
  keycloakEmployeeClientSecret:
    process.env.KEYCLOAK_EMPLOYEE_CLIENT_SECRET || "",
  keycloakCitizenClientId:
    process.env.KEYCLOAK_CITIZEN_CLIENT_ID || "digit-ui-citizen",
  keycloakCitizenClientSecret:
    process.env.KEYCLOAK_CITIZEN_CLIENT_SECRET || "",

  // Identity BFF
  identityRedirectUri:
    process.env.IDENTITY_REDIRECT_URI ||
    "http://localhost:18201/identity/v1/callback",
  identityPostLoginRedirect:
    process.env.IDENTITY_POST_LOGIN_REDIRECT || "/",
  identityAllowedOrigins: parseAllowedOrigins(
    process.env.IDENTITY_ALLOWED_ORIGINS ||
      process.env.IDENTITY_ALLOWED_ORIGIN ||
      "http://localhost:3000",
  ),
  identityScope:
    process.env.IDENTITY_SCOPE || "openid profile email organization:*",
  identityEmployeeScope:
    process.env.IDENTITY_EMPLOYEE_SCOPE || "openid profile email",
  identityCitizenScope:
    process.env.IDENTITY_CITIZEN_SCOPE || "openid profile phone",
  identityCookieName,
  identityEmployeeCookieName:
    process.env.IDENTITY_EMPLOYEE_COOKIE_NAME || `${identityCookieName}_employee`,
  identityCitizenCookieName:
    process.env.IDENTITY_CITIZEN_COOKIE_NAME || `${identityCookieName}_citizen`,
  identityCookieSecure: process.env.IDENTITY_COOKIE_SECURE !== "false",
  identityCookieSameSite: cookieSameSite(
    process.env.IDENTITY_COOKIE_SAME_SITE || "Lax",
  ),
  identityLoginTtlSeconds: parseInt(
    process.env.IDENTITY_LOGIN_TTL_SECONDS || "1800",
  ),
  identityMagicLinkRequestWindowSeconds: parseInt(
    process.env.IDENTITY_MAGIC_LINK_REQUEST_WINDOW_SECONDS || "1800",
  ),
  identityMagicLinkRequestLimit: parseInt(
    process.env.IDENTITY_MAGIC_LINK_REQUEST_LIMIT || "3",
  ),
  identityTrustProxyHops: parseInt(process.env.IDENTITY_TRUST_PROXY_HOPS || "0"),
  identityAuthResultTtlSeconds: parseInt(
    process.env.IDENTITY_AUTH_RESULT_TTL_SECONDS || "300",
  ),
  identityPasswordSetupTtlSeconds: parseInt(
    process.env.IDENTITY_PASSWORD_SETUP_TTL_SECONDS || "900",
  ),
  identityPasswordSetupLimit: parseInt(
    process.env.IDENTITY_PASSWORD_SETUP_LIMIT || "3",
  ),
  identitySessionTtlSeconds: parseInt(
    process.env.IDENTITY_SESSION_TTL_SECONDS || "604800",
  ),
  identityControlPlaneToken:
    process.env.IDENTITY_CONTROL_PLANE_TOKEN || "",
  identitySessionIntrospectionToken:
    process.env.IDENTITY_SESSION_INTROSPECTION_TOKEN || "",
  identityReconcileOnStartup:
    process.env.IDENTITY_RECONCILE_ON_STARTUP !== "false",
  identityReconciliationLeaseSeconds: parseInt(
    process.env.IDENTITY_RECONCILIATION_LEASE_SECONDS || "300",
  ),
  identityReconciliationIntervalSeconds: parseInt(
    process.env.IDENTITY_RECONCILIATION_INTERVAL_SECONDS || "300",
  ),

  // Existing DIGIT user-service contract. The BFF owns only the accounts it
  // created (see managed-account-service.ts); the admin credential is used solely
  // for those accounts' lifecycle, never for business calls.
  digitUserServiceUrl: process.env.DIGIT_USER_SERVICE_URL || "",
  digitMdmsSearchUrl: process.env.DIGIT_MDMS_SEARCH_URL || "",
  digitLocalizationSearchUrl:
    process.env.DIGIT_LOCALIZATION_SEARCH_URL ||
    `${digitGatewayHost}/localization/messages/v1/_search`,
  // Internal egov-otp create endpoint used only by the default
  // CitizenTokenMinter. Never route this through a public gateway: its
  // response contains the OTP value. Empty = citizen tokens unavailable.
  digitOtpCreateUrl: process.env.DIGIT_OTP_CREATE_URL || "",
  // Which identity egov-user passes to egov-otp when a CITIZEN password grant
  // is validated as an OTP: the mobile number (UserService.validateOtp), from
  // the verified session phone. See docs/identity-bff.md#citizen-token-minting.
  digitCitizenOtpIdentity:
    process.env.DIGIT_CITIZEN_OTP_IDENTITY === "userName" ? "userName" as const : "mobileNumber" as const,
  digitCitizenRoles: csv(process.env.DIGIT_CITIZEN_ROLES || "CITIZEN"),
  // Public login branding (#2167): read-only MDMS + localization projection.
  identityBrandingCacheSeconds: parseInt(
    process.env.IDENTITY_BRANDING_CACHE_SECONDS || "300",
  ),
  identityBrandingDefaultLocale:
    process.env.IDENTITY_BRANDING_DEFAULT_LOCALE || "en_IN",
  digitUiConfigModuleName:
    process.env.DIGIT_UI_CONFIG_MODULE_NAME || "commonMDMSConfig",
  digitFooterUrl:
    process.env.DIGIT_FOOTER_URL ?? "/digit-ui/brand/digit-footer.png",
  digitFooterBwUrl:
    process.env.DIGIT_FOOTER_BW_URL ?? "/digit-ui/brand/digit-footer-bw.png",
  digitHomeUrl: process.env.DIGIT_HOME_URL || "https://www.digit.org/",
  // egov-user reached directly (internal network) for token revocation only:
  // Kong's RBAC evaluates the principal's home tenant, which a BFF-managed
  // account may hold no roles in. Defaults to DIGIT_USER_SERVICE_URL.
  digitUserLogoutUrl: process.env.DIGIT_USER_LOGOUT_URL || "",
  digitOauthClientAuthorization:
    process.env.DIGIT_OAUTH_CLIENT_AUTHORIZATION || "Basic ZWdvdi11c2VyLWNsaWVudDo=",
  digitAdminUsername: process.env.DIGIT_ADMIN_USERNAME || "",
  digitAdminPassword: process.env.DIGIT_ADMIN_PASSWORD || "",
  digitAdminTenantId: process.env.DIGIT_ADMIN_TENANT_ID || "",
  digitAdminUserType: process.env.DIGIT_ADMIN_USER_TYPE || "EMPLOYEE",
  // Optional MDMS_ADMIN credential for onboarding tenant-foundation writes.
  digitProvisionerUsername: process.env.DIGIT_PROVISIONER_USERNAME || "",
  digitProvisionerPassword: process.env.DIGIT_PROVISIONER_PASSWORD || "",
  digitProvisionerTenantId: process.env.DIGIT_PROVISIONER_TENANT_ID || "",
  digitMdmsCreateUrl,
  digitMdmsV2SearchUrl:
    process.env.DIGIT_MDMS_V2_SEARCH_URL ||
    digitMdmsCreateUrl.replace(/\/_create\/?$/, "/_search") ||
    `${digitGatewayHost}/mdms-v2/v2/_search`,
  digitMdmsSchemaSearchUrl:
    process.env.DIGIT_MDMS_SCHEMA_SEARCH_URL ||
    `${digitGatewayHost}/mdms-v2/schema/v1/_search`,
  digitMdmsSchemaCreateUrl:
    process.env.DIGIT_MDMS_SCHEMA_CREATE_URL ||
    `${digitGatewayHost}/mdms-v2/schema/v1/_create`,
  digitFoundationSourceTenant:
    process.env.DIGIT_FOUNDATION_SOURCE_TENANT ||
    process.env.DIGIT_BOOTSTRAP_SOURCE_TENANT ||
    "pg",
  // Idempotent egov-enc-service key creation for a new tenant (internal URL).
  digitEncGenerateKeyUrl: process.env.DIGIT_ENC_GENERATE_KEY_URL || "",
  // Optional in-process worker that provisions submitted PGR onboarding operations.
  onboardingWorkerEnabled: process.env.ONBOARDING_WORKER_ENABLED === "true",
  pgrOnboardingWorkerUrl: process.env.PGR_ONBOARDING_WORKER_URL || "",
  pgrOnboardingWorkerToken: process.env.PGR_ONBOARDING_WORKER_TOKEN || "",
  onboardingWorkerIntervalSeconds: parseInt(process.env.ONBOARDING_WORKER_INTERVAL_SECONDS || "15"),
  onboardingWorkerLeaseSeconds: parseInt(process.env.ONBOARDING_WORKER_LEASE_SECONDS || "120"),
  onboardingTenantAdminGroup:
    process.env.ONBOARDING_TENANT_ADMIN_GROUP || "tenant-admins",
  onboardingTenantAdminRoles: csv(
    process.env.ONBOARDING_TENANT_ADMIN_ROLES ||
      "TENANT_ADMIN,GRO,ACCOUNT_ADMIN,MDMS_ADMIN,LOC_ADMIN,SUPERUSER",
  ),
  identityOrganizationAdminRoles: csv(
    process.env.IDENTITY_ORGANIZATION_ADMIN_ROLES || "TENANT_ADMIN",
  ),
  identityOrganizationMemberGroup:
    process.env.IDENTITY_ORGANIZATION_MEMBER_GROUP || "employees",
  digitManagedBaseRoles: csv(process.env.DIGIT_MANAGED_BASE_ROLES || "EMPLOYEE"),
  digitManagedRoleAllowlist: csv(
    process.env.DIGIT_MANAGED_ROLE_ALLOWLIST ||
      "EMPLOYEE,GRO,PGR_LME,DGRO,CSR,SUPERVISOR,AUTO_ESCALATE,PGR_VIEWER,TICKET_REPORT_VIEWER,ACCOUNT_ADMIN,MDMS_ADMIN,LOC_ADMIN,SUPERUSER",
  ),
  digitRoleClientId:
    process.env.DIGIT_ROLE_CLIENT_ID || process.env.DIGIT_IDENTITY_CLIENT_ID || "digit-ui",
  digitTimeoutMs: parseInt(process.env.DIGIT_TIMEOUT_MS || "10000"),
  digitTokenRefreshSkewSeconds: parseInt(
    process.env.DIGIT_TOKEN_REFRESH_SKEW_SECONDS || "60",
  ),
  digitUserLeaseSeconds: parseInt(process.env.DIGIT_USER_LEASE_SECONDS || "30"),
  digitUserLeaseWaitMs: parseInt(process.env.DIGIT_USER_LEASE_WAIT_MS || "15000"),
  digitPasswordLength: parseInt(process.env.DIGIT_PASSWORD_LENGTH || "15"),
  keycloakOrganizationRealm:
    process.env.KEYCLOAK_ORGANIZATION_REALM || keycloakIssuerRealm(),
  keycloakAllowedOrganizationRoleClients: (
    process.env.KEYCLOAK_ALLOWED_ORG_ROLE_CLIENTS || "digit-ui"
  ).split(",").map((value) => value.trim()).filter(Boolean),

  // Keycloak Admin
  keycloakAdminUrl: process.env.KEYCLOAK_ADMIN_URL || "http://localhost:8180",
  keycloakAdminRealm: process.env.KEYCLOAK_ADMIN_REALM || "master",
  keycloakAdminClientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID || "admin-cli",
  keycloakAdminClientSecret:
    process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || "",
  keycloakAdminUsername: process.env.KEYCLOAK_ADMIN_USERNAME || "admin",
  keycloakAdminPassword: process.env.KEYCLOAK_ADMIN_PASSWORD || "admin",
  // Redis
  redisHost: process.env.REDIS_HOST || "localhost",
  redisPort: parseInt(process.env.REDIS_PORT || "6379"),
  cachePrefix: process.env.CACHE_PREFIX || "keycloak",
};

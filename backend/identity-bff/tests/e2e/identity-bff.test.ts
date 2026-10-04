import { ensureActive, remove as removeBinding } from "../../src/modules/bindings/store.js";
import { mirrorPerson } from "../../src/modules/sync/mirror.js";
import * as syncMirror from "../../src/modules/sync/mirror.js";
import * as sessionStore from "../../src/modules/sessions/session-store.js";
import { BindingError } from "../../src/modules/bindings/types.js";
import { propagateIdentifiers } from "../../src/modules/sync/identifiers.js";
import { tokenKey, tokenHoldersKey, personTokensKey, accountId } from "../../src/modules/revocation/inventory.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { getIssuer } from "../helpers.js";
import { createFakeDigitUser } from "../../mocks/fake-digit-user.js";
import { getRedis } from "../../src/infrastructure/redis.js";
import {
  citizenIdentity,
  linkedIdentity,
  managedAccountsKey,
  managedUserLogin,
} from "../../src/modules/managed-accounts/managed-account-service.js";
import {
  citizenTokenMinter,
  setCitizenTokenMinter,
} from "../../src/modules/managed-accounts/citizen-token-minter.js";
import { createHash } from "node:crypto";
import {
  createIdentitySession,
  createPhoneOtpSession,
  getIdentitySession,
  saveSelectedIdentityContext,
  touchIdentitySession,
} from "../../src/modules/sessions/session-store.js";

async function clearTokenInventory(identity: { subject: string; tenantId: string }): Promise<void> {
  const ids = await getRedis().smembers(`${config.cachePrefix}:identity:person-tokens:${identity.subject}`);
  const keys = ids.filter(id => id.startsWith(`${identity.tenantId}:`)).map(id => `${config.cachePrefix}:identity:token:${id}`);
  if (keys.length) await getRedis().del(...keys);
}
import { resetIdentityMethodCatalog } from "../../src/modules/authentication/methods.js";
import {
  LogOtpSender,
  OtpDeliveryError,
  otpSender,
  setOtpSender,
  warnAboutInsecureOtpModes,
  type OtpMessage,
} from "../../src/modules/citizen-otp/otp-sender.js";
import { auditStreamKey } from "../../src/modules/citizen-otp/audit.js";
import * as subjectSync from "../../src/modules/reconciliation/subject-sync.js";
import * as reconciliation from "../../src/modules/reconciliation/reconciliation-service.js";
import { syncSubject, syncSubjectTenant } from "../../src/modules/reconciliation/subject-sync.js";
import { desiredRolesForSubjectTenant } from "../../src/modules/reconciliation/reconciliation-service.js";
import {
  ensureOrganizationMembership,
  readOrganizationMapping,
  isOrganizationGroupMember,
  readOrganizationGroupReconciliation,
  clearTenantMappingCache,
  keycloakPhoneIsAdminControlled,
  readTenantMappingForTenant,
  readTenantMappingForUrlSlug,
  recordManagedTenant,
  resetPhoneTrustCache,
  updateCitizenRegistrationValues,
} from "../../src/modules/organizations/organization-service.js";
import { contractRoute, expectContractError } from "../contract/harness.js";
import {
  getIdentityAppPort as getAppPort,
  startIdentityTestApp as startTestApp,
  stopIdentityTestApp as stopTestApp,
} from "./identity-test-app.js";

async function withoutSubjectReconciliation(run: () => Promise<Response>): Promise<Response> {
  const spies = [vi.spyOn(subjectSync, "syncSubject"), vi.spyOn(subjectSync, "syncSubjectTenant"),
    vi.spyOn(reconciliation, "desiredRolesBySubject")];
  try {
    const result = await run();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    return result;
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
}

const digit = createFakeDigitUser({
  tenants: ["ug", "ke", "ke.bomet", "ke.bomet.ulb1", "ke.kisumu", "ke.nakuru", "ke.nyeri"],
});
let nakuruOrganizationId = "";

async function kcAdmin(path: string, body: unknown): Promise<Response> {
  return fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function kcUpdate(path: string, body: unknown): Promise<Response> {
  return fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Legacy managed-account fixtures keep unrelated sign-in/reconciliation coverage
 * until their separately owned removal. Onboarding membership no longer creates accounts. */
async function legacyMembershipFixture(organizationId: string, userId: string, mobileNumber = "") {
  await ensureOrganizationMembership({ organizationId, userId });
  const mapping = await readOrganizationMapping(organizationId);
  const outcome = (await syncSubject(userId, mobileNumber)).get(mapping!.tenantId);
  return { tenantId: mapping!.tenantId, digitUserUuid: outcome?.account?.uuid ?? null, created: outcome?.created ?? false };
}

beforeAll(async () => {
  const digitBase = await digit.start();
  digit.addAccount({
    userName: "BFF-ADMIN", name: "BFF admin", mobileNumber: "0700000000", emailId: null,
    tenantId: "ke", type: "EMPLOYEE", active: true, identificationMark: null,
    roles: [{ code: "ACCOUNT_ADMIN", tenantId: "ke" }], password: "Adm1n@Secret",
  });
  (config as any).keycloakIssuer = getIssuer();
  (config as any).keycloakBffClientId = "digit-identity-bff";
  (config as any).keycloakBffClientSecret = "test-bff-secret";
  (config as any).keycloakBffAudience = "digit-identity-bff";
  (config as any).keycloakMagicLinkClientId = "digit-identity-bff-magic-link";
  (config as any).keycloakMagicLinkClientSecret = "test-magic-secret";
  Object.assign(config as any, {
    keycloakEmployeeClientId: "digit-ui-employee",
    keycloakEmployeeClientSecret: "test-employee-secret",
    keycloakCitizenClientId: "digit-ui-citizen",
    keycloakCitizenClientSecret: "test-citizen-secret",
    identityEmployeeScope: "openid profile email",
    identityCitizenScope: "openid profile phone",
    digitOtpCreateUrl: `${digitBase}/otp/v1/_create`,
  });
  (config as any).identityRedirectUri =
    "http://localhost:18200/identity/v1/callback";
  (config as any).identityPostLoginRedirect = "/after-login";
  (config as any).identityAllowedOrigins = ["http://localhost:3000", "http://localhost:5173"];
  (config as any).identityCookieSecure = false;
  (config as any).identityCookieSameSite = "Lax";
  (config as any).identityTrustProxyHops = 2;
  Object.assign(config as any, {
    cachePrefix: `identity-e2e-${process.pid}`,
    digitUserServiceUrl: `${digitBase}/user`,
    digitMdmsSearchUrl: `${digitBase}/mdms-v2/v1/_search`,
    digitAdminUsername: "BFF-ADMIN",
    digitAdminPassword: "Adm1n@Secret",
    digitAdminTenantId: "ke",
    digitManagedBaseRoles: ["EMPLOYEE"],
    digitManagedRoleAllowlist: ["EMPLOYEE", "GRO", "PGR_VIEWER"],
    digitRoleClientId: "digit-ui",
    identityOrganizationAdminRoles: ["TENANT_ADMIN"],
    identityOrganizationMemberGroup: "employees",
  });
  (config as any).identityControlPlaneToken = "test-control-plane";
  config.identityOnboardingToken = "test-onboarding";
  (config as any).identitySessionIntrospectionToken = "test-session-introspection";
  (config as any).identityReconciliationLeaseSeconds = 30;
  (config as any).keycloakOrganizationRealm = "digit-sandbox";
  (config as any).keycloakAllowedOrganizationRoleClients = ["digit-ui"];
  await startTestApp();
  await kcAdmin("/users", {
    id: "identity-user-1", username: "demo.person", email: "person@example.com",
    firstName: "Demo", lastName: "Person", enabled: true, emailVerified: true,
  });
  for (const [id, alias, tenantId, name] of [
    ["org-bomet-id", "bomet", "ke.bomet", "Bomet County"],
    ["org-kisumu-id", "kisumu", "ke.kisumu", "Kisumu County"],
  ]) {
    await kcAdmin("/organizations", {
      id, alias, name, enabled: true, attributes: {
        "digit.rootTenantId": [tenantId],
        ...(alias === "bomet" && { "digit.urlSlug": ["bomet-county"] }),
      },
    });
    await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/organizations/${id}/members`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify("identity-user-1") },
    );
  }
});

afterAll(async () => {
  await stopTestApp();
  await digit.stop();
});

describe("identity BFF", () => {
  it("resolves a public URL slug without granting tenant access", async () => {
    const resolved = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/tenant-contexts/bomet-county`,
    );
    expect(resolved.status).toBe(200);
    expect(resolved.headers.get("cache-control")).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(await resolved.json()).toEqual({
      tenant: {
        urlSlug: "bomet-county",
        tenantId: "ke.bomet",
        rootTenantId: "ke.bomet",
        parentTenantId: null,
        fallbackTenantIds: [],
        name: "Bomet County",
      },
    });

    const missing = await fetch(`http://localhost:${getAppPort()}/identity/v1/tenant-contexts/missing-county`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(
      `http://localhost:${getAppPort()}/identity/v1/tenant-contexts/a-123`,
    )).status).toBe(404);
  });

  it("resolves and selects an explicitly mapped Organization-group subtenant", async () => {
    const ensured = await fetch(
      `http://localhost:${getAppPort()}/internal/identity/v1/tenant-groups/_ensure`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-control-plane",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "org-bomet-id",
          tenantId: "ke.bomet.ulb1",
          parentTenantId: "ke.bomet",
          fallbackTenantIds: ["ke.bomet"],
          urlSlug: "bomet-ulb-one",
          name: "Bomet ULB One",
        }),
      },
    );
    expect(ensured.status).toBe(200);
    const groupId = (await ensured.json()).tenant.groupId as string;

    expect((await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}` +
      `/organizations/org-bomet-id/groups/${groupId}/members/identity-user-1`,
      { method: "PUT" },
    )).status).toBe(204);
    expect((await kcAdmin(
      `/organizations/org-bomet-id/groups/${groupId}/role-mappings/clients/digit-ui-uuid`,
      [{ id: "gro-id", name: "GRO" }],
    )).status).toBe(204);
    const subtenantMapping = await readTenantMappingForTenant("ke.bomet.ulb1");
    expect(subtenantMapping?.mappingType).toBe("organization-group");
    expect(await isOrganizationGroupMember("org-bomet-id", groupId, "identity-user-1"))
      .toBe(true);
    if (subtenantMapping?.mappingType === "organization-group") {
      expect((await readOrganizationGroupReconciliation(
        subtenantMapping, "digit-ui", "identity-user-1",
      ))?.memberRoles.get("identity-user-1")).toEqual(["GRO"]);
    }
    expect(await desiredRolesForSubjectTenant("identity-user-1", "ke.bomet.ulb1"))
      .toEqual(["GRO"]);
    const provisioned = await syncSubjectTenant(
      "identity-user-1", "ke.bomet.ulb1", "0712345678", "+254",
    );
    expect(provisioned).toMatchObject({
      account: { tenantId: "ke.bomet.ulb1" }, created: true,
    });
    expect(await desiredRolesForSubjectTenant("identity-user-1", "ke.bomet"))
      .not.toContain("GRO");

    const resolved = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/tenant-contexts/bomet-ulb-one`,
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({
      tenant: {
        urlSlug: "bomet-ulb-one",
        tenantId: "ke.bomet.ulb1",
        rootTenantId: "ke.bomet",
        parentTenantId: "ke.bomet",
        fallbackTenantIds: ["ke.bomet"],
        name: "Bomet ULB One",
      },
    });

    const { sessionId } = await createIdentitySession({
      accessToken: "subtenant-server-token", accessExpiresIn: 3600,
    }, { sub: "identity-user-1", email: "person@example.com", name: "Demo Person" },
    "digit-identity-bff");
    const selected = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/contexts/_select`,
      {
        method: "POST",
        headers: {
          Cookie: `${config.identityCookieName}=${sessionId}`,
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: "ke.bomet.ulb1" }),
      },
    );
    expect(selected.status).toBe(200);
    expect((await selected.json()).UserRequest).toMatchObject({
      tenantId: "ke.bomet.ulb1",
      roles: expect.arrayContaining([
        expect.objectContaining({ code: "GRO", tenantId: "ke.bomet.ulb1" }),
      ]),
    });
  });

  it("uses onboarding-owned Organizations while preserving legacy managed-account fixtures", async () => {
    const base = `http://localhost:${getAppPort()}/internal/identity/v1`;
    const unauthorized = await fetch(`${base}/organizations/_ensure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "ke.nakuru", alias: "nakuru", name: "Nakuru" }),
    });
    expect(unauthorized.status).toBe(401);

    const headers = {
      Authorization: "Bearer test-control-plane",
      "Content-Type": "application/json",
    };
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
      method: "POST", headers: { ...headers, Authorization: `Bearer ${["/organizations/_ensure", "/organizations/_lifecycle", "/memberships/_ensure"].includes(path) ? "test-onboarding" : "test-control-plane"}` }, body: JSON.stringify(body),
    });

    expect((await post("/organizations/_ensure", {
      operationId: "test-missing", restartNo: 0, tenantId: "ke.missing", slug: "missing", name: "Missing",
    })).status).toBe(409);

    const ensureOrganization = async (tenantId: string, alias: string) => {
      const response = await post("/organizations/_ensure", { operationId: `test-${alias}`, restartNo: 0, tenantId, slug: alias, name: alias });
      expect(response.status).toBe(200);
      expect((await post("/organizations/_lifecycle", { operationId: `test-${alias}`, restartNo: 0, state: "ACTIVE" })).status).toBe(200);
      return (await response.json()).organization.id as string;
    };
    const nakuru = await ensureOrganization("ke.nakuru", "nakuru");
    nakuruOrganizationId = nakuru;
    expect(await ensureOrganization("ke.nakuru", "nakuru")).toBe(nakuru);

    const created = await kcAdmin("/users", {
      username: "member@example.org", email: "member@example.org",
      firstName: "New", lastName: "Member", emailVerified: true,
    });
    const memberId = created.headers.get("location")!.split("/").pop()!;

    expect((await post("/memberships/_ensure", {
      organizationId: nakuru, userId: memberId, digitUserUuid: "legacy-employee",
    })).status).toBe(400);
    const membership = await post("/memberships/_ensure", {
      operationId: "test-nakuru", restartNo: 0, tenantId: "ke.nakuru", subject: memberId,
    });
    expect(await membership.json()).toEqual({ tenantId: "ke.nakuru", subject: memberId, member: true });
    await expect(legacyMembershipFixture(nakuru, memberId)).rejects.toMatchObject({ status: 409 });
    const firstBody = await legacyMembershipFixture(nakuru, memberId, "0712345678");
    expect(firstBody).toMatchObject({ created: true });
    expect(await legacyMembershipFixture(nakuru, memberId)).toEqual({
      tenantId: "ke.nakuru", digitUserUuid: firstBody.digitUserUuid, created: false,
    });

    const roles = await post("/role-assignments/_ensure", {
      organizationId: nakuru, userId: memberId, groupName: "officers", clientId: "digit-ui", roles: ["GRO"],
    });
    expect(roles.status).toBe(200);
    expect(await roles.json()).toMatchObject({
      assignment: { roles: ["GRO"] }, digitUserUuid: firstBody.digitUserUuid,
    });

    const nyeri = await ensureOrganization("ke.nyeri", "nyeri");
    const secondBody = await legacyMembershipFixture(nyeri, memberId);
    // DIGIT authorizes a token only at its account's home tenant: one account per tenant.
    expect(secondBody).toMatchObject({ tenantId: "ke.nyeri", created: true });
    expect(secondBody.digitUserUuid).not.toBe(firstBody.digitUserUuid);

    const nakuruAccount = digit.accounts.get(firstBody.digitUserUuid)!;
    const nyeriAccount = digit.accounts.get(secondBody.digitUserUuid)!;
    expect(nakuruAccount.userName).toMatch(/^kcbff-/);
    expect(nakuruAccount.identificationMark).toMatch(/^keycloak-bff:v1:[0-9a-f]{64}:ke\.nakuru$/);
    expect(nakuruAccount.tenantId).toBe("ke.nakuru");
    expect(nakuruAccount.roles.map((role) => `${role.tenantId}:${role.code}`).sort()).toEqual([
      "ke.nakuru:EMPLOYEE", "ke.nakuru:GRO",
    ]);
    expect(nyeriAccount.roles.map((role) => `${role.tenantId}:${role.code}`)).toEqual(["ke.nyeri:EMPLOYEE"]);
    expect(digit.accounts.size).toBe(4);

    const reconciliation = await post("/reconciliation/_run", {});
    expect(reconciliation.status).toBe(200);
    expect(await reconciliation.json()).toMatchObject({
      acquired: true, mirrored: 0, revoked: 0, propagated: 0, failures: [],
    });
  });

  it("exposes configured methods and rejects unknown methods", async () => {
    resetIdentityMethodCatalog();
    await fetch(`${config.keycloakAdminUrl}/__test/admin-log`, { method: "DELETE" });
    const methods = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods`,
    );
    expect(methods.status).toBe(200);
    expect(await methods.json()).toEqual({ methods: [
      { id: "password", labelKey: "IDENTITY_METHOD_PASSWORD", type: "password", intents: ["signin"] },
      { id: "google", labelKey: "IDENTITY_METHOD_GOOGLE", label: "Google", type: "idp", idpHint: "google", intents: ["signin", "signup"] },
      { id: "github", labelKey: "IDENTITY_METHOD_GITHUB", label: "github", type: "idp", idpHint: "github", intents: ["signin", "signup"] },
    ] });
    const initialAdminReads = await (
      await fetch(`${config.keycloakAdminUrl}/__test/admin-log`)
    ).json() as string[];

    const signinMethods = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods?intent=signin`,
    );
    expect((await signinMethods.json()).methods.map((method: { id: string }) => method.id))
      .toEqual(["password", "google", "github"]);
    const signupMethods = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods?intent=signup`,
    );
    expect((await signupMethods.json()).methods.map((method: { id: string }) => method.id))
      .toEqual(["magic_link", "google", "github"]);
    const cachedAdminReads = await (
      await fetch(`${config.keycloakAdminUrl}/__test/admin-log`)
    ).json() as string[];
    expect(cachedAdminReads).toEqual(initialAdminReads);

    await kcUpdate("/clients/digit-identity-bff-uuid", {
      attributes: {
        "digit.auth.signin.methods": "google",
        "digit.auth.signup.methods": "magic_link,google,github",
      },
    });
    resetIdentityMethodCatalog();
    const reconfigured = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods?intent=signin`,
    );
    expect((await reconfigured.json()).methods.map((method: { id: string }) => method.id))
      .toEqual(["google"]);
    await kcUpdate("/clients/digit-identity-bff-uuid", {
      attributes: {
        "digit.auth.signin.methods": "password,google,github",
        "digit.auth.signup.methods": "magic_link,google,github",
      },
    });
    resetIdentityMethodCatalog();

    const unknown = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=unknown`,
      { redirect: "manual" },
    );
    expect(unknown.status).toBe(400);

    const invalidIntent = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=password&intent=register`,
      { redirect: "manual" },
    );
    expect(invalidIntent.status).toBe(400);

    const unsafeReturn = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=password&returnTo=${encodeURIComponent("/\\attacker.example")}`,
      { redirect: "manual" },
    );
    expect(unsafeReturn.status).toBe(400);

    const normalizedUnsafeReturn = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=password&returnTo=${encodeURIComponent("/..//attacker.example")}`,
      { redirect: "manual" },
    );
    expect(normalizedUnsafeReturn.status).toBe(400);

    const hostedMagic = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=magic_link&intent=signup&returnTo=%2Fclient%2Fsignup`,
      { redirect: "manual" },
    );
    expect(hostedMagic.status).toBe(400);

    const magic = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authentication/magic-link-requests`,
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.30",
        },
        body: JSON.stringify({
          firstName: "Magic",
          lastName: "Founder",
          email: "person@example.com",
          returnTo: "/client/signup",
        }),
      },
    );
    expect(magic.status).toBe(202);
    expect(await magic.json()).toEqual({
      message: "Check your email for a link to continue creating your account.",
    });
    let magicRequests: Array<Record<string, unknown>> = [];
    await expect.poll(async () => {
      magicRequests = await (
        await fetch(`${config.keycloakAdminUrl}/__test/magic-links`)
      ).json() as Array<Record<string, unknown>>;
      return magicRequests.length;
    }).toBeGreaterThan(0);
    const magicRequest = magicRequests.at(-1)!;
    expect(magicRequest).toMatchObject({
      email: "person@example.com",
      client_id: "digit-identity-bff-magic-link",
      redirect_uri: config.identityRedirectUri,
      force_create: false,
      send_email: true,
      reusable: false,
      response_mode: "query",
    });
    const magicState = String(magicRequest.state);
    const magicNonce = String(magicRequest.nonce);
    const callback = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/callback?code=valid-code:${encodeURIComponent(magicNonce)}&state=${encodeURIComponent(magicState)}`,
      { redirect: "manual" },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/client/signup");
    const magicSessionCookie = callback.headers.getSetCookie()
      .find((value) => value.startsWith("digit_identity_session="))!
      .split(";", 1)[0];
    // The mock access token expires immediately. Refresh proves the session
    // retained the magic-link client instead of falling back to the password client.
    const magicSession = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/session`,
      { headers: { Cookie: magicSessionCookie } },
    );
    expect(magicSession.status).toBe(200);
    expect(await magicSession.json()).toMatchObject({
      user: { name: "Demo Person" },
    });
    const magicUser = await (
      await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/identity-user-1`)
    ).json();
    expect(magicUser).toMatchObject({
      email: "person@example.com",
      emailVerified: true,
      firstName: "Demo",
      lastName: "Person",
    });

    await kcAdmin("/users", {
      id: "unverified-provider-user",
      username: "unverified.provider@example.com",
      email: "unverified.provider@example.com",
      firstName: "Provider",
      lastName: "Claim",
      enabled: true,
      emailVerified: false,
      federatedIdentities: [{ identityProvider: "github", userId: "github-unverified" }],
    });
    const linksBeforeUnverifiedAttempt = magicRequests.length;
    await fetch(`${config.keycloakAdminUrl}/__test/admin-log`, { method: "DELETE" });
    const unverifiedProviderAttempt = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authentication/magic-link-requests`,
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.32",
        },
        body: JSON.stringify({
          firstName: "Mailbox",
          lastName: "Owner",
          email: "unverified.provider@example.com",
        }),
      },
    );
    expect(unverifiedProviderAttempt.status).toBe(202);
    await expect.poll(async () => {
      const log = await (
        await fetch(`${config.keycloakAdminUrl}/__test/admin-log`)
      ).json() as string[];
      return log.filter((entry) => entry.endsWith("/users")).length;
    }).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await (
      await fetch(`${config.keycloakAdminUrl}/__test/magic-links`)
    ).json() as Array<Record<string, unknown>>)).toHaveLength(linksBeforeUnverifiedAttempt);

    const newIdentity = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authentication/magic-link-requests`,
      {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
          "X-Forwarded-For": "203.0.113.31",
        },
        body: JSON.stringify({
          firstName: "New",
          lastName: "Founder",
          email: "new.founder@example.com",
        }),
      },
    );
    expect(newIdentity.status).toBe(202);
    let createdUsers: Array<Record<string, unknown>> = [];
    await expect.poll(async () => {
      createdUsers = await (
        await fetch(
          `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users?email=new.founder%40example.com&exact=true`,
        )
      ).json() as Array<Record<string, unknown>>;
      return createdUsers.length;
    }).toBe(1);
    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0]).toMatchObject({
      email: "new.founder@example.com",
      firstName: "New",
      lastName: "Founder",
      emailVerified: false,
      enabled: true,
      attributes: { "digit.identityBffSignup": ["true"] },
    });
  });

  it("returns provider failures through a one-time, browser-safe result", async () => {
    const authorize = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=google&intent=signin&returnTo=%2Fclient%2Flogin`,
      { redirect: "manual" },
    );
    const authorizeUrl = new URL(authorize.headers.get("location")!);
    const state = authorizeUrl.searchParams.get("state")!;
    const loginCookie = authorize.headers.get("set-cookie")!.split(";", 1)[0];
    const callback = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      { redirect: "manual", headers: { Cookie: loginCookie } },
    );
    expect(callback.status).toBe(303);
    const resultLocation = new URL(callback.headers.get("location")!, "http://localhost");
    expect(resultLocation.pathname).toBe("/client/login");
    const id = resultLocation.searchParams.get("authResult")!;
    const result = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(id)}`,
    );
    expect(await result.json()).toEqual({
      status: "failed",
      code: "AUTH_CANCELLED",
      message: "Sign-in was cancelled. No changes were made to your account.",
      actions: ["TRY_AGAIN"],
    });
    expect((await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(id)}`,
    )).status).toBe(404);

    const conflictAuthorize = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=google&returnTo=%2Fclient%2Flogin`,
      { redirect: "manual" },
    );
    const conflictUrl = new URL(conflictAuthorize.headers.get("location")!);
    const conflictState = conflictUrl.searchParams.get("state")!;
    const conflictCookie = conflictAuthorize.headers.get("set-cookie")!.split(";", 1)[0];
    const conflict = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/callback?error=account_exists&error_description=existing%20account&state=${encodeURIComponent(conflictState)}`,
      { redirect: "manual", headers: { Cookie: conflictCookie } },
    );
    const conflictLocation = new URL(conflict.headers.get("location")!, "http://localhost");
    const conflictResult = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(conflictLocation.searchParams.get("authResult")!)}`,
    );
    expect(await conflictResult.json()).toMatchObject({
      code: "ACCOUNT_LINK_REQUIRED",
      actions: ["TRY_EXISTING_METHOD", "SETUP_PASSWORD"],
    });
  });

  it("offers non-enumerating, one-time password setup for OAuth accounts", async () => {
    await kcAdmin("/users", {
      id: "oauth-only-user", username: "oauth.only@example.com", email: "oauth.only@example.com",
      firstName: "OAuth", lastName: "Only", enabled: true, emailVerified: true,
      credentials: [],
      federatedIdentities: [{ identityProvider: "google", userId: "google-user-1" }],
    });
    const endpoint = `http://localhost:${getAppPort()}/identity/v1/password/setup-requests`;
    const requestSetup = (email: string) => fetch(endpoint, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.10",
      },
      body: JSON.stringify({ email, returnTo: "/client/login" }),
    });
    const accepted = await requestSetup("OAUTH.ONLY@example.com");
    expect(accepted.status).toBe(202);
    const genericBody = await accepted.json();
    expect(genericBody).toEqual({
      message: "If an eligible account exists, a password setup email has been sent.",
    });
    const absent = await requestSetup("nobody@example.com");
    expect(absent.status).toBe(202);
    expect(await absent.json()).toEqual(genericBody);

    let user: any;
    await expect.poll(async () => {
      user = await (await fetch(
        `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/oauth-only-user`,
      )).json();
      return user.activationEmails;
    }).toBe(1);
    expect(user.requiredActions).toEqual(["UPDATE_PASSWORD"]);
    const completion = new URL(user.lastActionRedirectUri);
    expect(completion.pathname).toMatch(/^\/identity\/v1\/password\/setup-complete\/[^/]+$/);
    expect(completion.search).toBe("");
    const completionUnderTest = new URL(
      `${completion.pathname}${completion.search}`,
      `http://localhost:${getAppPort()}`,
    );
    // Keycloak's execute-actions flow does not append a success flag. The
    // callback proves completion for resets, while a first password is also
    // checked against the credential Admin API.
    expect((await kcUpdate("/users/oauth-only-user", {
      credentials: [{ id: "password-1", type: "password" }],
    })).status).toBe(204);
    const complete = await fetch(completionUnderTest, { redirect: "manual" });
    expect(complete.status).toBe(303);
    const completeLocation = new URL(complete.headers.get("location")!, "http://localhost");
    expect(completeLocation.pathname).toBe("/client/login");
    const resultId = completeLocation.searchParams.get("authResult")!;
    const result = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(resultId)}`,
    );
    expect(await result.json()).toMatchObject({
      status: "complete",
      code: "PASSWORD_SETUP_COMPLETE",
    });

    const replay = await fetch(completionUnderTest, { redirect: "manual" });
    expect(replay.status).toBe(303);
    const replayLocation = new URL(replay.headers.get("location")!, "http://localhost");
    const replayResult = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(replayLocation.searchParams.get("authResult")!)}`,
    );
    expect(await replayResult.json()).toMatchObject({ code: "AUTH_ATTEMPT_EXPIRED" });

    expect((await kcUpdate("/users/oauth-only-user", { credentials: [] })).status).toBe(204);
    expect((await requestSetup("oauth.only@example.com")).status).toBe(202);
    let retryUser: any;
    await expect.poll(async () => {
      retryUser = await (await fetch(
        `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/oauth-only-user`,
      )).json();
      return retryUser.activationEmails;
    }).toBe(2);
    const cancelledCompletion = new URL(retryUser.lastActionRedirectUri);
    const cancelledUnderTest = new URL(
      `${cancelledCompletion.pathname}${cancelledCompletion.search}`,
      `http://localhost:${getAppPort()}`,
    );
    const cancelled = await fetch(cancelledUnderTest, { redirect: "manual" });
    const cancelledLocation = new URL(cancelled.headers.get("location")!, "http://localhost");
    const cancelledResult = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(cancelledLocation.searchParams.get("authResult")!)}`,
    );
    expect(await cancelledResult.json()).toMatchObject({
      status: "failed",
      code: "PASSWORD_SETUP_FAILED",
      actions: ["SETUP_PASSWORD"],
    });

    await kcAdmin("/users", {
      id: "unverified-provider-user",
      username: "unverified.provider@example.com",
      email: "unverified.provider@example.com",
      enabled: true,
      emailVerified: false,
      credentials: [],
      federatedIdentities: [{ identityProvider: "github", userId: "github-user-1" }],
    });
    const anonymousUnverified = await fetch(endpoint, {
      method: "POST",
      headers: {
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.11",
      },
      body: JSON.stringify({
        email: "unverified.provider@example.com",
        returnTo: "/client/login",
      }),
    });
    expect(anonymousUnverified.status).toBe(202);
    await expect.poll(async () => {
      const log = await (await fetch(`${config.keycloakAdminUrl}/__test/admin-log`)).json() as string[];
      return log.some((entry) => entry ===
        `GET /admin/realms/${config.keycloakOrganizationRealm}/users/unverified-provider-user/federated-identity`);
    }).toBe(true);
    const unverifiedBeforeAuthentication = await (await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/unverified-provider-user`,
    )).json();
    expect(unverifiedBeforeAuthentication.activationEmails).toBeUndefined();

    const { sessionId } = await createIdentitySession({
      accessToken: "unverified-provider-session",
      accessExpiresIn: 3600,
    }, {
      sub: "unverified-provider-user",
      email: "unverified.provider@example.com",
      email_verified: false,
    }, "digit-identity-bff");
    const authenticatedSetup = await fetch(endpoint, {
      method: "POST",
      headers: {
        Cookie: `${config.identityCookieName}=${sessionId}`,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.12",
      },
      body: JSON.stringify({ returnTo: "/client/login" }),
    });
    expect(authenticatedSetup.status).toBe(202);
    await expect.poll(async () => {
      const authenticatedUser = await (await fetch(
        `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/unverified-provider-user`,
      )).json();
      return authenticatedUser.activationEmails;
    }).toBe(1);
  });

  it("does not accept a browser-supplied Keycloak token as a session", async () => {
    const response = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/tenants`,
      { headers: { Authorization: "Bearer browser-token" } },
    );
    expect(response.status).toBe(401);
  });

  it("completes sign-in, refreshes server-side, lists tenants, and logs out", async () => {
    const controlBase = `http://localhost:${getAppPort()}/internal/identity/v1`;
    const controlHeaders = {
      Authorization: "Bearer test-control-plane",
      "Content-Type": "application/json",
    };
    const ensure = (path: string, body: unknown) => fetch(`${controlBase}${path}`, {
      method: "POST", headers: controlHeaders, body: JSON.stringify(body),
    });
    for (const [organizationId, groupName, role] of [
      ["org-bomet-id", "bomet-officers", "GRO"],
      ["org-kisumu-id", "kisumu-viewers", "PGR_VIEWER"],
    ]) {
      await legacyMembershipFixture(organizationId, "identity-user-1", "0712345678");
      const assignment = await ensure("/role-assignments/_ensure", {
        organizationId, userId: "identity-user-1", groupName,
        clientId: "digit-ui", roles: [role],
      });
      expect(assignment.status).toBe(200);
    }

    const authorize = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=google`,
      {
        redirect: "manual",
        headers: { Origin: "http://localhost:3000" },
      },
    );
    expect(authorize.status).toBe(302);
    expect(authorize.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000",
    );
    expect(authorize.headers.get("access-control-allow-credentials")).toBe("true");

    const localhost5173 = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods`,
      { headers: { Origin: "http://localhost:5173" } },
    );
    expect(localhost5173.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173",
    );
    const authorizeUrl = new URL(authorize.headers.get("location")!);
    expect(authorizeUrl.origin).toBe(new URL(getIssuer()).origin);
    expect(authorizeUrl.searchParams.get("client_id")).toBe("digit-identity-bff");
    expect(authorizeUrl.searchParams.get("scope")).toContain("organization:*");
    expect(authorizeUrl.searchParams.get("kc_idp_hint")).toBe("google");
    expect(authorizeUrl.searchParams.get("nonce")).toBeTruthy();
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.has("client_secret")).toBe(false);
    const state = authorizeUrl.searchParams.get("state")!;
    const loginCookie = authorize.headers.get("set-cookie")!.split(";", 1)[0];

    const unboundCallback = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/callback?code=valid-code:${encodeURIComponent(authorizeUrl.searchParams.get("nonce")!)}&state=${encodeURIComponent(state)}`,
      { redirect: "manual" },
    );
    expect(unboundCallback.status).toBe(303);
    const unboundLocation = new URL(unboundCallback.headers.get("location")!, "http://localhost");
    expect(unboundLocation.pathname).toBe("/after-login");
    const unboundResult = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(unboundLocation.searchParams.get("authResult")!)}`,
    );
    expect(await unboundResult.json()).toMatchObject({ code: "SIGN_IN_FAILED" });

    const callback = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/callback?code=valid-code:${encodeURIComponent(authorizeUrl.searchParams.get("nonce")!)}&state=${encodeURIComponent(state)}`,
      { redirect: "manual", headers: { Cookie: loginCookie } },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/after-login");
    const setCookies = callback.headers.getSetCookie();
    const sessionSetCookie = setCookies.find((value) =>
      value.startsWith("digit_identity_session="),
    )!;
    expect(sessionSetCookie).toContain("HttpOnly");
    expect(sessionSetCookie).toContain("SameSite=Lax");
    expect(setCookies.join(";")).not.toContain("eyJ");
    const cookie = sessionSetCookie.split(";", 1)[0];

    const replay = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/callback?code=valid-code:${encodeURIComponent(authorizeUrl.searchParams.get("nonce")!)}&state=${encodeURIComponent(state)}`,
      { redirect: "manual", headers: { Cookie: loginCookie } },
    );
    expect(replay.status).toBe(303);
    const replayLocation = new URL(replay.headers.get("location")!, "http://localhost");
    const replayResult = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-results/${encodeURIComponent(replayLocation.searchParams.get("authResult")!)}`,
    );
    expect(await replayResult.json()).toMatchObject({ code: "AUTH_ATTEMPT_EXPIRED" });

    // The first token expires immediately in the mock. Reading the session
    // exercises refresh without exposing either Keycloak token to the browser.
    const session = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/session`,
      { headers: { Cookie: cookie } },
    );
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      authenticated: true,
      user: {
        id: "identity-user-1",
        email: "person@example.com",
        name: "Demo Person",
      },
      context: null,
    });

    const introspection = await fetch(
      `http://localhost:${getAppPort()}/internal/identity/v1/sessions/_introspect`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-session-introspection",
          Cookie: cookie,
        },
      },
    );
    expect(introspection.status).toBe(200);
    expect(await introspection.json()).toEqual({
      active: true,
      identity: {
        issuer: getIssuer(),
        subject: "identity-user-1",
        email: "person@example.com",
        emailVerified: true,
        name: "Demo Person",
        preferredUsername: "demo.person",
      },
    });

    const tenants = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/tenants`,
      {
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
        },
      },
    );
    expect(tenants.status).toBe(200);
    expect(tenants.headers.get("access-control-allow-credentials")).toBe("true");
    expect(await tenants.json()).toEqual({
      tenants: [
        {
          tenantId: "ke.bomet",
          name: "Bomet County",
          organizationAlias: "bomet",
          roles: ["EMPLOYEE", "GRO"],
        },
        {
          tenantId: "ke.bomet.ulb1",
          name: "Bomet ULB One",
          organizationAlias: "bomet",
          roles: ["EMPLOYEE", "GRO"],
        },
        {
          tenantId: "ke.kisumu",
          name: "Kisumu County",
          organizationAlias: "kisumu",
          roles: ["EMPLOYEE", "PGR_VIEWER"],
        },
      ],
      selectionRequired: true,
      onboardingRequired: false,
    });

    const crossOriginSelect = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/contexts/_select`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "https://attacker.example",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: "ke.bomet" }),
      },
    );
    expect(crossOriginSelect.status).toBe(403);

    const unavailable = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/contexts/_select`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "ke.unmapped" }),
      },
    );
    expect(unavailable.status).toBe(403);

    const passwordUpdatesBeforeSelect = digit.stats.passwordUpdates;
    const selected = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/contexts/_select`,
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: "ke.bomet" }),
      },
    );
    expect(selected.status).toBe(200);
    const selectedBody = await selected.json();
    const managed = [...digit.accounts.values()].find((candidate) =>
      candidate.name === "Demo Person" && candidate.tenantId === "ke.bomet")!;
    expect(managed.identificationMark).toMatch(/^keycloak-bff:v1:/);
    expect(digit.tokens.get(selectedBody.access_token)?.uuid).toBe(managed.uuid);
    expect(Object.keys(selectedBody).sort()).toEqual(
      ["UserRequest", "access_token", "expires_in", "scope", "token_type"],
    );
    expect(selectedBody).toMatchObject({
      token_type: "bearer",
      UserRequest: { uuid: managed.uuid, userName: managed.userName, type: "EMPLOYEE" },
    });
    expect(JSON.stringify(selectedBody)).not.toMatch(/eyJ[A-Za-z0-9_-]+\./);
    expect(selectedBody.expires_in).toBeGreaterThan(0);
    expect(JSON.stringify(selectedBody)).not.toContain("refresh_token");
    expect(JSON.stringify(selectedBody)).not.toContain("must-not-leak");
    // A revoked cached token is renewed by rotating the BFF-only password once.
    expect(digit.stats.passwordUpdates - passwordUpdatesBeforeSelect).toBeLessThanOrEqual(1);

    const selectedSession = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/session`,
      { headers: { Cookie: cookie } },
    );
    expect(await selectedSession.json()).toMatchObject({
      context: { tenantId: "ke.bomet", name: "Bomet County", organizationAlias: "bomet" },
    });

    // Session claims never re-grant roles DIGIT no longer holds.
    const managedAccount = [...digit.accounts.values()].find((candidate) =>
      candidate.name === "Demo Person" && candidate.tenantId === "ke.kisumu")!;
    const grantedRoles = managedAccount.roles;
    managedAccount.roles = [];
    const staleClaims = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/tenants`,
      { headers: { Cookie: cookie } },
    );
    expect((await staleClaims.json()).tenants.map((tenant: { tenantId: string }) => tenant.tenantId))
      .toEqual(["ke.bomet", "ke.bomet.ulb1"]);
    expect(managedAccount.roles.some((role) => role.tenantId === "ke.kisumu")).toBe(false);
    managedAccount.roles = grantedRoles;

    // Onboarding can add membership after the access token was issued. Tenant
    // discovery reads that membership live, so the browser need not sign in again.
    await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/organizations/${nakuruOrganizationId}/members`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify("identity-user-1") },
    );
    await legacyMembershipFixture(nakuruOrganizationId, "identity-user-1", "0712345678");
    expect((await ensure("/role-assignments/_ensure", {
      organizationId: nakuruOrganizationId,
      userId: "identity-user-1",
      groupName: "nakuru-officers",
      clientId: "digit-ui",
      roles: ["GRO"],
    })).status).toBe(200);
    const lateMembership = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/tenants`,
      { headers: { Cookie: cookie } },
    );
    expect((await lateMembership.json()).tenants.map((tenant: { tenantId: string }) => tenant.tenantId).sort())
      .toEqual(["ke.bomet", "ke.bomet.ulb1", "ke.kisumu", "ke.nakuru"]);

    // Membership is rechecked live in Keycloak, not only from session claims.
    await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/organizations/org-kisumu-id/members/identity-user-1`,
      { method: "DELETE" },
    );
    const revoked = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/contexts/_select`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "ke.kisumu" }),
      },
    );
    expect(revoked.status).toBe(403);

    // Reconcile never deactivates a DIGIT account, including after Redis loss.
    // HRMS owns active; membership removal is an identity access/revocation gate.
    await getRedis().del(managedAccountsKey());
    const reconciled = await ensure("/reconciliation/_run", {});
    expect(reconciled.status).toBe(200);
    expect(managedAccount.active).toBe(true);

    // Re-selecting the same tenant is the renewal operation.
    const renewed = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/contexts/_select`,
      {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: "ke.bomet" }),
      },
    );
    expect(renewed.status).toBe(200);
    expect((await renewed.json()).access_token).toBe(selectedBody.access_token);

    const logout = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/logout`,
      { method: "POST", headers: { Cookie: cookie } },
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(digit.tokens.has(selectedBody.access_token)).toBe(false);

    const afterLogout = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/session`,
      { headers: { Cookie: cookie } },
    );
    expect(afterLogout.status).toBe(401);
  });

  it("selects a tenant without reading other Organizations or other members", async () => {
    const control = (path: string, body: unknown) => fetch(
      `http://localhost:${getAppPort()}/internal/identity/v1${path}`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-control-plane",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    // A crowd in the same Organization: each member carries its own assignment
    // group, which is what used to make one login cost admin calls in
    // proportion to the realm's size. (Dhruv review, #2088.)
    const crowd: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const created = await kcAdmin("/users", {
        username: `crowd-${index}@example.org`, email: `crowd-${index}@example.org`,
        firstName: "Crowd", lastName: `${index}`, emailVerified: true,
      });
      const userId = created.headers.get("location")!.split("/").pop()!;
      crowd.push(userId);
      await legacyMembershipFixture("org-bomet-id", userId, "0712345678");
      expect((await control("/role-assignments/_ensure", {
        organizationId: "org-bomet-id", userId, groupName: "bomet-officers",
        clientId: "digit-ui", roles: ["GRO"],
      })).status).toBe(200);
    }

    const { sessionId } = await createIdentitySession({
      accessToken: "server-side-test-token", accessExpiresIn: 3600,
    }, { sub: "identity-user-1", email: "person@example.com", name: "Demo Person" },
    "digit-identity-bff");

    await fetch(`${config.keycloakAdminUrl}/__test/admin-log`, { method: "DELETE" });
    const selected = await withoutSubjectReconciliation(() => fetch(
      `http://localhost:${getAppPort()}/identity/v1/contexts/_select`,
      {
        method: "POST",
        headers: {
          Cookie: `${config.identityCookieName}=${sessionId}`,
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId: "ke.bomet" }),
      },
    ));
    expect(selected.status).toBe(200);

    const log = await (await fetch(`${config.keycloakAdminUrl}/__test/admin-log`)).json() as string[];
    // The Organization mapped to another tenant is never opened.
    expect(log.filter((entry) => entry.includes("org-kisumu-id"))).toEqual([]);
    // Nor is any other member's assignment group, or the Organization's full
    // member roster.
    for (const userId of crowd) {
      expect(log.filter((entry) => entry.includes(userId))).toEqual([]);
    }
    expect(log.filter((entry) => /\/organizations\/[^/]+\/members$/.test(entry))).toEqual([]);
    expect(log.some((entry) =>
      entry === "GET /admin/realms/digit-sandbox/organizations/org-bomet-id/members/identity-user-1",
    )).toBe(true);
  });

  it("lets a live Organization admin invite and provision an employee", async () => {
    const { sessionId } = await createIdentitySession({
      accessToken: "server-side-test-token",
      accessExpiresIn: 3600,
    }, {
      sub: "identity-user-1",
      email: "person@example.com",
      name: "Demo Person",
    }, "digit-identity-bff");
    await saveSelectedIdentityContext(sessionId, {
      organizationId: "org-bomet-id",
      organizationAlias: "bomet",
      tenantId: "ke.bomet",
      name: "Bomet County",
    });
    const cookie = `${config.identityCookieName}=${sessionId}`;
    const endpoint = `http://localhost:${getAppPort()}/identity/v1/organization-members/_invite`;
    const body = {
      email: "new.employee@example.com",
      name: "New Employee",
      mobileNumber: "0723456789",
      countryCode: "254",
      roles: ["GRO"],
    };
    const invite = (overrides: Record<string, unknown> = {}, origin = "http://localhost:3000") =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...body, ...overrides }),
      });

    expect((await invite()).status).toBe(403);
    expect((await invite({}, "https://attacker.example")).status).toBe(403);

    const controlResponse = await fetch(
      `http://localhost:${getAppPort()}/internal/identity/v1/role-assignments/_ensure`,
      {
        method: "POST",
        headers: {
          Authorization: "Bearer test-control-plane",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "org-bomet-id",
          userId: "identity-user-1",
          groupName: "organization-admins",
          clientId: "digit-ui",
          roles: ["TENANT_ADMIN"],
        }),
      },
    );
    expect(controlResponse.status).toBe(200);
    expect((await invite({ roles: ["NOT_ALLOWED"] })).status).toBe(400);

    const created = await invite();
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    expect(createdBody).toMatchObject({
      member: {
        organizationId: "org-bomet-id",
        tenantId: "ke.bomet",
        email: "new.employee@example.com",
        name: "New Employee",
        roles: ["EMPLOYEE", "GRO"],
      },
      identityUserCreated: true,
      digitAccountCreated: true,
      activationEmailSent: true,
    });
    expect(createdBody.member.identityUserId).toBeTruthy();
    expect(createdBody.member.digitUserUuid).toBeTruthy();

    const users = await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}` +
        "/users?email=new.employee%40example.com&exact=true",
    );
    const [identityUser] = await users.json() as Array<{
      id: string;
      requiredActions: string[];
      activationEmails: number;
    }>;
    expect(identityUser.id).toBe(createdBody.member.identityUserId);
    expect(identityUser.requiredActions.sort()).toEqual(["UPDATE_PASSWORD", "VERIFY_EMAIL"]);
    expect(identityUser.activationEmails).toBe(1);
    expect((await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}` +
        `/organizations/org-bomet-id/members/${identityUser.id}`,
    )).status).toBe(200);

    const account = digit.accounts.get(createdBody.member.digitUserUuid)!;
    expect(account).toMatchObject({
      name: "New Employee",
      mobileNumber: "0723456789",
      countryCode: "254",
      tenantId: "ke.bomet",
      active: true,
    });

    const repeated = await invite();
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({
      member: {
        identityUserId: identityUser.id,
        digitUserUuid: account.uuid,
      },
      identityUserCreated: false,
      digitAccountCreated: false,
      activationEmailSent: true,
    });
  });
});

describe("digit-ui employee and citizen surfaces (#2167)", () => {
  const app = () => `http://localhost:${getAppPort()}`;
  const cookieFrom = (response: Response, name: string) => response.headers.getSetCookie()
    .find((value) => value.startsWith(`${name}=`))?.split(";", 1)[0];

  async function startSignIn(query: string): Promise<{
    url: URL;
    state: string;
    nonce: string;
    loginCookie: string;
  }> {
    const authorize = await fetch(`${app()}/identity/v1/authorize?${query}`, { redirect: "manual" });
    expect(authorize.status).toBe(302);
    const url = new URL(authorize.headers.get("location")!);
    return {
      url,
      state: url.searchParams.get("state")!,
      nonce: url.searchParams.get("nonce")!,
      loginCookie: authorize.headers.get("set-cookie")!.split(";", 1)[0],
    };
  }

  async function signIn(
    surface: "employee" | "citizen",
    profile = "",
    returnTo = `/bomet-county/digit-ui/${surface}/`,
    tenantSlug = "bomet-county",
  ): Promise<string> {
    // D10 reads verified phone state from Keycloak, not only the token fixture.
    if (surface === "citizen" && !profile.startsWith("legacy")) {
      const subject = profile === "other" ? "citizen-user-2" : "citizen-user-1";
      const user = await (await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/${subject}`)).json();
      const phone = profile === "other" ? "+254722000111" : profile === "newphone" ? "+254712345679" : profile === "foreign" ? "+14155550100" : "+254712345678";
      await kcUpdate(`/users/${subject}`, { attributes: { ...user.attributes,
        phoneNumber: [phone], phoneNumberVerified: [profile === "unverified" ? "false" : "true"] } });
    }
    const { state, nonce, loginCookie } = await startSignIn(
      `surface=${surface}&tenantSlug=${tenantSlug}&returnTo=${encodeURIComponent(returnTo)}`,
    );
    const callback = await fetch(
      `${app()}/identity/v1/callback?code=valid-code${profile ? `-${profile}` : ""}:${encodeURIComponent(nonce)}&state=${encodeURIComponent(state)}`,
      { redirect: "manual", headers: { Cookie: loginCookie } },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe(returnTo);
    return cookieFrom(callback, `digit_identity_session_${surface}`)!;
  }

  const citizenSelect = (cookie: string, body: unknown = {}, origin = "http://localhost:3000") =>
    fetch(`${app()}/identity/v1/contexts/citizen/_select`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    resetIdentityMethodCatalog();
    for (const [id, phone, name] of [
      ["citizen-user-1", "+254712345678", "Wanjiku"],
      ["citizen-user-2", "+254722000111", "Second"],
    ]) {
      await kcAdmin("/users", {
        id, username: phone, firstName: name, enabled: true,
        attributes: { phoneNumber: [phone], phoneNumberVerified: ["true"] },
      });
    }
    const record = (tenantId: string, schemaCode: string, data: unknown, uid = schemaCode) => ({
      tenantId, schemaCode, uniqueIdentifier: uid, data, isActive: true,
    });
    digit.mdms.set(digit.mdmsKey("ke.bomet", "common-masters.StateInfo"), [record(
      "ke.bomet", "common-masters.StateInfo", {
        code: "ke.bomet", name: "Bomet", logoUrl: "https://cdn.example/logo.png",
        logoUrlWhite: "https://cdn.example/logo-white.png", bannerUrl: "https://cdn.example/banner.jpg",
        languages: [{ label: "ENGLISH", value: "en_IN" }, { label: "KISWAHILI", value: "sw_KE" }],
        localizationModules: [{ label: "rainmaker-common", value: "rainmaker-common" }],
      },
    )]);
    digit.mdms.set(digit.mdmsKey("ke.bomet", "common-masters.ThemeConfig"), [record(
      "ke.bomet", "common-masters.ThemeConfig", { code: "default", version: 3, colors: { primary: "#c84c0e" } },
    )]);
    digit.mdms.set(digit.mdmsKey("ke.bomet", "common-masters.MobileNumberValidation"), [
      record("ke.bomet", "common-masters.MobileNumberValidation", {
        validationName: "inactive", countryCode: "+1", mobileNumberRegex: "^.*$", default: true,
      }, "mnv-inactive"),
      record("ke.bomet", "common-masters.MobileNumberValidation", {
        validationName: "kenya", countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$",
        errorMessage: "MOBILE_VALIDATION_KE", default: true,
      }, "mnv-kenya"),
    ]);
    digit.mdms.get(digit.mdmsKey("ke.bomet", "common-masters.MobileNumberValidation"))![0].isActive = false;
    digit.mdms.set(digit.mdmsKey("ke.bomet", "commonMDMSConfig.LoginConfig"), [record(
      "ke.bomet", "commonMDMSConfig.LoginConfig", {
        bannerImages: [{ id: 1, image: "https://cdn.example/b1.png", title: "BOMET_BANNER_TITLE" }],
        texts: { header: "CORE_COMMON_LOGIN" },
      },
    )]);
    digit.mdms.set(digit.mdmsKey("ke.bomet", "commonMDMSConfig.PrivacyPolicy"), [record(
      "ke.bomet", "commonMDMSConfig.PrivacyPolicy", {
        module: "HCM", header: "ES_PRIVACY_POLICY_HEADER", contents: [{ header: "ES_PRIVACY_SECTION_1" }],
      },
    )]);
    for (const [tenantId, module, code, message] of [
      ["ke.bomet", "rainmaker-common", "CORE_COMMON_LOGIN", "Login"],
      ["ke.bomet", "rainmaker-common", "CS_LOGIN_OTP", "Enter OTP"],
      ["ke.bomet", "rainmaker-common", "ES_PRIVACY_POLICY_HEADER", "Privacy"],
      ["ke.bomet", "rainmaker-common", "UNRELATED_SCREEN_KEY", "Not a login key"],
      ["ke.bomet", "digit-ui", "MOBILE_VALIDATION_KE", "Enter 9 digits"],
      ["ke.bomet", "digit-tenants", "TENANT_TENANTS_KE_BOMET", "Bomet County Government"],
      ["ke.bomet", "rainmaker-ke.bomet", "CS_LOGIN_TEXT", "Bomet citizens"],
      ["ke.bomet", "other-module", "CORE_LOGIN_USERNAME", "Must not be read"],
      ["ke.bomet.ulb1", "rainmaker-ke.bomet.ulb1", "CORE_COMMON_LOGIN", "Ingia"],
      ["ke.bomet", "rainmaker-ke.bomet", "BOMET_BANNER_TITLE", "Report it"],
      ["ke.bomet", "rainmaker-common", "ES_PRIVACY_POLICY", "Privacy Policy"],
    ]) {
      digit.localization.push({ tenantId, locale: "en_IN", module, code, message });
    }
    digit.localization.push({
      tenantId: "ke.bomet", locale: "fr_FR", module: "rainmaker-common",
      code: "CORE_COMMON_LOGIN", message: "Connexion",
    });
  });

  it("does not serve the retired branding relay", async () => {
    expect((await fetch(`${app()}/identity/v1/tenant-contexts/bomet-county/branding`)).status).toBe(404);
  });

  it("discovers each surface's methods from its own Keycloak client", async () => {
    const methods = async (query: string) => {
      const response = await fetch(`${app()}/identity/v1/auth-methods?${query}`);
      expect(response.status).toBe(200);
      return (await response.json()).methods;
    };
    expect(await methods("surface=employee")).toEqual([
      { id: "password", labelKey: "IDENTITY_METHOD_PASSWORD", type: "password", intents: ["signin"] },
    ]);
    expect(await methods("surface=employee&intent=signup")).toEqual([]);
    expect(await methods("surface=citizen")).toEqual([
      { id: "password", labelKey: "IDENTITY_METHOD_PASSWORD", type: "password", intents: ["signin"] },
    ]);
    expect(await methods("surface=citizen&intent=signup")).toEqual([]);
    expect((await methods("")).map((method: { id: string }) => method.id))
      .toEqual(["password", "google", "github"]);
    expect((await fetch(`${app()}/identity/v1/auth-methods?surface=admin`)).status).toBe(400);
  });

  it("sends an employee's password-setup email through the employee client and returns to that tenant (item 5)", async () => {
    await kcAdmin("/users", {
      id: "employee-setup-user", username: "employee.setup@example.com", email: "employee.setup@example.com",
      firstName: "Employee", lastName: "Setup", enabled: true, emailVerified: true,
      credentials: [{ id: "password-employee-setup", type: "password" }],
    });
    const route = contractRoute("POST", "/identity/v1/password/setup-requests");
    const requestSetup = (body: Record<string, unknown>) => fetch(`${app()}/identity/v1/password/setup-requests`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.31" },
      body: JSON.stringify({ email: "employee.setup@example.com", ...body }),
    });

    await expectContractError(await requestSetup({ surface: "admin" }), route, "UNSUPPORTED_SURFACE");
    await expectContractError(await requestSetup({ surface: "employee" }), route, "INVALID_REQUEST");
    await expectContractError(await requestSetup({ surface: "employee", tenantSlug: "missing-county" }), route, "TENANT_ROUTE_NOT_FOUND");
    for (const returnTo of ["/bomet-county/digit-ui/citizen/", "/configurator/", "/bomet-county/digit-ui/employee/../citizen/"]) {
      await expectContractError(
        await requestSetup({ surface: "employee", tenantSlug: "bomet-county", returnTo }), route, "UNSUPPORTED_RETURN_TO");
    }

    const accepted = await requestSetup({
      surface: "employee", tenantSlug: "bomet-county", returnTo: "/bomet-county/digit-ui/employee/login",
    });
    expect(accepted.status).toBe(202);
    let user: any;
    await expect.poll(async () => {
      user = await (await fetch(
        `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/employee-setup-user`,
      )).json();
      return user.activationEmails;
    }).toBe(1);
    // The employee client's theme renders the Keycloak action pages.
    expect(user.lastActionClientId).toBe("digit-ui-employee");

    expect((await kcUpdate("/users/employee-setup-user", {
      credentials: [{ id: "password-employee-setup-2", type: "password" }],
    })).status).toBe(204);
    const completion = new URL(user.lastActionRedirectUri);
    const complete = await fetch(`${app()}${completion.pathname}`, { redirect: "manual" });
    expect(complete.status).toBe(303);
    const location = new URL(complete.headers.get("location")!, "http://localhost");
    expect(location.pathname).toBe("/bomet-county/digit-ui/employee/login");
    const result = await fetch(`${app()}/identity/v1/auth-results/${encodeURIComponent(location.searchParams.get("authResult")!)}`);
    expect(await result.json()).toMatchObject({ status: "complete", code: "PASSWORD_SETUP_COMPLETE" });

    // Without a surface the configurator client is used, as before.
    expect((await requestSetup({ returnTo: "/client/login" })).status).toBe(202);
    await expect.poll(async () => {
      user = await (await fetch(
        `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/employee-setup-user`,
      )).json();
      return user.activationEmails;
    }).toBe(2);
    expect(user.lastActionClientId).toBe("digit-identity-bff");
  });

  it("binds employee/citizen authorization to the route tenant", async () => {
    const authorize = (query: string) =>
      fetch(`${app()}/identity/v1/authorize?${query}`, { redirect: "manual" });
    expect((await authorize("surface=employee")).status).toBe(400);
    expect((await authorize("surface=admin&tenantSlug=bomet-county")).status).toBe(400);
    expect((await authorize("tenantSlug=bomet-county&method=password")).status).toBe(400);
    expect((await authorize("surface=employee&tenantSlug=missing-county")).status).toBe(404);
    expect((await authorize("surface=employee&tenantSlug=bomet-county&method=google")).status).toBe(400);
    expect((await authorize("surface=citizen&tenantSlug=bomet-county&method=google")).status).toBe(400);
    for (const returnTo of [
      "/bomet-county/digit-ui/citizen/",
      "/other-county/digit-ui/employee/",
      "/bomet-county/digit-ui/employee",
      "/bomet-county/digit-ui/employee/../citizen/home",
      "/bomet-county/digit-ui/employee/%2e%2e/citizen/home",
      "//attacker.example/bomet-county/digit-ui/employee/",
      "http://localhost:3000/bomet-county/digit-ui/employee/",
    ]) {
      expect((await authorize(
        `surface=employee&tenantSlug=bomet-county&returnTo=${encodeURIComponent(returnTo)}`,
      )).status, returnTo).toBe(400);
    }

    const employee = await startSignIn(
      "surface=employee&tenantSlug=bomet-county&ui_locales=sw_KE" +
      `&returnTo=${encodeURIComponent("/bomet-county/digit-ui/employee/pgr/inbox?x=1")}`,
    );
    expect(employee.url.searchParams.get("client_id")).toBe("digit-ui-employee");
    expect(employee.url.searchParams.get("scope")).toBe("openid profile email");
    expect(employee.url.searchParams.get("digit_tenant")).toBe("bomet-county");
    expect(employee.url.searchParams.get("prompt")).toBe("login");
    expect(employee.url.searchParams.get("ui_locales")).toBe("sw_KE");
    expect(employee.url.searchParams.has("kc_idp_hint")).toBe(false);
    expect(employee.loginCookie).toMatch(/^digit_identity_session_employee_login=/);

    const citizen = await startSignIn("surface=citizen&tenantSlug=Bomet-County");
    expect(citizen.url.searchParams.get("client_id")).toBe("digit-ui-citizen");
    expect(citizen.url.searchParams.get("scope")).toBe("openid profile phone");
    expect(citizen.url.searchParams.get("digit_tenant")).toBe("bomet-county");
    expect(citizen.loginCookie).toMatch(/^digit_identity_session_citizen_login=/);

    // The configurator request is unchanged: no tenant, no prompt, org scope.
    const configurator = await startSignIn("method=password");
    expect(configurator.url.searchParams.get("client_id")).toBe("digit-identity-bff");
    expect(configurator.url.searchParams.has("digit_tenant")).toBe(false);
    expect(configurator.url.searchParams.has("prompt")).toBe(false);
    expect(configurator.loginCookie).toMatch(/^digit_identity_session_login=/);

    // A callback carrying another surface's login cookie is not bound. The
    // failure returns to the attempt's own tenant route, not the configurator.
    const crossed = await fetch(
      `${app()}/identity/v1/callback?code=valid-code:${encodeURIComponent(employee.nonce)}&state=${encodeURIComponent(employee.state)}`,
      { redirect: "manual", headers: { Cookie: `digit_identity_session_login=${employee.state}` } },
    );
    expect(crossed.status).toBe(303);
    const crossedTo = new URL(crossed.headers.get("location")!, "http://x");
    expect(crossedTo.pathname.startsWith("/bomet-county/digit-ui/employee/")).toBe(true);
    expect(crossedTo.searchParams.get("authResult")).toBeTruthy();
    expect(cookieFrom(crossed, "digit_identity_session_employee")).toBeUndefined();
  });

  it("adds an employee surface through configuration alone", async () => {
    const original = config.identitySurfacesJson;
    config.identitySurfacesJson = JSON.stringify({ reviewer: {
      contextKind: "employee", clientId: "digit-ui-reviewer", clientSecret: "test-reviewer-secret",
      scope: "openid profile email", cookieName: "digit_identity_session_reviewer", prompt: "select_account",
    } });
    resetIdentityMethodCatalog();
    try {
      const start = await startSignIn("surface=reviewer&tenantSlug=bomet-county");
      expect(start.url.searchParams.get("client_id")).toBe("digit-ui-reviewer");
      expect(start.url.searchParams.get("prompt")).toBe("select_account");
      const callback = await fetch(`${app()}/identity/v1/callback?code=valid-code:${encodeURIComponent(start.nonce)}&state=${encodeURIComponent(start.state)}`, {
        redirect: "manual", headers: { Cookie: start.loginCookie },
      });
      expect(callback.headers.get("location")).toBe("/bomet-county/digit-ui/reviewer/");
      const cookie = cookieFrom(callback, "digit_identity_session_reviewer")!;
      const session = await fetch(`${app()}/identity/v1/session?surface=reviewer`, { headers: { Cookie: cookie } });
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({ surface: "reviewer", tenant: { tenantId: "ke.bomet" } });
      const select = (tenantId: string) => fetch(`${app()}/identity/v1/contexts/_select`, {
        method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "reviewer", tenantId }),
      });
      expect((await select("ke.nakuru")).status).toBe(403);
      expect((await select("ke.bomet")).status).toBe(200);
    } finally {
      config.identitySurfacesJson = original;
      resetIdentityMethodCatalog();
    }
  });

  it("signs an employee in to the bound tenant only", async () => {
    const cookie = await signIn("employee", "", "/bomet-county/digit-ui/employee/pgr/inbox?x=1");
    // Another surface cannot read the session, even with the same id.
    const sessionId = cookie.split("=")[1];
    expect((await fetch(`${app()}/identity/v1/session`, {
      headers: { Cookie: `digit_identity_session=${sessionId}` },
    })).status).toBe(401);
    expect((await fetch(`${app()}/identity/v1/session?surface=citizen`, {
      headers: { Cookie: `digit_identity_session_citizen=${sessionId}` },
    })).status).toBe(401);

    // The mock access token expires at once: this read refreshes through the
    // employee client and must keep the binding.
    const session = await fetch(`${app()}/identity/v1/session?surface=employee`, {
      headers: { Cookie: cookie },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      authenticated: true,
      user: { id: "identity-user-1" },
      context: null,
      surface: "employee",
      tenant: { urlSlug: "bomet-county", tenantId: "ke.bomet", name: "Bomet County" },
    });

    const select = (tenantId: string, extra: Record<string, unknown> = { surface: "employee" }) =>
      fetch(`${app()}/identity/v1/contexts/_select`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, ...extra }),
      });
    // identity-user-1 is a GRO member of Nakuru too, but this session is Bomet's.
    expect((await select("ke.nakuru")).status).toBe(403);
    expect((await select("ke.bomet", {})).status).toBe(401);
    expect((await select("ke.bomet", { surface: "citizen" })).status).toBe(400);
    const selected = await select("ke.bomet");
    expect(selected.status).toBe(200);
    const body = await selected.json();
    expect(body.UserRequest).toMatchObject({ type: "EMPLOYEE", tenantId: "ke.bomet" });
    expect(body.UserRequest.userName).toMatch(/^kcbff-/);

    const logout = await fetch(`${app()}/identity/v1/logout`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "employee" }),
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toMatch(/^digit_identity_session_employee=;.*Max-Age=0/);
    expect((await fetch(`${app()}/identity/v1/session?surface=employee`, {
      headers: { Cookie: cookie },
    })).status).toBe(401);
  });

  it("creates a CitizenRegistration and a DIGIT CITIZEN token for the bound tenant", async () => {
    const accountsBefore = digit.accounts.size;
    const cookie = await signIn("citizen");
    const session = await fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: cookie } });
    expect(await session.json()).toMatchObject({
      user: { id: "citizen-user-1", phoneNumber: "+254712345678", phoneNumberVerified: true },
      surface: "citizen",
      tenant: { tenantId: "ke.bomet" },
    });

    expect((await citizenSelect(cookie, {}, "https://attacker.example")).status).toBe(403);
    expect((await citizenSelect(cookie, { surface: "employee" })).status).toBe(400);
    const employeeCookie = await signIn("employee");
    expect((await citizenSelect(employeeCookie.replace("_employee=", "_citizen="))).status).toBe(401);

    const otpsBefore = digit.stats.otpCreates;
    // The OTP identity is the verified session phone, like egov-user's
    // validateOtp (mobileNumber at the account tenant), even when search
    // responses mask the stored number.
    digit.setMaskSearchMobileNumbers(true);
    const selected = await withoutSubjectReconciliation(() => citizenSelect(cookie, { tenantId: "ke.kisumu" })).finally(() =>
      digit.setMaskSearchMobileNumbers(false));
    expect(selected.status).toBe(200);
    // Bomet's Organization maps `ke.bomet`, but egov-user keeps citizens at
    // the state root `ke`: the account, OTP and token all live there.
    expect(digit.otps.has("712345678|ke")).toBe(true);
    expect([...digit.otps.keys()].some((key) => key.startsWith("kcbffc-"))).toBe(false);
    const body = await selected.json();
    expect(Object.keys(body).sort())
      .toEqual(["UserRequest", "access_token", "expires_in", "scope", "tenant", "token_type"]);
    expect(body).toMatchObject({
      token_type: "bearer",
      scope: "read",
      UserRequest: {
        type: "CITIZEN", tenantId: "ke", name: "Wanjiku Citizen",
        mobileNumber: "712345678", countryCode: "+254",
      },
      tenant: { urlSlug: "bomet-county", tenantId: "ke.bomet" },
    });
    expect(body.UserRequest.userName).toMatch(/^kcbffc-[0-9a-f]{40}$/);
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    const account = digit.accounts.get(body.UserRequest.uuid)!;
    expect(account.tenantId).toBe("ke");
    expect(account.roles).toEqual([{ code: "CITIZEN", name: "CITIZEN", tenantId: "ke" }]);
    expect(account.identificationMark).toMatch(/^keycloak-bff:citizen:v1:/);
    expect(digit.accounts.size).toBe(accountsBefore + 1);
    expect(digit.tokens.get(body.access_token)?.uuid).toBe(account.uuid);
    expect(digit.stats.otpCreates).toBe(otpsBefore + 1);
    expect(digit.stats.internalLogins).toBe(0);

    const user = await (await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/citizen-user-1`,
    )).json();
    expect(user.attributes["digit.citizenRegistrations"]).toEqual([
      `v1|ke.bomet|ke.bomet|ACTIVE|${account.uuid}`,
    ]);
    // A citizen is never an Organization member and never enters the
    // employee-account inventory that reconciliation deactivates from.
    expect(user.attributes["digit.managedTenants"]).toBeUndefined();
    expect((await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/organizations/org-bomet-id/members/citizen-user-1`,
    )).status).toBe(404);
    expect(Object.keys(await getRedis().hgetall(managedAccountsKey()))
      .some((field) => field.startsWith("citizen-user-1|"))).toBe(false);

    // Renewal reuses the live token without minting another OTP.
    const renewed = await citizenSelect(cookie);
    expect((await renewed.json()).access_token).toBe(body.access_token);
    expect(digit.stats.otpCreates).toBe(otpsBefore + 1);

    // Logout revokes the DIGIT token this session was the last holder of.
    const logout = await fetch(`${app()}/identity/v1/logout`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "citizen" }),
    });
    expect(logout.status).toBe(204);
    expect(digit.tokens.has(body.access_token)).toBe(false);

    // Signing in again resolves the same registration and account.
    const again = await citizenSelect(await signIn("citizen"));
    expect(again.status).toBe(200);
    expect((await again.json()).UserRequest.uuid).toBe(account.uuid);
    expect(digit.accounts.size).toBe(accountsBefore + 1);
  });

  it("refuses citizens without a verified, tenant-valid phone or with a disabled registration", async () => {
    expect((await citizenSelect(await signIn("citizen", "unverified"))).status).toBe(403);
    expect((await citizenSelect(await signIn("citizen", "foreign"))).status).toBe(403);

    const other = await signIn("citizen", "other");
    expect((await citizenSelect(other)).status).toBe(200);
    const user = await (await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/citizen-user-2`,
    )).json();
    const [value] = user.attributes["digit.citizenRegistrations"] as string[];
    await kcUpdate("/users/citizen-user-2", {
      attributes: { ...user.attributes, "digit.citizenRegistrations": [value.replace("|ACTIVE|", "|DISABLED|")] },
    });
    // Drop the cached token so the request reaches the registration check.
    await fetch(`${app()}/identity/v1/logout`, {
      method: "POST",
      headers: { Cookie: other, "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "citizen" }),
    });
    expect((await citizenSelect(await signIn("citizen", "other"))).status).toBe(403);
  });

  it("writes citizen registrations without replaying the stale user representation", async () => {
    const created = await kcAdmin("/users", {
      id: "citizen-put-1", username: "+254700000001", email: "c1@example.test",
      firstName: "Achieng", enabled: true,
      attributes: { phoneNumber: ["+254700000001"], "digit.managedTenants": ["ke.bomet"] },
    });
    expect(created.status).toBe(201);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await updateCitizenRegistrationValues("citizen-put-1", (values) => [...values, "v1|ke|ke|ACTIVE|u-1"]);
      const put = fetchSpy.mock.calls.find(([, init]) => init?.method === "PUT");
      const body = JSON.parse(String(put?.[1]?.body));
      // No `enabled` (or other stale top-level state): a concurrent admin
      // disable must survive. Profile fields ride along because Keycloak 26
      // clears them when a PUT carries `attributes` without them.
      expect(Object.keys(body).sort()).toEqual(["attributes", "email", "firstName"]);
      expect(body.attributes).toEqual({
        phoneNumber: ["+254700000001"],
        "digit.managedTenants": ["ke.bomet"],
        "digit.citizenRegistrations": ["v1|ke|ke|ACTIVE|u-1"],
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reuses one root CITIZEN account across the root, subtenant and sibling-city routes", async () => {
    // Kisumu is another Organization under the same `ke` root.
    digit.mdms.set(digit.mdmsKey("ke.kisumu", "common-masters.MobileNumberValidation"), [{
      tenantId: "ke.kisumu", schemaCode: "common-masters.MobileNumberValidation", uniqueIdentifier: "mnv",
      data: { countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$", default: true }, isActive: true,
    }]);
    const accountsBefore = digit.accounts.size;
    const select = async (slug: string) => {
      const cookie = await signIn("citizen", "", `/${slug}/digit-ui/citizen/`, slug);
      const response = await citizenSelect(cookie);
      expect(response.status, slug).toBe(200);
      return { cookie, body: await response.json() };
    };
    const root = await select("bomet-county");
    const subtenant = await select("bomet-ulb-one");
    const sibling = await select("kisumu");

    expect(root.body.tenant).toEqual({ urlSlug: "bomet-county", tenantId: "ke.bomet" });
    expect(subtenant.body.tenant).toEqual({ urlSlug: "bomet-ulb-one", tenantId: "ke.bomet.ulb1" });
    expect(sibling.body.tenant).toEqual({ urlSlug: "kisumu", tenantId: "ke.kisumu" });
    for (const { body } of [root, subtenant, sibling]) {
      expect(body.UserRequest).toMatchObject({ type: "CITIZEN", tenantId: "ke" });
      expect(body.UserRequest.uuid).toBe(root.body.UserRequest.uuid);
      expect(body.UserRequest.userName).toBe(root.body.UserRequest.userName);
    }
    // One DIGIT account per (subject, root); no orphan rows at city tenants.
    expect(digit.accounts.size).toBe(accountsBefore);
    expect([...digit.accounts.values()].filter((account) =>
      account.type === "CITIZEN" && account.tenantId !== "ke")).toEqual([]);

    const uuid = root.body.UserRequest.uuid;
    const user = await (await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/citizen-user-1`,
    )).json();
    // Registrations stay keyed on the route tenant, all pointing at the root account.
    expect(user.attributes["digit.citizenRegistrations"]).toEqual([
      `v1|ke.bomet|ke.bomet.ulb1|ACTIVE|${uuid}`,
      `v1|ke.bomet|ke.bomet|ACTIVE|${uuid}`,
      `v1|ke.kisumu|ke.kisumu|ACTIVE|${uuid}`,
    ]);

    // Logging out of one city keeps the shared token alive for the others.
    const logout = await fetch(`${app()}/identity/v1/logout`, {
      method: "POST",
      headers: { Cookie: subtenant.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "citizen" }),
    });
    expect(logout.status).toBe(204);
    expect(digit.tokens.has(root.body.access_token)).toBe(true);
    expect((await citizenSelect(sibling.cookie)).status).toBe(200);
  });

  it("refuses a citizen token issued for a tenant other than the bound root", async () => {
    const original = citizenTokenMinter();
    const identity = citizenIdentity(config.keycloakIssuer, "citizen-user-1", "ke.bomet.ulb1");
    expect(identity.tenantId).toBe("ke");
    const tokenCache = () => clearTokenInventory(identity);
    for (const tenantId of ["ke.bomet", "zz", "ke.kisumu"]) {
      await tokenCache();
      setCitizenTokenMinter({
        async mint(account) {
          return {
            accessToken: `forged-${tenantId}`,
            expiresAt: Date.now() + 600_000,
            user: { uuid: account.uuid, type: "CITIZEN", tenantId },
          };
        },
      });
      try {
        const response = await citizenSelect(await signIn("citizen"));
        expect(response.status, tenantId).toBe(502);
        expect(JSON.stringify(await response.json())).not.toContain("forged-");
      } finally {
        setCitizenTokenMinter(original);
      }
    }
    await tokenCache();
  });

  it("answers a stable 503 when the tenant has no CITIZEN role, without seeding one", async () => {
    const identity = citizenIdentity(config.keycloakIssuer, "citizen-user-1", "ke.bomet");
    const removedAccounts = [...digit.accounts.entries()].filter(([, account]) => account.userName === identity.username);
    for (const [key, account] of digit.accounts) {
      if (account.userName === identity.username) digit.accounts.delete(key);
    }
    await clearTokenInventory(identity);
    const creates = digit.stats.creates;
    const rolesKey = digit.mdmsKey("ke", "ACCESSCONTROL-ROLES.roles");
    const roles = JSON.stringify(digit.mdms.get(rolesKey) ?? null);
    digit.setUndefinedRoles(["CITIZEN"]);
    try {
      const response = await citizenSelect(await signIn("citizen"));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "This tenant is not ready for sign-in yet",
        code: "TENANT_ROLES_MISSING",
      });
      expect(digit.stats.creates).toBe(creates);
      expect(JSON.stringify(digit.mdms.get(rolesKey) ?? null)).toBe(roles);
    } finally {
      digit.setUndefinedRoles([]);
      // Restore this test's deleted records: later tests retain a durable
      // digit.accounts reference and must exercise the same citizen UUID.
      for (const [uuid, account] of removedAccounts) digit.accounts.set(uuid, account);
    }
  });

  it("keeps serving every other tenant when two mappings collide on a slug", async () => {
    await kcAdmin("/organizations", {
      id: "org-dupe-a", alias: "dupe-slug", name: "Dupe A", enabled: true,
      attributes: { "digit.rootTenantId": ["ke.nyeri"] },
    });
    await kcAdmin("/organizations", {
      id: "org-dupe-b", alias: "dupe-b", name: "Dupe B", enabled: true,
      attributes: { "digit.rootTenantId": ["ke.nakuru"], "digit.urlSlug": ["dupe-slug"] },
    });
    clearTenantMappingCache();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await fetch(`${app()}/identity/v1/tenant-contexts/bomet-county`)).status).toBe(200);
      expect((await fetch(`${app()}/identity/v1/tenant-contexts/dupe-slug`)).status).toBe(404);
      expect(warn.mock.calls.some(([line]) => String(line).includes("colliding mapping"))).toBe(true);
      // Dupe B also claims ke.nakuru, so the Nakuru mapping is dropped too. Its
      // managed accounts must stay active: reconcile never writes DIGIT active.
      // Ambiguous Organization ownership is reported for operator repair.
      const nakuru = [...digit.accounts.values()].filter((account) =>
        account.tenantId === "ke.nakuru" && account.userName.startsWith("kcbff-") && account.active);
      expect(nakuru.length).toBeGreaterThan(0);
      expect(await readTenantMappingForTenant("ke.nakuru")).toBeNull();
      const reconciled = await fetch(`${app()}/internal/identity/v1/reconciliation/_run`, {
        method: "POST",
        headers: { Authorization: "Bearer test-control-plane", "Content-Type": "application/json" },
        body: "{}",
      });
      expect(reconciled.status).toBe(200);
      const result = await reconciled.json();
      expect(result).not.toHaveProperty("deactivated");
      expect(result.failures.some((failure: { subject: string; code: string }) =>
        failure.subject === "tenant:ke.nakuru" && failure.code === "IDENTITY_UNAVAILABLE")).toBe(true);
      expect(nakuru.every((account) => digit.accounts.get(account.uuid)!.active)).toBe(true);
    } finally {
      warn.mockRestore();
      await kcUpdate("/organizations/org-dupe-a", { enabled: false });
      await kcUpdate("/organizations/org-dupe-b", { enabled: false });
      clearTenantMappingCache();
    }
  });

  it("stops employee sign-in as soon as the Organization is unmapped or disabled, cache or not", async () => {
    const cookie = await signIn("employee");
    const select = () => fetch(`${app()}/identity/v1/contexts/_select`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "employee", tenantId: "ke.bomet" }),
    });
    expect((await select()).status).toBe(200);
    const mapped = { "digit.rootTenantId": ["ke.bomet"], "digit.urlSlug": ["bomet-county"] };
    // No cache clear in either case: the directory still holds the mapping.
    await kcUpdate("/organizations/org-bomet-id", { attributes: { "digit.urlSlug": ["bomet-county"] } });
    try {
      expect((await select()).status).toBe(403);
    } finally {
      await kcUpdate("/organizations/org-bomet-id", { attributes: mapped });
    }
    expect((await select()).status).toBe(200);
    await kcUpdate("/organizations/org-bomet-id", { enabled: false });
    try {
      expect((await select()).status).toBe(403);
    } finally {
      await kcUpdate("/organizations/org-bomet-id", { enabled: true });
      clearTenantMappingCache();
    }
  });

  it("finds an Organization another replica created, without waiting for the directory cache", async () => {
    // Warm this replica's directory, then create the Organization behind its
    // back, as signup on another replica would.
    expect(await readTenantMappingForUrlSlug("bomet-county")).not.toBeNull();
    await kcAdmin("/organizations", {
      id: "org-fresh-id", alias: "fresh", name: "Fresh County", enabled: true,
      attributes: { "digit.rootTenantId": ["ke.fresh"], "digit.urlSlug": ["fresh-county"] },
    });
    try {
      expect(await readTenantMappingForUrlSlug("fresh-county"))
        .toMatchObject({ organizationId: "org-fresh-id", tenantId: "ke.fresh" });
      expect(await readTenantMappingForTenant("ke.fresh"))
        .toMatchObject({ organizationId: "org-fresh-id", urlSlug: "fresh-county" });
      expect(await readTenantMappingForUrlSlug("never-created")).toBeNull();
    } finally {
      await kcUpdate("/organizations/org-fresh-id", { enabled: false });
      clearTenantMappingCache();
    }
  });

  it("stops citizen sign-in as soon as the bound Organization is disabled, cache or not", async () => {
    const cookie = await signIn("citizen");
    expect((await citizenSelect(cookie)).status).toBe(200);
    // No cache clear: the directory still holds the mapping, and the session
    // still holds a cached DIGIT token.
    await kcUpdate("/organizations/org-bomet-id", { enabled: false });
    try {
      expect((await citizenSelect(cookie)).status).toBe(403);
    } finally {
      await kcUpdate("/organizations/org-bomet-id", { enabled: true });
      clearTenantMappingCache();
    }
    expect((await citizenSelect(cookie)).status).toBe(200);
  });

  it("records a managed tenant without replaying the stale user representation", async () => {
    const created = await kcAdmin("/users", {
      id: "managed-put-1", username: "managed.put", email: "m1@example.test",
      firstName: "Kipchoge", enabled: true, attributes: { "digit.managedTenants": ["ke.bomet"] },
    });
    expect(created.status).toBe(201);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      await recordManagedTenant("managed-put-1", "ke.kisumu");
      const put = fetchSpy.mock.calls.find(([, init]) => init?.method === "PUT");
      const body = JSON.parse(String(put?.[1]?.body));
      // No `enabled`: an admin disable between the GET and the PUT must stick.
      expect(Object.keys(body).sort()).toEqual(["attributes", "email", "firstName"]);
      expect(body.attributes["digit.managedTenants"]).toEqual(["ke.bomet", "ke.kisumu"]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("lets a citizen who verified a new number keep signing in", async () => {
    expect((await citizenSelect(await signIn("citizen"))).status).toBe(200);
    const identity = citizenIdentity(config.keycloakIssuer, "citizen-user-1", "ke.bomet");
    await clearTokenInventory(identity);
    const moved = await citizenSelect(await signIn("citizen", "newphone"));
    expect(moved.status).toBe(200);
    const account = [...digit.accounts.values()].find((candidate) => candidate.userName === identity.username)!;
    expect(account.mobileNumber).toBe("712345679");
    expect(account.countryCode).toBe("+254");

    // The number is changed in DIGIT behind the BFF's back. The comparison is
    // with what DIGIT stores, not with what the BFF last wrote, so the next
    // mint writes the verified number back instead of failing the OTP grant.
    digit.accounts.get(account.uuid)!.mobileNumber = "712345670";
    await clearTokenInventory(identity);
    expect((await citizenSelect(await signIn("citizen", "newphone"))).status).toBe(200);
    expect(digit.accounts.get(account.uuid)!.mobileNumber).toBe("712345679");
  });

  describe("citizen phone OTP sign-in (#2189)", () => {
    const sent: OtpMessage[] = [];
    let failDelivery = false;
    const originalSender = otpSender();
    const otpConfig = {
      identityCitizenOtpSecret: "test-otp-secret",
      identityCitizenOtpTtlSeconds: 300,
      identityCitizenOtpMaxAttempts: 5,
      identityCitizenOtpResendSeconds: 0,
      identityCitizenOtpSendWindowSeconds: 3600,
      identityCitizenOtpPhoneSendLimit: 50,
      identityCitizenOtpIpSendLimit: 500,
    };
    const saved = Object.fromEntries(Object.keys(otpConfig).map((key) => [key, (config as any)[key]]));
    let ipCounter = 0;
    const post = (path: string, body: unknown, ip = `198.51.100.${++ipCounter % 250}`) =>
      fetch(`${app()}/identity/v1/citizen/otp/${path}`, {
        method: "POST",
        headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify(body),
      });
    const send = (mobileNumber: string, ip?: string) =>
      post("_send", { tenantSlug: "bomet-county", mobileNumber }, ip);
    const verify = (challengeId: string, code: string, tenantSlug = "bomet-county") =>
      post("_verify", { tenantSlug, challengeId, code });
    const lastCode = () => sent[sent.length - 1].code;
    const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

    beforeAll(async () => {
      // Reset the fresh Keycloak phone changed by the preceding new-phone gate.
      const user = await (await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/citizen-user-1`)).json();
      await kcUpdate("/users/citizen-user-1", { attributes: { ...user.attributes, phoneNumber: ["+254712345678"], phoneNumberVerified: ["true"] } });
      Object.assign(config as any, otpConfig);
      setOtpSender({
        configured: true,
        async send(message) {
          if (failDelivery) throw new OtpDeliveryError("provider down");
          sent.push(message);
        },
      });
      await kcUpdate("/clients/digit-ui-citizen-uuid", {
        attributes: {
          "login_theme": "digit-citizen",
          "digit.auth.surface": "citizen",
          "digit.auth.signin.methods": "phone_otp,password",
        },
      });
      resetIdentityMethodCatalog();
    });

    afterAll(async () => {
      Object.assign(config as any, saved);
      setOtpSender(originalSender);
      await kcUpdate("/clients/digit-ui-citizen-uuid", {
        attributes: {
          "login_theme": "digit-citizen",
          "digit.auth.surface": "citizen",
          "digit.auth.signin.methods": "password",
        },
      });
      resetIdentityMethodCatalog();
    });

    it("offers phone_otp to citizens only when a code can be hashed and delivered", async () => {
      const methods = async (surface: string) => (await (await fetch(
        `${app()}/identity/v1/auth-methods?intent=signin&surface=${surface}`,
      )).json()).methods.map((method: { id: string }) => method.id);
      expect(await methods("citizen")).toEqual(["phone_otp", "password"]);

      (config as any).identityCitizenOtpSecret = "";
      resetIdentityMethodCatalog();
      expect(await methods("citizen")).toEqual(["password"]);
      const disabled = await send("799000100");
      expect(disabled.status).toBe(400);
      expect((await disabled.json()).code).toBe("PHONE_OTP_DISABLED");
      (config as any).identityCitizenOtpSecret = otpConfig.identityCitizenOtpSecret;
      resetIdentityMethodCatalog();

      // Keycloak's /authorize cannot run phone OTP, and is not its default.
      const explicit = await fetch(
        `${app()}/identity/v1/authorize?surface=citizen&tenantSlug=bomet-county&method=phone_otp`,
        { redirect: "manual" },
      );
      expect(explicit.status).toBe(400);
      const implicit = await fetch(
        `${app()}/identity/v1/authorize?surface=citizen&tenantSlug=bomet-county`,
        { redirect: "manual" },
      );
      expect(implicit.status).toBe(302);
    });

    it("checks the tenant route and the tenant's mobile rule before sending", async () => {
      const count = sent.length;
      const unknown = await post("_send", { tenantSlug: "no-such-county", mobileNumber: "799000101" });
      expect([unknown.status, (await unknown.json()).code]).toEqual([404, "TENANT_ROUTE_NOT_FOUND"]);
      const noSlug = await post("_send", { mobileNumber: "799000101" });
      expect([noSlug.status, (await noSlug.json()).code]).toEqual([400, "INVALID_REQUEST"]);
      const malformed = await post("_verify", { tenantSlug: "bomet-county", challengeId: "x", code: "12" });
      expect([malformed.status, (await malformed.json()).code]).toEqual([400, "INVALID_REQUEST"]);
      const invalid = await send("12345");
      expect(invalid.status).toBe(400);
      expect((await invalid.json()).code).toBe("INVALID_MOBILE_NUMBER");
      const foreignOrigin = await fetch(`${app()}/identity/v1/citizen/otp/_send`, {
        method: "POST",
        headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
        body: JSON.stringify({ tenantSlug: "bomet-county", mobileNumber: "799000101" }),
      });
      expect([foreignOrigin.status, (await foreignOrigin.json()).code]).toEqual([403, "UNTRUSTED_ORIGIN"]);
      expect(sent.length).toBe(count);
    });

    it("binds phone step-up to the session, person, purpose and bound tenant", async () => {
      const subject = "phone-stepup-person";
      await kcAdmin("/users", { id: subject, username: subject, enabled: true });
      const makeSession = () => createIdentitySession({ accessToken: "access", accessExpiresIn: 600 }, { sub: subject, email: "" }, config.keycloakCitizenClientId, { surface: "citizen", boundTenant: { urlSlug: "bomet-county", tenantId: "ke.bomet", rootTenantId: "ke.bomet", name: "Bomet" } });
      const first = await makeSession(), second = await makeSession();
      const proofPost = (path: string, body: unknown, sid?: string) => fetch(`${app()}/identity/v1/citizen/otp/${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(sid && { Cookie: `${config.identityCitizenCookieName}=${sid}` }) }, body: JSON.stringify(body) });
      expect((await proofPost("_send", { purpose: "stepup", mobileNumber: "799000601" })).status).toBe(401);
      const invalid = await proofPost("_send", { purpose: "stepup", mobileNumber: "12345" }, first.sessionId);
      expect((await invalid.json()).code).toBe("INVALID_MOBILE_NUMBER");
      const sentResponse = await proofPost("_send", { purpose: "stepup", mobileNumber: "799000601", tenantSlug: "ignored-route" }, first.sessionId);
      expect(sentResponse.status).toBe(202);
      const { challengeId } = await sentResponse.json();
      const code = lastCode();
      expect(sent[sent.length - 1]).toMatchObject({ purpose: "stepup", tenantId: "ke.bomet" });
      const wrongPurpose = await proofPost("_verify", { purpose: "change_phone", challengeId, code }, first.sessionId);
      expect((await wrongPurpose.json()).code).toBe("OTP_EXPIRED");
      const wrongSession = await proofPost("_verify", { purpose: "stepup", challengeId, code }, second.sessionId);
      expect((await wrongSession.json()).code).toBe("OTP_EXPIRED");
      const verified = await proofPost("_verify", { purpose: "stepup", challengeId, code }, first.sessionId);
      expect(verified.status).toBe(200);
      expect(verified.headers.has("set-cookie")).toBe(false);
      expect(await verified.json()).toEqual({ phoneNumber: "+254799000601", phoneNumberVerified: true });
      const current = await fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: `${config.identityCitizenCookieName}=${first.sessionId}` } });
      expect((await current.json()).user).toMatchObject({ id: subject, phoneNumber: "+254799000601", phoneNumberVerified: true });
    });

    it("signs in the verified phone owner with a token-free session that _select accepts", async () => {
      const response = await send("712345678");
      expect(response.status).toBe(202);
      const { challengeId, expiresIn } = await response.json();
      expect(expiresIn).toBe(300);
      const message = sent[sent.length - 1];
      expect(message).toMatchObject({ challengeId, tenantId: "ke.bomet", phoneNumber: "+254712345678" });
      expect(message.code).toMatch(/^\d{6}$/);

      // The code is stored only as a keyed hash; keys never carry the phone.
      const stored = await getRedis().hgetall(`${config.cachePrefix}:identity:citizen-otp:challenge:${challengeId}`);
      expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(Object.values(stored)).not.toContain(message.code);
      for (const key of await getRedis().keys(`${config.cachePrefix}:identity:citizen-otp:*`)) {
        expect(key).not.toContain("254712345678");
      }

      // Bound to its tenant route: another route can neither use nor burn it.
      expect((await verify(challengeId, message.code, "no-such-county")).status).toBe(404);
      const kisumu = { "digit.rootTenantId": ["ke.kisumu"] };
      await kcUpdate("/organizations/org-kisumu-id", { attributes: { ...kisumu, "digit.urlSlug": ["kisumu-county"] } });
      clearTenantMappingCache();
      try {
        const elsewhere = await verify(challengeId, message.code, "kisumu-county");
        expect(elsewhere.status).toBe(400);
        expect((await elsewhere.json()).code).toBe("OTP_EXPIRED");
      } finally {
        await kcUpdate("/organizations/org-kisumu-id", { attributes: kisumu });
        clearTenantMappingCache();
      }
      const bad = await verify(challengeId, wrong(message.code));
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: "OTP_INVALID", attemptsRemaining: 4 });

      const ok = await verify(challengeId, message.code);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({
        authenticated: true, tenant: { urlSlug: "bomet-county", tenantId: "ke.bomet" },
      });
      const cookie = cookieFrom(ok, "digit_identity_session_citizen")!;
      expect(cookie).toBeTruthy();
      expect((await (await verify(challengeId, message.code)).json()).code).toBe("OTP_EXPIRED");

      const session = await (await fetch(`${app()}/identity/v1/session?surface=citizen`, {
        headers: { Cookie: cookie },
      })).json();
      // citizen-user-1 already owns +254712345678, verified: reused, not duplicated.
      expect(session.user).toMatchObject({ id: "citizen-user-1", phoneNumber: "+254712345678", phoneNumberVerified: true });

      const selected = await citizenSelect(cookie);
      expect(selected.status).toBe(200);
      expect((await selected.json()).tenant).toEqual({ urlSlug: "bomet-county", tenantId: "ke.bomet" });

      const logout = await fetch(`${app()}/identity/v1/logout`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
        body: JSON.stringify({ surface: "citizen" }),
      });
      expect(logout.status).toBe(204);
      expect((await fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: cookie } })).status)
        .toBe(401);
    });

    it("changes a citizen phone through production propagation, preserves its uuid, and retries a DIGIT outage", async () => {
      const subject = "phone-change-propagation";
      const oldPhone = "+254799000610", newPhone = "+254799000611";
      digit.mdms.set(digit.mdmsKey("ke", "common-masters.MobileNumberValidation"), [{
        tenantId: "ke", schemaCode: "common-masters.MobileNumberValidation", uniqueIdentifier: "phone-change-rule",
        isActive: true, data: { countryCode: "+254", mobileNumberRegex: "^[17][0-9]{8}$", default: true },
      }]);
      const account = digit.addAccount({ userName: "phone-change-citizen", name: "Citizen", tenantId: "ke",
        type: "CITIZEN", active: true, mobileNumber: "799000610", countryCode: "+254", emailId: null,
        identificationMark: null, roles: [{ code: "CITIZEN", tenantId: "ke" }], password: "Cit1zen@Test" });
      const accounts = JSON.stringify({ v: 1, entries: [{ kind: "citizen", tenantId: "ke", uuid: account.uuid,
        boundAt: 1, active: true, roles: account.roles }] });
      await kcAdmin("/users", { id: subject, username: subject, enabled: true, attributes: {
        phoneNumber: [oldPhone], phoneNumberVerified: ["true"], "digit.accounts": [accounts],
      } });
      const makeSession = () => createPhoneOtpSession({ subject, name: "Citizen", phoneNumber: oldPhone,
        boundTenant: { urlSlug: "bomet-county", tenantId: "ke.bomet", rootTenantId: "ke.bomet", name: "Bomet" } });
      const first = await makeSession(), other = await makeSession();
      const proofPost = (path: string, body: unknown) => fetch(`${app()}/identity/v1/citizen/otp/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: `${config.identityCitizenCookieName}=${first.sessionId}` },
        body: JSON.stringify({ purpose: "change_phone", ...body as object }),
      });
      const invalid = await proofPost("_send", { mobileNumber: "12345" });
      expect([invalid.status, (await invalid.json()).code]).toEqual([400, "INVALID_MOBILE_NUMBER"]);
      const sentResponse = await proofPost("_send", { mobileNumber: "799000611" });
      expect(sentResponse.status).toBe(202);
      const { challengeId } = await sentResponse.json();
      const code = lastCode();
      // Fail only the DIGIT write: Keycloak and old-session revocation have already succeeded.
      const realFetch = globalThis.fetch;
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        if (String(input).includes("/user/users/_updatenovalidate")) return Promise.resolve(new Response("{}", { status: 503 }));
        return realFetch(input, init);
      });
      try {
        const failed = await proofPost("_verify", { challengeId, code });
        expect([failed.status, (await failed.json()).code]).toEqual([503, "IDENTITY_UNAVAILABLE"]);
        expect(await getIdentitySession(other.sessionId)).toBeNull();
        expect((await getIdentitySession(first.sessionId))?.claims.phone_number).toBe(newPhone);
        expect(digit.accounts.get(account.uuid)?.mobileNumber).toBe("799000610");
      } finally { fetchSpy.mockRestore(); }
      const retried = await proofPost("_verify", { challengeId, code });
      expect(retried.status).toBe(200);
      expect(await retried.json()).toEqual({ phoneNumber: newPhone, phoneNumberVerified: true });
      expect(digit.accounts.get(account.uuid)).toMatchObject({ uuid: account.uuid, mobileNumber: "799000611", name: "Citizen" });
      const stored = await (await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/${subject}`)).json();
      expect(stored.attributes["digit.accounts"]).toEqual([accounts]);
      expect((await proofPost("_verify", { challengeId, code })).status).toBe(400);
    });

    it("rechecks ownership at verification and cannot take a phone claimed after the code was sent", async () => {
      const subject = "phone-late-claimant";
      await kcAdmin("/users", { id: subject, username: subject, enabled: true });
      const { sessionId } = await createIdentitySession({ accessToken: "test", accessExpiresIn: 600 },
        { sub: subject, email: "" }, config.keycloakCitizenClientId, { surface: "citizen",
          boundTenant: { urlSlug: "bomet-county", tenantId: "ke.bomet", rootTenantId: "ke.bomet", name: "Bomet" } });
      const proofPost = (path: string, body: object) => fetch(`${app()}/identity/v1/citizen/otp/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: `${config.identityCitizenCookieName}=${sessionId}` },
        body: JSON.stringify({ purpose: "stepup", ...body }),
      });
      const { challengeId } = await (await proofPost("_send", { mobileNumber: "799000612" })).json();
      const code = lastCode();
      await kcAdmin("/users", { id: "phone-late-owner", username: "phone-late-owner", enabled: true,
        attributes: { phoneNumber: ["+254799000612"], phoneNumberVerified: ["true"] } });
      const refused = await proofPost("_verify", { challengeId, code });
      expect([refused.status, (await refused.json()).code]).toEqual([409, "PHONE_IN_USE"]);
      const blockedSend = await proofPost("_send", { mobileNumber: "799000612" });
      expect([blockedSend.status, (await blockedSend.json()).code]).toEqual([409, "PHONE_IN_USE"]);
      expect((await getIdentitySession(sessionId))?.claims.phone_number_verified).not.toBe(true);
    });

    it("uses the national mobile number as a new unnamed citizen's DIGIT name", async () => {
      const { challengeId } = await (await send("799000613")).json();
      const signedIn = await verify(challengeId, lastCode());
      expect(signedIn.status).toBe(200);
      const cookie = cookieFrom(signedIn, "digit_identity_session_citizen")!;
      const selected = await citizenSelect(cookie);
      expect(selected.status).toBe(200);
      const account = [...digit.accounts.values()].find(value => value.mobileNumber === "799000613");
      expect(account).toMatchObject({ name: "799000613", countryCode: "+254", type: "CITIZEN" });
    });

    it("creates one Keycloak user for a new number and never takes over an unverified one", async () => {
      await kcAdmin("/users", {
        id: "unverified-squatter", username: "squatter", enabled: true,
        attributes: { phoneNumber: ["+254799000222"], phoneNumberVerified: ["false"] },
      });
      const signInWith = async (mobileNumber: string) => {
        const { challengeId } = await (await send(mobileNumber)).json();
        const ok = await verify(challengeId, lastCode());
        expect(ok.status).toBe(200);
        const cookie = cookieFrom(ok, "digit_identity_session_citizen")!;
        return (await (await fetch(`${app()}/identity/v1/session?surface=citizen`, {
          headers: { Cookie: cookie },
        })).json()).user.id as string;
      };
      const first = await signInWith("799000222");
      expect(first).not.toBe("unverified-squatter");
      expect(await signInWith("799000222")).toBe(first);
      const users = await (await fetch(
        `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users?q=phoneNumber:%2B254799000222`,
        { headers: { Authorization: "Bearer mock-kc-admin-token" } },
      )).json() as Array<{ id: string; attributes: Record<string, string[]> }>;
      expect(users.map((user) => user.id).sort()).toEqual([first, "unverified-squatter"].sort());
      expect(users.find((user) => user.id === first)!.attributes).toMatchObject({
        phoneNumber: ["+254799000222"], phoneNumberVerified: ["true"],
      });
    });

    it("limits resends per phone and per IP", async () => {
      Object.assign(config as any, { identityCitizenOtpResendSeconds: 60 });
      try {
        expect((await send("799000301", "203.0.113.80")).status).toBe(202);
        const tooSoon = await send("799000301", "203.0.113.80");
        expect(tooSoon.status).toBe(429);
        expect(await tooSoon.json()).toMatchObject({ code: "OTP_RESEND_TOO_SOON" });
        expect(Number(tooSoon.headers.get("retry-after"))).toBeGreaterThan(0);
        // The cooldown is per caller: someone else asking for a code to this
        // number does not hold its owner back.
        expect((await send("799000301", "203.0.113.81")).status).toBe(202);
      } finally {
        (config as any).identityCitizenOtpResendSeconds = 0;
      }

      (config as any).identityCitizenOtpPhoneSendLimit = 2;
      try {
        expect((await send("799000302")).status).toBe(202);
        expect((await send("799000302")).status).toBe(202);
        expect(await (await send("799000302")).json()).toMatchObject({ code: "OTP_RATE_LIMITED" });
      } finally {
        (config as any).identityCitizenOtpPhoneSendLimit = otpConfig.identityCitizenOtpPhoneSendLimit;
      }

      (config as any).identityCitizenOtpIpSendLimit = 2;
      try {
        expect((await send("799000303", "203.0.113.90")).status).toBe(202);
        expect((await send("799000304", "203.0.113.90")).status).toBe(202);
        const limited = await send("799000305", "203.0.113.90");
        expect(limited.status).toBe(429);
        expect(await limited.json()).toMatchObject({ code: "OTP_RATE_LIMITED" });
      } finally {
        (config as any).identityCitizenOtpIpSendLimit = otpConfig.identityCitizenOtpIpSendLimit;
      }
    });

    it("keeps only the newest code for a number usable", async () => {
      const first = await (await send("799000310")).json();
      const firstCode = lastCode();
      const second = await (await send("799000310")).json();
      const secondCode = lastCode();
      const old = await verify(first.challengeId, firstCode);
      expect([old.status, (await old.json()).code]).toEqual([400, "OTP_EXPIRED"]);
      // A send that fails to deliver does not take the current code away.
      failDelivery = true;
      try {
        expect((await send("799000310")).status).toBe(503);
      } finally {
        failDelivery = false;
      }
      expect((await verify(second.challengeId, secondCode)).status).toBe(200);
    });

    it("expires a challenge after too many wrong codes, but never locks the number's owner out", async () => {
      (config as any).identityCitizenOtpMaxAttempts = 2;
      try {
        const { challengeId } = await (await send("799000401")).json();
        const code = lastCode();
        expect(await (await verify(challengeId, wrong(code))).json()).toMatchObject({ attemptsRemaining: 1 });
        expect(await (await verify(challengeId, wrong(code))).json()).toMatchObject({ code: "OTP_EXPIRED", attemptsRemaining: 0 });
        expect((await (await verify(challengeId, code)).json()).code).toBe("OTP_EXPIRED");
      } finally {
        (config as any).identityCitizenOtpMaxAttempts = otpConfig.identityCitizenOtpMaxAttempts;
      }
      // Someone else burns many wrong guesses on the owner's number...
      for (let round = 0; round < 3; round += 1) {
        const { challengeId } = await (await send("799000402")).json();
        for (let guess = 0; guess < 5; guess += 1) await verify(challengeId, wrong(lastCode()));
      }
      // ...and the owner still gets and uses a fresh code.
      const { challengeId } = await (await send("799000402")).json();
      expect((await verify(challengeId, lastCode())).status).toBe(200);
    });

    it("answers OTP_CHANNEL_UNAVAILABLE when a code cannot be sent", async () => {
      failDelivery = true;
      try {
        const response = await send("799000501");
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: "OTP_CHANNEL_UNAVAILABLE" });
      } finally {
        failDelivery = false;
      }
      const fake = otpSender();
      setOtpSender(new LogOtpSender());
      resetIdentityMethodCatalog();
      try {
        // No channel and no fixed code: phone_otp is not offered at all.
        const methods = await (await fetch(`${app()}/identity/v1/auth-methods?intent=signin&surface=citizen`)).json();
        expect(methods.methods.map((method: { id: string }) => method.id)).not.toContain("phone_otp");
        const response = await send("799000502");
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "PHONE_OTP_DISABLED" });
      } finally {
        setOtpSender(fake);
        resetIdentityMethodCatalog();
      }
    });

    it("gives a failed send's cooldown and quota back", async () => {
      Object.assign(config as any, { identityCitizenOtpResendSeconds: 60, identityCitizenOtpPhoneSendLimit: 1 });
      try {
        failDelivery = true;
        expect((await send("799000503")).status).toBe(503);
        failDelivery = false;
        // Neither the 60 s cooldown nor the one-per-window send was spent.
        expect((await send("799000503")).status).toBe(202);
      } finally {
        failDelivery = false;
        Object.assign(config as any, {
          identityCitizenOtpResendSeconds: 0, identityCitizenOtpPhoneSendLimit: otpConfig.identityCitizenOtpPhoneSendLimit,
        });
      }
    });

    it("keeps a correct code usable when Keycloak fails while signing in", async () => {
      const { challengeId } = await (await send("799000504")).json();
      const code = lastCode();
      await fetch(`${config.keycloakAdminUrl}/__test/faults`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET", path: "/users", status: 503, count: 1 }),
      });
      const failed = await verify(challengeId, code);
      expect([failed.status, (await failed.json()).code]).toEqual([503, "IDENTITY_UNAVAILABLE"]);
      expect((await verify(challengeId, code)).status).toBe(200);
      expect((await (await verify(challengeId, code)).json()).code).toBe("OTP_EXPIRED");
    });

    it("finds the verified owner past any number of unverified holders", async () => {
      for (let index = 0; index < 7; index += 1) {
        await kcAdmin("/users", {
          id: `unverified-holder-${index}`, username: `holder-${index}`, enabled: true,
          attributes: { phoneNumber: ["+254799000505"], phoneNumberVerified: ["false"] },
        });
      }
      await kcAdmin("/users", {
        id: "verified-owner-505", username: "owner-505", enabled: true,
        attributes: { phoneNumber: ["+254799000505"], phoneNumberVerified: ["true"] },
      });
      const { challengeId } = await (await send("799000505")).json();
      const ok = await verify(challengeId, lastCode());
      const cookie = cookieFrom(ok, "digit_identity_session_citizen")!;
      const session = await (await fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: cookie } })).json();
      expect(session.user.id).toBe("verified-owner-505");
    });

    it("refuses to create a user whose phone Keycloak did not store, and leaves none behind", async () => {
      const drop = (value: boolean) => fetch(`${config.keycloakAdminUrl}/__test/drop-unmanaged-attributes`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drop: value }),
      });
      await drop(true);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { challengeId } = await (await send("799000506")).json();
        const failed = await verify(challengeId, lastCode());
        expect([failed.status, (await failed.json()).code]).toEqual([503, "IDENTITY_UNAVAILABLE"]);
        expect(error.mock.calls.some(([line]) => String(line).includes("unmanagedAttributePolicy"))).toBe(true);
      } finally {
        error.mockRestore();
        await drop(false);
      }
      // Nothing half-made blocks the number: once the realm keeps attributes, it signs in.
      const { challengeId } = await (await send("799000506")).json();
      expect((await verify(challengeId, lastCode())).status).toBe(200);
    });

    it("ends a phone OTP session once its Keycloak user is disabled", async () => {
      const { challengeId } = await (await send("799000507")).json();
      const cookie = cookieFrom(await verify(challengeId, lastCode()), "digit_identity_session_citizen")!;
      const session = () => fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: cookie } });
      const { user } = await (await session()).json();
      await kcUpdate(`/users/${user.id}`, { enabled: false });
      // Pretend the last identity check was over a minute ago.
      const key = `${config.cachePrefix}:identity:session:${cookie.split("=")[1]}`;
      const stored = JSON.parse((await getRedis().get(key))!);
      await getRedis().set(key, JSON.stringify({ ...stored, identityCheckedAt: 0 }), "KEEPTTL");
      expect((await session()).status).toBe(401);
    });

    const ageIdentityCheck = async (cookie: string) => {
      const key = `${config.cachePrefix}:identity:session:${cookie.split("=")[1]}`;
      const stored = JSON.parse((await getRedis().get(key))!);
      await getRedis().set(key, JSON.stringify({ ...stored, identityCheckedAt: 0 }), "KEEPTTL");
      return key;
    };

    it("ends a phone OTP session once its user no longer holds the number as verified", async () => {
      const { challengeId } = await (await send("799000520")).json();
      const cookie = cookieFrom(await verify(challengeId, lastCode()), "digit_identity_session_citizen")!;
      const session = () => fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: cookie } });
      const { user } = await (await session()).json();
      await kcUpdate(`/users/${user.id}`, {
        attributes: { phoneNumber: ["+254799000520"], phoneNumberVerified: ["false"] },
      });
      await ageIdentityCheck(cookie);
      expect((await session()).status).toBe(401);
    });

    it("keeps a phone OTP session through a failed identity check, and checks again next time", async () => {
      const { challengeId } = await (await send("799000521")).json();
      const cookie = cookieFrom(await verify(challengeId, lastCode()), "digit_identity_session_citizen")!;
      const session = () => fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: cookie } });
      const { user } = await (await session()).json();
      const key = await ageIdentityCheck(cookie);
      await fetch(`${config.keycloakAdminUrl}/__test/faults`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET", path: `/users/${user.id}`, status: 503, count: 1 }),
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect((await session()).status).toBe(200);
      } finally {
        warn.mockRestore();
      }
      // The failed check does not count as a pass.
      expect(JSON.parse((await getRedis().get(key))!).identityCheckedAt).toBe(0);
      await kcUpdate(`/users/${user.id}`, { enabled: false });
      expect((await session()).status).toBe(401);
    });

    it("never recreates a session that was deleted while it was being rewritten", async () => {
      const { challengeId } = await (await send("799000522")).json();
      const cookie = cookieFrom(await verify(challengeId, lastCode()), "digit_identity_session_citizen")!;
      const sessionId = cookie.split("=")[1];
      const key = `${config.cachePrefix}:identity:session:${sessionId}`;
      const stored = JSON.parse((await getRedis().get(key))!);
      await getRedis().del(key);
      expect(await touchIdentitySession(sessionId, stored)).toBe(false);
      expect(await getRedis().exists(key)).toBe(0);
    });

    it("signs in a new owner of a number whose phone username an earlier owner still holds", async () => {
      const phone = "+254799000523";
      const username = `phone-${createHash("sha256").update(phone).digest("hex").slice(0, 24)}`;
      // The earlier owner moved to another number but keeps the username.
      await kcAdmin("/users", {
        id: "earlier-owner-523", username, enabled: true,
        attributes: { phoneNumber: ["+254799000599"], phoneNumberVerified: ["true"] },
      });
      const { challengeId } = await (await send("799000523")).json();
      const ok = await verify(challengeId, lastCode());
      expect(ok.status).toBe(200);
      const cookie = cookieFrom(ok, "digit_identity_session_citizen")!;
      const { user } = await (await fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: cookie } })).json();
      expect(user.id).not.toBe("earlier-owner-523");
      const created = await (await fetch(
        `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/${user.id}`,
      )).json();
      expect(created.username).toMatch(/^phone-[0-9a-f-]{36}$/);
      // The same number signs in to the same user again.
      const again = await (await send("799000523")).json();
      const second = cookieFrom(await verify(again.challengeId, lastCode()), "digit_identity_session_citizen")!;
      expect((await (await fetch(`${app()}/identity/v1/session?surface=citizen`, { headers: { Cookie: second } })).json()).user.id)
        .toBe(user.id);
    });

    it("does not charge the IP budget for a resend refused by the cooldown", async () => {
      Object.assign(config as any, { identityCitizenOtpResendSeconds: 60, identityCitizenOtpIpSendLimit: 2 });
      try {
        const ip = "203.0.113.77";
        expect((await send("799000524", ip)).status).toBe(202);
        for (let press = 0; press < 3; press += 1) {
          expect((await (await send("799000524", ip)).json()).code).toBe("OTP_RESEND_TOO_SOON");
        }
        // Only the one real send counted against this address.
        expect((await send("799000525", ip)).status).toBe(202);
      } finally {
        Object.assign(config as any, {
          identityCitizenOtpResendSeconds: 0, identityCitizenOtpIpSendLimit: otpConfig.identityCitizenOtpIpSendLimit,
        });
      }
    });

    it("sends nothing when Redis fails to store the challenge", async () => {
      const count = sent.length;
      const redis = getRedis();
      const chain = {
        hset() { return chain; },
        expire() { return chain; },
        async exec() { return [[new Error("OOM command not allowed"), null], [null, 0]]; },
      };
      const spy = vi.spyOn(redis, "multi").mockImplementationOnce(() => chain as any);
      try {
        expect((await send("799000526")).status).toBe(500);
      } finally {
        spy.mockRestore();
      }
      expect(sent.length).toBe(count);
    });

    it("stops already-sent codes when phone_otp is switched off", async () => {
      const { challengeId } = await (await send("799000527")).json();
      const code = lastCode();
      (config as any).identityCitizenOtpSecret = "";
      resetIdentityMethodCatalog();
      try {
        const refused = await verify(challengeId, code);
        expect([refused.status, (await refused.json()).code]).toEqual([400, "PHONE_OTP_DISABLED"]);
      } finally {
        (config as any).identityCitizenOtpSecret = otpConfig.identityCitizenOtpSecret;
        resetIdentityMethodCatalog();
      }
      expect((await verify(challengeId, code)).status).toBe(200);
    });

    it("ignores a fixed code that is not six digits", async () => {
      const fake = otpSender();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      Object.assign(config as any, { citizenLoginPasswordOtpFixedEnabled: true, citizenLoginPasswordOtpFixedValue: "1234" });
      setOtpSender(new LogOtpSender());
      resetIdentityMethodCatalog();
      try {
        warnAboutInsecureOtpModes();
        expect(errorLog.mock.calls.some(([line]) => String(line).includes("IGNORED"))).toBe(true);
        expect((await (await send("799000508")).json()).code).toBe("PHONE_OTP_DISABLED");
      } finally {
        Object.assign(config as any, { citizenLoginPasswordOtpFixedEnabled: false, citizenLoginPasswordOtpFixedValue: "123456" });
        setOtpSender(fake);
        resetIdentityMethodCatalog();
        errorLog.mockRestore();
      }
    });

    it("accepts the legacy fixed code only when it is enabled", async () => {
      const disabled = await (await send("799000601")).json();
      const refused = await verify(disabled.challengeId, "123456" === lastCode() ? "654321" : "123456");
      expect((await refused.json()).code).toBe("OTP_INVALID");

      const fake = otpSender();
      Object.assign(config as any, {
        citizenLoginPasswordOtpFixedEnabled: true, citizenLoginPasswordOtpFixedValue: "123456",
      });
      setOtpSender(new LogOtpSender());
      try {
        // No channel: the challenge still issues, and the fixed code proves it once.
        const { challengeId } = await (await send("799000602")).json();
        const ok = await verify(challengeId, "123456");
        expect(ok.status).toBe(200);
        expect((await (await verify(challengeId, "123456")).json()).code).toBe("OTP_EXPIRED");
      } finally {
        (config as any).citizenLoginPasswordOtpFixedEnabled = false;
        setOtpSender(fake);
      }
    });

    it("writes codes to the log only when the log sender is chosen, and warns at startup", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const sender = new LogOtpSender();
        expect(sender.configured).toBe(false);
        await expect(sender.send({
          challengeId: "c1", tenantId: "ke.bomet", phoneNumber: "+254712345678", code: "246810", expiresInSeconds: 300,
        })).rejects.toBeInstanceOf(OtpDeliveryError);
        (config as any).identityCitizenOtpSender = "log";
        (config as any).citizenLoginPasswordOtpFixedEnabled = true;
        expect(sender.configured).toBe(true);
        await sender.send({
          challengeId: "c1", tenantId: "ke.bomet", phoneNumber: "+254712345678", code: "246810", expiresInSeconds: 300,
        });
        expect(warn.mock.calls.some(([line]) => String(line).includes("246810"))).toBe(true);
        warn.mockClear();
        warnAboutInsecureOtpModes();
        const warnings = warn.mock.calls.map(([line]) => String(line)).join("\n");
        expect(warnings).toContain("IDENTITY_CITIZEN_OTP_SENDER=log");
        expect(warnings).toContain("CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED");
      } finally {
        (config as any).identityCitizenOtpSender = "";
        (config as any).citizenLoginPasswordOtpFixedEnabled = false;
        warn.mockRestore();
      }
    });

    it("audits every send, verify and session without raw phone numbers", async () => {
      const entries = await getRedis().xrange(auditStreamKey(), "-", "+");
      const records = entries.map(([, fields]) => {
        const record: Record<string, string> = {};
        for (let index = 0; index < fields.length; index += 2) record[fields[index]] = fields[index + 1];
        return record;
      });
      const kinds = new Set(records.map((record) => `${record.event}:${record.outcome}`));
      for (const kind of ["OTP_SEND:SUCCESS", "OTP_SEND:REFUSED", "OTP_SEND:FAILED",
        "OTP_VERIFY:SUCCESS", "OTP_VERIFY:REFUSED", "SESSION_CREATE:SUCCESS"]) {
        expect(kinds.has(kind), kind).toBe(true);
      }
      const session = records.find((record) => record.event === "SESSION_CREATE")!;
      expect(session.subject).toBeTruthy();
      expect(session.sessionRef).toMatch(/^[0-9a-f]{32}$/);
      expect(JSON.stringify(records)).not.toMatch(/2547\d{8}|7990\d{5}|198\.51\.100/);
    });
  });

  describe("existing tenants, employees and citizens (#2167)", () => {
    const cp = (path: string, body?: unknown) =>
      fetch(`${app()}/internal/identity/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: "Bearer test-control-plane", "Content-Type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    const employeeSelect = (cookie: string) => fetch(`${app()}/identity/v1/contexts/_select`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify({ surface: "employee", tenantId: "ke.bomet" }),
    });
    const legacy = (input: { userName: string; tenantId: string; type: "EMPLOYEE" | "CITIZEN"; mobileNumber: string; roles: string[] }) =>
      digit.addAccount({
        userName: input.userName, name: "Legacy Person", mobileNumber: input.mobileNumber, emailId: null,
        tenantId: input.tenantId, type: input.type, active: true, identificationMark: null,
        roles: input.roles.map((code) => ({ code, tenantId: input.tenantId })), password: "Legacy@123",
      });
    // These legacy operator-route gates retain their old link assertions, but
    // staff issuance now requires the binding and membership produced by item 19.
    const bindLegacyEmployeeFixture = async (uuid: string) => {
      const subject = "identity-user-unlinked";
      const user = await (await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/${subject}`)).json();
      const attributes = { ...user.attributes };
      delete attributes["digit.bindings"]; delete attributes["digit.boundUuids"]; delete attributes["digit.accounts"];
      await kcUpdate(`/users/${subject}`, { attributes });
      await ensureOrganizationMembership({ organizationId: "org-bomet-id", userId: subject });
      await ensureActive({ subject, tenantId: "ke.bomet", uuid, actor: { kind: "migration" } });
      await mirrorPerson(subject);
    };
    const removeLegacyEmployeeFixture = (uuid: string) => removeBinding({ subject: "identity-user-unlinked", tenantId: "ke.bomet", uuid, removedBy: { kind: "operator" } });
    const profileUrl = () => `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/profile`;
    const setProfile = async (profile: unknown) => {
      await fetch(profileUrl(), {
        method: "PUT",
        headers: { Authorization: "Bearer mock-kc-admin-token", "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      resetPhoneTrustCache();
    };
    const auditRecords = async () => (await getRedis().xrange(auditStreamKey(), "-", "+")).map(([, fields]) => {
      const record: Record<string, string> = {};
      for (let index = 0; index < fields.length; index += 2) record[fields[index]] = fields[index + 1];
      return record;
    });
    const originalSender = otpSender();
    const sent: OtpMessage[] = [];

    beforeAll(async () => {
      await kcAdmin("/users", {
        id: "identity-user-unlinked", username: "legacy.employee", email: "legacy.employee@example.com", enabled: true,
      });
      for (const [id, phone] of [
        ["citizen-user-3", "+254799000881"], ["citizen-user-4", "+254799000882"], ["citizen-user-5", "+254799000883"],
      ]) {
        await kcAdmin("/users", {
          id, username: phone, enabled: true,
          attributes: { phoneNumber: [phone], phoneNumberVerified: ["true"] },
        });
      }
      Object.assign(config as any, { identityCitizenOtpSecret: "test-otp-secret", identityCitizenOtpResendSeconds: 0 });
      setOtpSender({ configured: true, async send(message) { sent.push(message); } });
      await kcUpdate("/clients/digit-ui-citizen-uuid", {
        attributes: {
          "login_theme": "digit-citizen", "digit.auth.surface": "citizen",
          "digit.auth.signin.methods": "phone_otp,password",
        },
      });
      resetIdentityMethodCatalog();
    });

    afterAll(async () => {
      Object.assign(config as any, { identityCitizenOtpSecret: "" });
      setOtpSender(originalSender);
      await kcUpdate("/clients/digit-ui-citizen-uuid", {
        attributes: { "login_theme": "digit-citizen", "digit.auth.surface": "citizen", "digit.auth.signin.methods": "password" },
      });
      resetIdentityMethodCatalog();
      await setProfile({ unmanagedAttributePolicy: "ADMIN_EDIT", attributes: [] });
    });

    it("links an existing employee only by admin action, keeping its uuid and roles, and re-checks it on every _select", async () => {
      const account = legacy({ userName: "EMP-LEGACY-1", tenantId: "ke.bomet", type: "EMPLOYEE", mobileNumber: "700000101", roles: ["EMPLOYEE", "GRO", "PGR_LME"] });
      const cookie = await signIn("employee", "unlinked");
      // A signed-in employee with no membership and no link: nothing matches by name.
      const before = await employeeSelect(cookie);
      expect(before.status).toBe(403);
      expect((await before.json()).code).toBe("EMPLOYEE_ACCOUNT_NOT_LINKED");

      const linked = await cp("account-links/_link", {
        actor: "qa-admin",
        links: [{ email: "legacy.employee@example.com", tenantId: "ke.bomet", digitUserName: "EMP-LEGACY-1" }],
      });
      expect((await linked.json()).results).toEqual([expect.objectContaining({
        status: "LINKED", subject: "identity-user-unlinked", digitUserUuid: account.uuid,
      })]);

      await bindLegacyEmployeeFixture(account.uuid);
      const passwordUpdates = digit.stats.passwordUpdates;
      const selected = await employeeSelect(cookie);
      expect(selected.status).toBe(200);
      const token = await selected.json();
      expect(token.UserRequest).toMatchObject({ uuid: account.uuid, userName: "EMP-LEGACY-1" });
      // Same account, same roles; only the password moved to a BFF-held value.
      expect(digit.accounts.get(account.uuid)!.roles.map((role) => role.code).sort()).toEqual(["EMPLOYEE", "GRO", "PGR_LME"]);
      expect(digit.stats.passwordUpdates).toBe(passwordUpdates + 1);
      expect(digit.accounts.get(account.uuid)!.identificationMark).toBeNull();

      // Cached token or not, a deactivated account ends access at the next _select.
      digit.accounts.get(account.uuid)!.active = false;
      const inactive = await employeeSelect(cookie);
      expect(inactive.status).toBe(403);
      expect((await inactive.json()).code).toBe("DIGIT_ACCOUNT_INACTIVE");
      expect(digit.tokens.has(token.access_token)).toBe(false);
      digit.accounts.get(account.uuid)!.active = true;
      // HRMS reactivation restores access with the existing link, before any BFF relink.
      const reactivated = await employeeSelect(cookie);
      expect(reactivated.status).toBe(200);
      expect((await reactivated.json()).UserRequest.uuid).toBe(account.uuid);
      expect(digit.accounts.get(account.uuid)!.active).toBe(true);

      const again = await cp("account-links/_link", {
        links: [{ subject: "identity-user-unlinked", tenantId: "ke.bomet", digitUserUuid: account.uuid }],
      });
      expect((await again.json()).results[0].status).toBe("ALREADY_LINKED");

      const unlinked = await cp("account-links/_unlink", {
        subject: "identity-user-unlinked", tenantId: "ke.bomet", digitUserUuid: account.uuid, actor: "qa-admin",
      });
      expect(await unlinked.json()).toEqual({ removed: true });
      await removeLegacyEmployeeFixture(account.uuid);
      expect((await (await employeeSelect(cookie)).json()).code).toBe("EMPLOYEE_ACCOUNT_NOT_LINKED");
      expect(digit.accounts.get(account.uuid)!.active).toBe(true);
    });

    it("answers ACCOUNT_LOCKED for a locked account, without touching its password (item 6)", async () => {
      const account = legacy({ userName: "EMP-LEGACY-LOCK", tenantId: "ke.bomet", type: "EMPLOYEE", mobileNumber: "700000109", roles: ["EMPLOYEE"] });
      const cookie = await signIn("employee", "unlinked");
      const linked = await cp("account-links/_link", {
        links: [{ email: "legacy.employee@example.com", tenantId: "ke.bomet", digitUserName: "EMP-LEGACY-LOCK" }],
      });
      expect((await linked.json()).results[0].status).toBe("LINKED");

      await bindLegacyEmployeeFixture(account.uuid);
      digit.accounts.get(account.uuid)!.accountLocked = true;
      const locked = await employeeSelect(cookie);
      const body = await expectContractError(locked, contractRoute("POST", "/identity/v1/contexts/_select"), "ACCOUNT_LOCKED");
      expect(body.error).toBe("This account is locked");

      digit.accounts.get(account.uuid)!.accountLocked = false;
      expect((await employeeSelect(cookie)).status).toBe(200);
      await cp("account-links/_unlink", { subject: "identity-user-unlinked", tenantId: "ke.bomet", digitUserUuid: account.uuid });
      await removeLegacyEmployeeFixture(account.uuid);
    });

    it("refuses links that are unproven or already owned, item by item", async () => {
      const owned = legacy({ userName: "EMP-LEGACY-2", tenantId: "ke.bomet", type: "EMPLOYEE", mobileNumber: "700000102", roles: ["EMPLOYEE"] });
      await kcAdmin("/users", { id: "second-admin-user", username: "second", email: "second@example.com", enabled: true });
      const managed = [...digit.accounts.values()].find((account) => account.userName.startsWith("kcbff-"))!;
      const response = await cp("account-links/_link", {
        links: [
          { subject: "identity-user-unlinked", tenantId: "ke.bomet", digitUserUuid: owned.uuid },
          { subject: "second-admin-user", tenantId: "ke.bomet", digitUserUuid: owned.uuid },
          { subject: "second-admin-user", tenantId: managed.tenantId, digitUserUuid: managed.uuid },
          { subject: "no-such-user", tenantId: "ke.bomet", digitUserUuid: owned.uuid },
          { subject: "second-admin-user", tenantId: "ke.bomet", digitUserName: "NOBODY" },
          { subject: "second-admin-user", tenantId: "zz", digitUserUuid: owned.uuid },
        ],
      });
      expect((await response.json()).results.map((result: { status: string; code?: string }) => result.code || result.status))
        .toEqual(["LINKED", "DIGIT_ACCOUNT_LINKED_ELSEWHERE", "DIGIT_ACCOUNT_MANAGED", "IDENTITY_NOT_FOUND",
          "DIGIT_ACCOUNT_NOT_FOUND", "TENANT_NOT_FOUND"]);
      const empty = await cp("account-links/_link", { links: [] });
      expect([empty.status, (await empty.json()).code]).toEqual([400, "INVALID_REQUEST"]);
      await cp("account-links/_unlink", { subject: "identity-user-unlinked", tenantId: "ke.bomet", digitUserUuid: owned.uuid });
    });

    it("links an existing citizen after a BFF phone OTP, and fails closed on an ambiguous number", async () => {
      const existing = legacy({ userName: "799000771", tenantId: "ke", type: "CITIZEN", mobileNumber: "799000771", roles: ["CITIZEN"] });
      const signInByOtp = async (mobileNumber: string) => {
        const sentBefore = sent.length;
        const { challengeId } = await (await fetch(`${app()}/identity/v1/citizen/otp/_send`, {
          method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
          body: JSON.stringify({ tenantSlug: "bomet-county", mobileNumber }),
        })).json();
        expect(sent.length).toBe(sentBefore + 1);
        const verified = await fetch(`${app()}/identity/v1/citizen/otp/_verify`, {
          method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
          body: JSON.stringify({ tenantSlug: "bomet-county", challengeId, code: sent[sent.length - 1].code }),
        });
        return cookieFrom(verified, "digit_identity_session_citizen")!;
      };
      const creates = digit.stats.creates;
      const selected = await citizenSelect(await signInByOtp("799000771"));
      expect(selected.status).toBe(200);
      expect((await selected.json()).UserRequest).toMatchObject({ uuid: existing.uuid, type: "CITIZEN" });
      expect(digit.stats.creates).toBe(creates);

      legacy({ userName: "799000772", tenantId: "ke", type: "CITIZEN", mobileNumber: "799000772", roles: ["CITIZEN"] });
      legacy({ userName: "citizen-dup-772", tenantId: "ke", type: "CITIZEN", mobileNumber: "799000772", roles: ["CITIZEN"] });
      const ambiguous = await citizenSelect(await signInByOtp("799000772"));
      expect(ambiguous.status).toBe(409);
      expect((await ambiguous.json()).code).toBe("CITIZEN_ACCOUNT_AMBIGUOUS");
      expect(digit.stats.creates).toBe(creates);
    });

    it("trusts a Keycloak-verified phone only when users cannot edit it", async () => {
      const userEditable = { name: "phoneNumber", permissions: { view: ["admin", "user"], edit: ["admin", "user"] } };
      const adminOnly = (name: string) => ({ name, permissions: { view: ["admin", "user"], edit: ["admin"] } });
      for (const [profile, trusted] of [
        [{ unmanagedAttributePolicy: "ADMIN_EDIT", attributes: [] }, true],
        [{ unmanagedAttributePolicy: "ADMIN_VIEW", attributes: [] }, true],
        [{ attributes: [] }, true],
        [{ unmanagedAttributePolicy: "ENABLED", attributes: [] }, false],
        [{ unmanagedAttributePolicy: "ADMIN_EDIT", attributes: [userEditable] }, false],
        [{ unmanagedAttributePolicy: "ENABLED", attributes: [adminOnly("phoneNumber"), adminOnly("phoneNumberVerified")] }, true],
      ] as const) {
        await setProfile(profile);
        expect(await keycloakPhoneIsAdminControlled(), JSON.stringify(profile)).toBe(trusted);
      }

      const a = legacy({ userName: "799000881", tenantId: "ke", type: "CITIZEN", mobileNumber: "799000881", roles: ["CITIZEN"] });
      const b = legacy({ userName: "799000882", tenantId: "ke", type: "CITIZEN", mobileNumber: "799000882", roles: ["CITIZEN"] });
      // Users can edit their phone: the claim proves nothing, so no link.
      await setProfile({ unmanagedAttributePolicy: "ENABLED", attributes: [] });
      const untrusted = await citizenSelect(await signIn("citizen", "legacya"));
      expect(untrusted.status).toBe(200);
      expect((await untrusted.json()).UserRequest.uuid).not.toBe(a.uuid);
      // Admin-only phone: the verified claim links the existing account.
      await setProfile({ unmanagedAttributePolicy: "ADMIN_EDIT", attributes: [] });
      const trusted = await citizenSelect(await signIn("citizen", "legacyb"));
      expect(trusted.status).toBe(200);
      expect((await trusted.json()).UserRequest.uuid).toBe(b.uuid);
    });

    it("answers 503 when the phone-trust check fails, and links on the retry instead of splitting the citizen", async () => {
      const c = legacy({ userName: "799000883", tenantId: "ke", type: "CITIZEN", mobileNumber: "799000883", roles: ["CITIZEN"] });
      await setProfile({ unmanagedAttributePolicy: "ADMIN_EDIT", attributes: [] });
      await fetch(`${config.keycloakAdminUrl}/__test/faults`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET", path: "/users/profile", status: 503, count: 1 }),
      });
      resetPhoneTrustCache();
      const creates = digit.stats.creates;
      const failed = await citizenSelect(await signIn("citizen", "legacyc"));
      expect(failed.status).toBe(503);
      expect(digit.stats.creates).toBe(creates);
      const retried = await citizenSelect(await signIn("citizen", "legacyc"));
      expect((await retried.json()).UserRequest.uuid).toBe(c.uuid);
    });

    it("never writes masked or partial data over a linked employee's record", async () => {
      const account = legacy({ userName: "EMP-LEGACY-3", tenantId: "ke.bomet", type: "EMPLOYEE", mobileNumber: "700000103", roles: ["EMPLOYEE", "GRO"] });
      Object.assign(digit.accounts.get(account.uuid)!, { pan: "ABCDE1234F", gender: "FEMALE", emailId: "emp3@example.com" });
      await kcAdmin("/users", { id: "linked-employee-3", username: "emp3", email: "emp3.kc@example.com", enabled: true });
      await cp("account-links/_link", { links: [{ subject: "linked-employee-3", tenantId: "ke.bomet", digitUserUuid: account.uuid }] });
      const identity = linkedIdentity(config.keycloakIssuer, "linked-employee-3", {
        userType: "EMPLOYEE", tenantId: "ke.bomet", digitUuid: account.uuid,
      });
      const { sessionId } = await createIdentitySession(
        { accessToken: "test-access", accessExpiresIn: 600 },
        { sub: "linked-employee-3", email: "emp3.kc@example.com" }, config.keycloakBffClientId,
      );
      const login = () => managedUserLogin(identity, sessionId);
      const updates = digit.stats.updates;
      digit.setMaskSearchMobileNumbers(true);
      try {
        await expect(login()).rejects.toMatchObject({ status: 503, code: "DIGIT_PII_MASKED" });
        expect(digit.stats.updates).toBe(updates);
        expect(digit.accounts.get(account.uuid)!.mobileNumber).toBe("700000103");
      } finally {
        digit.setMaskSearchMobileNumbers(false);
      }
      await login();
      // The whole record went back: nothing egov-user would clear was lost.
      expect(digit.accounts.get(account.uuid)).toMatchObject({
        mobileNumber: "700000103", pan: "ABCDE1234F", gender: "FEMALE", emailId: "emp3@example.com",
        roles: [{ code: "EMPLOYEE", tenantId: "ke.bomet" }, { code: "GRO", tenantId: "ke.bomet" }],
      });
    });

    it("lets an admin undo a citizen link, and a blocked link does not re-form", async () => {
      const b = [...digit.accounts.values()].find((account) => account.userName === "799000882")!;
      expect((await (await cp("account-links?subject=citizen-user-4")).json()).links)
        .toEqual([{ userType: "CITIZEN", tenantId: "ke", digitUuid: b.uuid }]);
      const undo = await cp("account-links/_unlink", {
        subject: "citizen-user-4", userType: "CITIZEN", tenantId: "ke", digitUserUuid: b.uuid, block: true, actor: "qa-admin",
      });
      expect(await undo.json()).toEqual({ removed: true });
      const blocked = await citizenSelect(await signIn("citizen", "legacyb"));
      expect(blocked.status).toBe(409);
      expect((await blocked.json()).code).toBe("CITIZEN_ACCOUNT_LINK_BLOCKED");
      // An explicit admin link overrides the block.
      const relinked = await cp("account-links/_link", {
        links: [{ subject: "citizen-user-4", userType: "CITIZEN", tenantId: "ke", digitUserUuid: b.uuid }],
      });
      expect((await relinked.json()).results[0].status).toBe("LINKED");
      expect((await (await citizenSelect(await signIn("citizen", "legacyb"))).json()).UserRequest.uuid).toBe(b.uuid);
    });

    it("audits every link, refusal and unlink with its method and actor", async () => {
      const records = (await auditRecords()).filter((record) => record.event.startsWith("ACCOUNT_LINK_"));
      const seen = new Set(records.map((record) => `${record.event}:${record.method || "-"}`));
      for (const kind of ["ACCOUNT_LINK_CREATE:ADMIN", "ACCOUNT_LINK_CREATE:VERIFIED_PHONE",
        "ACCOUNT_LINK_REFUSED:ADMIN", "ACCOUNT_LINK_REFUSED:VERIFIED_PHONE", "ACCOUNT_LINK_REVOKE:-"]) {
        expect(seen.has(kind), kind).toBe(true);
      }
      expect(records.some((record) => record.actor === "control-plane:qa-admin")).toBe(true);
      expect(records.every((record) => record.subject && record.digitUserUuid !== undefined || record.reason)).toBe(true);
    });

    it("backfills root tenant routes with the tenant id as slug, and never renames one", async () => {
      Object.assign(config as any, { identityTenantRouteBackfillRoots: ["ke", "ke.bomet", "zz"] });
      const dry = await (await cp("tenant-routes/_backfill", { dryRun: true })).json();
      expect(dry).toEqual({
        created: ["ke"],
        skipped: [{ tenantId: "ke.bomet", reason: "NOT_ROOT" }, { tenantId: "zz", reason: "NOT_ACTIVE" }],
        conflicts: [],
      });
      expect((await fetch(`${app()}/identity/v1/tenant-contexts/ke`)).status).toBe(404);

      const run = await (await cp("tenant-routes/_backfill", { actor: "deploy" })).json();
      expect(run.created).toEqual(["ke"]);
      const route = await (await fetch(`${app()}/identity/v1/tenant-contexts/ke`)).json();
      expect(route.tenant).toMatchObject({ urlSlug: "ke", tenantId: "ke" });

      // An operator renames the slug; later runs leave it alone.
      const organization = (await readTenantMappingForTenant("ke"))!;
      await kcUpdate(`/organizations/${organization.organizationId}`, {
        attributes: { "digit.rootTenantId": ["ke"], "digit.urlSlug": ["kenya"] },
      });
      clearTenantMappingCache();
      const rerun = await (await cp("tenant-routes/_backfill", {})).json();
      expect(rerun).toMatchObject({ created: [], conflicts: [] });
      expect(rerun.skipped).toContainEqual({ tenantId: "ke", reason: "ALREADY_MAPPED" });
      clearTenantMappingCache();
      expect((await readTenantMappingForTenant("ke"))!.urlSlug).toBe("kenya");
      expect((await auditRecords()).some((record) => record.event === "TENANT_ROUTE_BACKFILL" && record.actor === "control-plane:deploy"))
        .toBe(true);
    });
  });
});

// These gates start at the authenticated BFF session boundary. The OIDC
// callback that creates that session is exercised by the sign-in gates above.
describe("binding workspace public routes", () => {
  const app = () => `http://localhost:${getAppPort()}/identity/v1`;
  let adminCookie: string;
  let adminAccount: ReturnType<typeof digit.addAccount>;
  const employee = (name: string) => digit.addAccount({ userName: name, name,
    tenantId: "ug", type: "EMPLOYEE", active: true, mobileNumber: "712000999", emailId: null,
    identificationMark: null, password: "Employee@123", roles: [{ code: "EMPLOYEE", tenantId: "ug" }] });
  const cookieFor = async (subject: string, surface: "configurator" | "employee" = "configurator") => {
    const { sessionId } = await createIdentitySession({ accessToken: "server-test-token", accessExpiresIn: 3600 },
      { sub: subject, email: `${subject}@example.test` }, surface === "employee" ? config.keycloakEmployeeClientId : config.keycloakBffClientId,
      { surface, ...(surface === "employee" && { boundTenant: { tenantId: "ug", rootTenantId: "ug", urlSlug: "binding-workspace", name: "Binding Workspace" } }) });
    return `${surface === "employee" ? config.identityEmployeeCookieName : config.identityCookieName}=${sessionId}`;
  };
  const post = (path: string, cookie: string, body: unknown) => fetch(`${app()}${path}`, {
    method: "POST", headers: { Cookie: cookie, Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const read = (path: string, cookie: string) => fetch(`${app()}${path}`, { headers: { Cookie: cookie } });
  const kcUser = async (subject: string) => (await fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/users/${subject}`)).json();
  beforeAll(async () => {
    await kcAdmin("/organizations", { id: "binding-workspace", alias: "binding-workspace", name: "Binding Workspace", enabled: true,
      attributes: { "digit.rootTenantId": ["ug"], "digit.urlSlug": ["binding-workspace"], "digit.lifecycle": ["ACTIVE"] } });
    await kcAdmin("/users", { id: "binding-admin", username: "binding-admin", email: "binding-admin@example.test", enabled: true });
    adminAccount = employee("BINDING-ADMIN");
    adminAccount.roles.push({ code: "ACCOUNT_ADMIN", tenantId: "ug" });
    await ensureActive({ subject: "binding-admin", tenantId: "ug", uuid: adminAccount.uuid, actor: { kind: "migration" } });
    await ensureOrganizationMembership({ organizationId: "binding-workspace", userId: "binding-admin" });
    await mirrorPerson("binding-admin");
    adminCookie = await cookieFor("binding-admin");
  });

  it("links a new employee, discovers its inviting workspace without onboarding, and selects its existing DIGIT account", async () => {
    const account = employee("BINDING-NEW");
    const linked = await post("/workspace-members/_link", adminCookie, { tenantId: "ug", digitUuid: account.uuid, email: "binding-new@example.test" });
    expect(linked.status).toBe(201);
    const result = await linked.json();
    expect(result).toMatchObject({ identityUserCreated: true, activationEmailSent: true, binding: { state: "active" } });
    const cookie = await cookieFor(result.binding.subject);
    expect(await (await read("/session", cookie)).json()).toMatchObject({ pendingInvitations: [] });
    expect(await (await read("/tenants", cookie)).json()).toMatchObject({ onboardingRequired: false, selectionRequired: false,
      tenants: [{ tenantId: "ug", name: "Binding Workspace" }] });
    const selected = await post("/contexts/_select", cookie, { tenantId: "ug" });
    expect(selected.status).toBe(200);
    expect(await selected.json()).toMatchObject({ UserRequest: { uuid: account.uuid, userName: account.userName } });
    account.active = false;
    expect(await (await read("/tenants", cookie)).json()).toMatchObject({ onboardingRequired: false,
      tenants: [{ tenantId: "ug", code: "DIGIT_ACCOUNT_INACTIVE" }] });
    expect(await (await post("/contexts/_select", cookie, { tenantId: "ug" })).json()).toMatchObject({ code: "DIGIT_ACCOUNT_INACTIVE" });
    account.active = true;
    expect((await post("/contexts/_select", cookie, { tenantId: "ug" })).status).toBe(200);
  });

  it.each(["configurator", "employee"] as const)("shows and accepts an existing person's invitation on %s, then selects its DIGIT account", async (surface) => {
    const subject = `binding-existing-${surface}`;
    await kcAdmin("/users", { id: subject, username: subject, email: `${subject}@example.test`, enabled: true });
    const account = employee(`BINDING-EXISTING-${surface}`);
    const response = await post("/workspace-members/_link", adminCookie, { tenantId: "ug", digitUuid: account.uuid, email: `${subject}@example.test` });
    expect(response.status).toBe(200);
    const invite = await response.json();
    expect(invite).toMatchObject({ identityUserCreated: false, binding: { state: "pending" } });
    const cookie = await cookieFor(subject, surface);
    expect(await (await read(`/session?surface=${surface}`, cookie)).json()).toMatchObject({ pendingInvitations: [{ tenantId: "ug", invitationVersion: invite.binding.invitationVersion }] });
    expect(await (await post("/contexts/_select", cookie, { tenantId: "ug", surface })).json()).toMatchObject({ code: "PENDING_INVITATION" });
    const body = { tenantId: "ug", invitationVersion: invite.binding.invitationVersion };
    expect((await post(`/workspace-invitations/_accept?surface=${surface}`, cookie, body)).status).toBe(200);
    expect((await post(`/workspace-invitations/_accept?surface=${surface}`, cookie, body)).status).toBe(200);
    expect(await (await read(`/session?surface=${surface}`, cookie)).json()).toMatchObject({ pendingInvitations: [] });
    expect(await (await post("/contexts/_select", cookie, { tenantId: "ug", surface })).json()).toMatchObject({ UserRequest: { uuid: account.uuid } });
    expect(await (await read("/workspace-members?tenantId=ug", adminCookie)).json()).toMatchObject({ members: expect.arrayContaining([
      expect.objectContaining({ subject: subject, state: "active", digitUuid: account.uuid }),
    ]) });
  });

  it("rejects a removed or cross-tenant ACCOUNT_ADMIN role during the same session", async () => {
    const account = employee("BINDING-DENIED");
    const roles = [...adminAccount.roles];
    try {
      adminAccount.roles = [{ code: "EMPLOYEE", tenantId: "ug" }];
      const body = { tenantId: "ug", digitUuid: account.uuid, email: "binding-denied@example.test" };
      const removed = await post("/workspace-members/_link", adminCookie, body);
      expect(removed.status).toBe(403); expect(await removed.json()).toMatchObject({ code: "ADMIN_REQUIRED" });
      adminAccount.roles.push({ code: "ACCOUNT_ADMIN", tenantId: "ke.bomet" });
      const wrongTenant = await post("/workspace-members/_link", adminCookie, body);
      expect(wrongTenant.status).toBe(403); expect(await wrongTenant.json()).toMatchObject({ code: "ADMIN_REQUIRED" });
    } finally { adminAccount.roles = roles; }
  });

  it("revokes and forgets a staff token when mirroring fails after issuance", async () => {
    const account = employee("BINDING-CLEANUP");
    const linked = await post("/workspace-members/_link", adminCookie, { tenantId: "ug", digitUuid: account.uuid, email: "binding-cleanup@example.test" });
    const { binding } = await linked.json();
    const cookie = await cookieFor(binding.subject);
    const spy = vi.spyOn(syncMirror, "mirrorPerson").mockRejectedValueOnce(new BindingError("IDENTITY_UNAVAILABLE", "Injected mirror failure"));
    try {
      const response = await post("/contexts/_select", cookie, { tenantId: "ug" });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
      expect(spy).toHaveBeenCalledOnce();
      expect([...digit.tokens.values()].some(token => token.uuid === account.uuid)).toBe(false);
      expect(await getRedis().exists(tokenKey(account), tokenHoldersKey(account))).toBe(0);
      expect(await getRedis().sismember(personTokensKey(binding.subject), accountId(account))).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it("revokes and forgets a citizen token if the final session fence fails", async () => {
    const subject = "binding-citizen-cleanup";
    await kcAdmin("/users", { id: subject, username: subject, enabled: true,
      attributes: { phoneNumber: ["+254799123987"], phoneNumberVerified: ["true"] } });
    const { sessionId } = await createIdentitySession({ accessToken: "server-test-token", accessExpiresIn: 3600 },
      { sub: subject, azp: config.keycloakCitizenClientId }, config.keycloakCitizenClientId,
      { surface: "citizen", boundTenant: { tenantId: "ke.bomet", rootTenantId: "ke.bomet", urlSlug: "bomet-county", name: "Bomet County" } });
    const original = sessionStore.requireCurrentSession;
    let checks = 0;
    const spy = vi.spyOn(sessionStore, "requireCurrentSession").mockImplementation(async (lease, id) => {
      if (++checks === 3) throw new BindingError("SESSION_REVOKED", "Injected final fence failure");
      return original(lease, id);
    });
    try {
      const response = await post("/contexts/citizen/_select", `${config.identityCitizenCookieName}=${sessionId}`, {});
      expect(checks).toBe(3);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "SESSION_REVOKED" });
      const account = [...digit.accounts.values()].find(account => account.mobileNumber === "799123987")!;
      expect(account).toBeDefined();
      expect([...digit.tokens.values()].some(token => token.uuid === account.uuid)).toBe(false);
      expect(await getRedis().exists(tokenKey(account), tokenHoldersKey(account))).toBe(0);
      expect(await getRedis().sismember(personTokensKey(subject), accountId(account))).toBe(0);
    } finally { spy.mockRestore(); }
  });

  it("records a newly signed-in citizen before issuance and propagates its changed verified phone to the same DIGIT account", async () => {
    digit.mdms.set(digit.mdmsKey("ke", "common-masters.MobileNumberValidation"),
      structuredClone(digit.mdms.get(digit.mdmsKey("ke.bomet", "common-masters.MobileNumberValidation"))!));
    // Mobile validation is fetched fresh; no former branding cache to clear.
    const subject = "binding-citizen-phone";
    await kcAdmin("/users", { id: subject, username: subject, enabled: true,
      attributes: { phoneNumber: ["+254799123981"], phoneNumberVerified: ["true"] } });
    const { sessionId } = await createIdentitySession({ accessToken: "server-test-token", accessExpiresIn: 3600 },
      { sub: subject, azp: config.keycloakCitizenClientId }, config.keycloakCitizenClientId,
      { surface: "citizen", boundTenant: { tenantId: "ke.bomet", rootTenantId: "ke.bomet", urlSlug: "bomet-county", name: "Bomet County" } });
    const original = citizenTokenMinter();
    let checkedBeforeIssuance = false;
    setCitizenTokenMinter({ async mint(account, ...args) {
      const user = await kcUser(subject);
      expect(JSON.parse(user.attributes["digit.accounts"][0]).entries).toContainEqual(expect.objectContaining({
        kind: "citizen", tenantId: "ke", uuid: account.uuid, active: true,
      }));
      checkedBeforeIssuance = true;
      return original.mint(account, ...args);
    } });
    let accountUuid: string;
    try {
      const selected = await post("/contexts/citizen/_select", `${config.identityCitizenCookieName}=${sessionId}`, {});
      expect(selected.status).toBe(200);
      accountUuid = (await selected.json()).UserRequest.uuid;
      expect(checkedBeforeIssuance).toBe(true);
    } finally { setCitizenTokenMinter(original); }
    const user = await kcUser(subject);
    expect(user.attributes["digit.citizenRegistrations"]).toHaveLength(1);
    await kcUpdate(`/users/${subject}`, { attributes: { ...user.attributes, phoneNumber: ["+254799123982"] } });
    const count = digit.accounts.size;
    expect(await propagateIdentifiers(subject)).toMatchObject({ written: 1, skipped: 0 });
    expect(digit.accounts.get(accountUuid!)!).toMatchObject({ mobileNumber: "799123982", countryCode: "+254" });
    expect(digit.accounts.size).toBe(count);
  });

  it.each(["stale", "expired", "removed"])("returns INVITATION_STALE for a %s invitation and releases removed UUIDs", async (kind) => {
    const subject = `binding-${kind}`;
    await kcAdmin("/users", { id: subject, username: subject, email: `${subject}@example.test`, enabled: true });
    const account = employee(`BINDING-${kind.toUpperCase()}`);
    const linked = await post("/workspace-members/_link", adminCookie, { tenantId: "ug", digitUuid: account.uuid, email: `${subject}@example.test` });
    expect(linked.status).toBe(200);
    const { binding } = await linked.json();
    const cookie = await cookieFor(subject);
    if (kind === "expired") {
      const user = await kcUser(subject);
      const doc = JSON.parse(user.attributes["digit.bindings"][0]);
      doc.bindings[0].expiresAt = Date.now() - 1;
      await kcUpdate(`/users/${subject}`, { attributes: { ...user.attributes, "digit.bindings": [JSON.stringify(doc)] } });
    }
    if (kind === "removed") expect((await post("/workspace-members/_remove", adminCookie, { tenantId: "ug", digitUuid: account.uuid })).status).toBe(200);
    // Removal revokes old sessions; a fresh authenticated session still cannot accept the tombstone.
    const activeCookie = kind === "removed" ? await cookieFor(subject) : cookie;
    const accepted = await post("/workspace-invitations/_accept", activeCookie,
      { tenantId: "ug", invitationVersion: binding.invitationVersion + (kind === "stale" ? 1 : 0) });
    expect(accepted.status).toBe(409); expect(await accepted.json()).toMatchObject({ code: "INVITATION_STALE" });
    if (kind !== "stale") {
      expect((await kcUser(subject)).attributes["digit.boundUuids"] || []).not.toContain(account.uuid);
      const retry = await post("/workspace-members/_link", adminCookie, { tenantId: "ug", digitUuid: account.uuid, email: `replacement-${kind}@example.test` });
      expect(retry.status).toBe(201);
    }
  });
});

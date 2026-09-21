import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { getIssuer } from "../helpers.js";
import { createFakeDigitUser } from "../../mocks/fake-digit-user.js";
import { getRedis } from "../../src/infrastructure/redis.js";
import { managedAccountsKey } from "../../src/modules/managed-accounts/managed-account-service.js";
import {
  createIdentitySession,
  saveSelectedIdentityContext,
} from "../../src/modules/sessions/session-store.js";
import {
  getIdentityAppPort as getAppPort,
  startIdentityTestApp as startTestApp,
  stopIdentityTestApp as stopTestApp,
} from "./identity-test-app.js";

const digit = createFakeDigitUser({
  tenants: ["ke", "ke.bomet", "ke.kisumu", "ke.nakuru", "ke.nyeri"],
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
  (config as any).identityRedirectUri =
    "http://localhost:18200/identity/v1/callback";
  (config as any).identityPostLoginRedirect = "/after-login";
  (config as any).identityAllowedOrigins = ["http://localhost:3000", "http://localhost:5173"];
  (config as any).identityCookieSecure = false;
  (config as any).identityCookieSameSite = "Lax";
  (config as any).identityTrustProxyHops = 2;
  (config as any).identityAuthMethods = [
    { id: "password", label: "Password", type: "password", intents: ["signin"] },
    { id: "google", label: "Google", type: "oauth", idpHint: "google", intents: ["signin", "signup"] },
    { id: "magic_link", label: "Email me a sign-in link", type: "magic_link", intents: ["signup"] },
  ];
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
      id, alias, name, enabled: true, attributes: { "digit.rootTenantId": [tenantId] },
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
  it("provisions Organizations and BFF-managed DIGIT accounts through the control plane", async () => {
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
      method: "POST", headers, body: JSON.stringify(body),
    });

    expect((await post("/organizations/_ensure", {
      tenantId: "ke.missing", alias: "missing", name: "Missing",
    })).status).toBe(409);

    const ensureOrganization = async (tenantId: string, alias: string) => {
      const response = await post("/organizations/_ensure", { tenantId, alias, name: alias });
      expect(response.status).toBe(200);
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
    expect((await post("/memberships/_ensure", { organizationId: nakuru, userId: memberId })).status)
      .toBe(409);

    const first = await post("/memberships/_ensure", {
      organizationId: nakuru, userId: memberId, mobileNumber: "0712345678",
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ created: true });
    const repeat = await post("/memberships/_ensure", { organizationId: nakuru, userId: memberId });
    expect(await repeat.json()).toEqual({
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
    const second = await post("/memberships/_ensure", { organizationId: nyeri, userId: memberId });
    const secondBody = await second.json();
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
    expect(digit.accounts.size).toBe(3);

    const reconciliation = await post("/reconciliation/_run", {});
    expect(reconciliation.status).toBe(200);
    expect(await reconciliation.json()).toMatchObject({
      acquired: true, organizations: 4, unchanged: 2, unprovisioned: 2, failures: [],
    });
  });

  it("exposes configured methods and rejects unknown methods", async () => {
    const methods = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods`,
    );
    expect(methods.status).toBe(200);
    expect(await methods.json()).toEqual({ methods: [
      { id: "password", label: "Password", type: "password", intents: ["signin"] },
      { id: "google", label: "Google", type: "oauth", idpHint: "google", intents: ["signin", "signup"] },
      { id: "magic_link", label: "Email me a sign-in link", type: "magic_link", intents: ["signup"] },
    ] });

    const signinMethods = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods?intent=signin`,
    );
    expect((await signinMethods.json()).methods.map((method: { id: string }) => method.id))
      .toEqual(["password", "google"]);
    const signupMethods = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/auth-methods?intent=signup`,
    );
    expect((await signupMethods.json()).methods.map((method: { id: string }) => method.id))
      .toEqual(["google", "magic_link"]);

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

    const magic = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=magic_link&intent=signup&returnTo=%2Fconfigurator%2Fsignup`,
      { redirect: "manual" },
    );
    expect(magic.status).toBe(302);
    const magicUrl = new URL(magic.headers.get("location")!);
    expect(magicUrl.searchParams.get("client_id")).toBe(
      "digit-identity-bff-magic-link",
    );
    expect(magicUrl.searchParams.has("client_secret")).toBe(false);
    expect(magicUrl.searchParams.has("kc_idp_hint")).toBe(false);
    const magicState = magicUrl.searchParams.get("state")!;
    const magicNonce = magicUrl.searchParams.get("nonce")!;
    const magicLoginCookie = magic.headers.get("set-cookie")!.split(";", 1)[0];
    const callback = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/callback?code=valid-code:${encodeURIComponent(magicNonce)}&state=${encodeURIComponent(magicState)}`,
      { redirect: "manual", headers: { Cookie: magicLoginCookie } },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("location")).toBe("/configurator/signup");
    const magicSessionCookie = callback.headers.getSetCookie()
      .find((value) => value.startsWith("digit_identity_session="))!
      .split(";", 1)[0];
    // The mock access token expires immediately. Refresh proves the session
    // retained the magic-link client instead of falling back to the password client.
    expect((await fetch(
      `http://localhost:${getAppPort()}/identity/v1/session`,
      { headers: { Cookie: magicSessionCookie } },
    )).status).toBe(200);
  });

  it("returns provider failures through a one-time, browser-safe result", async () => {
    const authorize = await fetch(
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=google&intent=signin&returnTo=%2Fconfigurator%2Flogin`,
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
    expect(resultLocation.pathname).toBe("/configurator/login");
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
      `http://localhost:${getAppPort()}/identity/v1/authorize?method=google&returnTo=%2Fconfigurator%2Flogin`,
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
      body: JSON.stringify({ email, returnTo: "/configurator/login" }),
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
    expect(completion.pathname).toBe("/identity/v1/password/setup-complete");
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
    expect(completeLocation.pathname).toBe("/configurator/login");
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
        returnTo: "/configurator/login",
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
      body: JSON.stringify({ returnTo: "/configurator/login" }),
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
      const membership = await ensure("/memberships/_ensure", {
        organizationId, userId: "identity-user-1", mobileNumber: "0712345678",
      });
      expect(membership.status).toBe(200);
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
    expect(authorizeUrl.origin).toBe("http://localhost:9999");
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
      .toEqual(["ke.bomet"]);
    expect(managedAccount.roles.some((role) => role.tenantId === "ke.kisumu")).toBe(false);
    managedAccount.roles = grantedRoles;

    // Onboarding can add membership after the access token was issued. Tenant
    // discovery reads that membership live, so the browser need not sign in again.
    await fetch(
      `${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}/organizations/${nakuruOrganizationId}/members`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify("identity-user-1") },
    );
    expect((await ensure("/memberships/_ensure", {
      organizationId: nakuruOrganizationId,
      userId: "identity-user-1",
      mobileNumber: "0712345678",
    })).status).toBe(200);
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
      .toEqual(["ke.bomet", "ke.kisumu", "ke.nakuru"]);

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

    // The Keycloak user attribute is the durable inventory. A full scan can
    // still deactivate the former tenant account after the Redis index is lost.
    await getRedis().del(managedAccountsKey());
    const reconciled = await ensure("/reconciliation/_run", {});
    expect(reconciled.status).toBe(200);
    expect(managedAccount.active).toBe(false);

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
      expect((await control("/memberships/_ensure", {
        organizationId: "org-bomet-id", userId, mobileNumber: "0712345678",
      })).status).toBe(200);
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
    const selected = await fetch(
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
    );
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

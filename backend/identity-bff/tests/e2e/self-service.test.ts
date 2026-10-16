import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { createIdentitySession, createPhoneOtpSession, deleteIdentitySession, getIdentitySession, kcSessionSubjectKey, listPersonSessions } from "../../src/modules/sessions/session-store.js";
import { applyKeycloakEvent } from "../../src/modules/revocation/event-effects.js";
import { drainRevocationJobs } from "../../src/modules/revocation/index.js";
import { getRedis } from "../../src/infrastructure/redis.js";
import { startIdentityTestApp, stopIdentityTestApp } from "./identity-test-app.js";
import { ACCOUNT_ACTIONS } from "../../src/modules/authentication/account-service.js";

let base: string;
const saved = { ...config };
const prefix = `self-service-${process.pid}`;
const tokens = { accessToken: "access", refreshToken: "refresh", accessExpiresIn: 600, refreshExpiresIn: 3600 };
const admin = (path: string, body: unknown, method = "PUT") => fetch(`${config.keycloakAdminUrl}/admin/realms/${config.keycloakOrganizationRealm}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const session = (sub = "identity-user-1") => createIdentitySession(tokens, { sub, email: "test@example.test" }, config.keycloakBffClientId);
const cookie = (sid: string) => `${config.identityCookieName}=${sid}`;
const result = async (response: Response) => {
  const id = new URL(response.headers.get("location")!, "http://x").searchParams.get("authResult");
  return (await fetch(`${base}/identity/v1/auth-results/${id}`)).json();
};
beforeAll(async () => {
  Object.assign(config, { cachePrefix: prefix, keycloakOrganizationRealm: "self-service", keycloakBffClientSecret: "test-bff-secret", keycloakOidcBackchannelUrl: process.env.KEYCLOAK_ISSUER, identityCookieSecure: false });
  base = `http://localhost:${await startIdentityTestApp()}`;
  await admin("/clients/digit-identity-bff-uuid", { attributes: { "digit.auth.account.actions": ACCOUNT_ACTIONS.join(",") } });
  await admin("/users", { id: "identity-user-1", username: "self-service-user", enabled: true, credentials: [{ id: "password-1", type: "password" }, { id: "otp-1", type: "otp" }], federatedIdentities: [{ identityProvider: "google", userId: "google-id" }] }, "POST");
});
afterAll(async () => {
  const keys = await getRedis().keys(`${prefix}:*`); if (keys.length) await getRedis().del(...keys);
  await stopIdentityTestApp(); Object.assign(config, saved);
});
describe("account self-service", () => {
  it("returns safe account/session metadata only on request", async () => {
    const { sessionId } = await session();
    const headers = { Cookie: cookie(sessionId) };
    expect(await (await fetch(`${base}/identity/v1/session`, { headers })).json()).not.toHaveProperty("account");
    const body = await (await fetch(`${base}/identity/v1/session?include=account`, { headers })).json();
    expect(body.account).toMatchObject({ actions: ACCOUNT_ACTIONS, providers: [{ alias: "google" }], credentials: [{ id: "password-1", type: "password", label: "" }, { id: "otp-1", type: "otp", label: "" }] });
    expect(body.sessions).toContainEqual(expect.objectContaining({ current: true, surface: "configurator" }));
    expect(JSON.stringify(body)).not.toContain(sessionId);
    expect(body.account.credentials[0]).not.toHaveProperty("secretData");
  });
  it("allowlists actions and accepts second factors only", async () => {
    const { sessionId } = await session();
    const authorize = (query: string, authenticated = true) => fetch(`${base}/identity/v1/authorize?${query}`, { redirect: "manual", headers: authenticated ? { Cookie: cookie(sessionId) } : {} });
    expect((await authorize("action=UPDATE_PASSWORD", false)).status).toBe(401);
    expect((await authorize("action=UPDATE_PASSWORD&intent=signin")).status).toBe(400);
    expect((await authorize("action=UPDATE_PROFILE")).status).toBe(400);
    expect((await authorize("action=delete_credential&credentialId=password-1")).status).toBe(409);
    expect((await authorize("action=idp_link&provider=google")).status).toBe(409);
    for (const [query, action] of [["action=delete_credential&credentialId=otp-1", "delete_credential:otp-1"], ["action=idp_link&provider=github", "idp_link:github"], ["action=CONFIGURE_TOTP", "CONFIGURE_TOTP"]]) {
      const response = await authorize(query); expect(response.status).toBe(302);
      expect(new URL(response.headers.get("location")!).searchParams.get("kc_action")).toBe(action);
    }
  });
  it.each(["success", "cancelled", "error"])("updates the same session for action result %s", async status => {
    const { sessionId } = await session();
    const count = (await listPersonSessions("identity-user-1")).length;
    const response = await fetch(`${base}/identity/v1/authorize?action=UPDATE_PASSWORD&returnTo=/account`, { redirect: "manual", headers: { Cookie: cookie(sessionId) } });
    const url = new URL(response.headers.get("location")!);
    const loginCookie = response.headers.getSetCookie()[0].split(";")[0];
    const callback = await fetch(`${base}/identity/v1/callback?state=${url.searchParams.get("state")}&code=valid-code:${url.searchParams.get("nonce")}&kc_action_status=${status}`, { redirect: "manual", headers: { Cookie: `${cookie(sessionId)}; ${loginCookie}` } });
    expect(callback.status).toBe(303);
    expect((await result(callback)).code).toBe(status === "success" ? "ACTION_COMPLETE" : status === "cancelled" ? "ACTION_CANCELLED" : "ACTION_FAILED");
    expect(await getIdentitySession(sessionId)).not.toBeNull();
    expect((await listPersonSessions("identity-user-1")).length).toBe(count);
  });
  it("refuses an action callback that changes person", async () => {
    const { sessionId } = await session("other-person");
    await admin("/users", { id: "other-person", username: "other-person", enabled: true, credentials: [{ id: "p", type: "password" }] }, "POST");
    const retry = await fetch(`${base}/identity/v1/authorize?action=UPDATE_PASSWORD`, { redirect: "manual", headers: { Cookie: cookie(sessionId) } });
    expect(retry.status).toBe(302);
    const url = new URL(retry.headers.get("location")!);
    const callback = await fetch(`${base}/identity/v1/callback?state=${url.searchParams.get("state")}&code=valid-code:${url.searchParams.get("nonce")}&kc_action_status=success`, { redirect: "manual", headers: { Cookie: `${cookie(sessionId)}; ${retry.headers.getSetCookie()[0].split(";")[0]}` } });
    expect((await result(callback)).code).toBe("ACTION_FAILED");
    expect((await getIdentitySession(sessionId))?.claims.sub).toBe("other-person");
  });
  it("never restores an action session ended before its callback", async () => {
    const { sessionId } = await session();
    const response = await fetch(`${base}/identity/v1/authorize?action=CONFIGURE_TOTP`, { redirect: "manual", headers: { Cookie: cookie(sessionId) } });
    const url = new URL(response.headers.get("location")!);
    await deleteIdentitySession(sessionId);
    const callback = await fetch(`${base}/identity/v1/callback?state=${url.searchParams.get("state")}&code=valid-code:${url.searchParams.get("nonce")}&kc_action_status=success`, { redirect: "manual", headers: { Cookie: `${cookie(sessionId)}; ${response.headers.getSetCookie()[0].split(";")[0]}` } });
    expect((await result(callback)).code).toBe("ACTION_FAILED");
    expect(await getIdentitySession(sessionId)).toBeNull();
  });
  it("returns empty account arrays for a phone-only citizen", async () => {
    const { sessionId } = await createPhoneOtpSession({ subject: "phone-person", name: "712345678", phoneNumber: "+254712345678", boundTenant: { urlSlug: "county", tenantId: "ke", rootTenantId: "ke", name: "County" } });
    const response = await fetch(`${base}/identity/v1/session?surface=citizen&include=account`, { headers: { Cookie: `${config.identityCitizenCookieName}=${sessionId}` } });
    expect(response.status).toBe(200);
    expect((await response.json()).account).toEqual({ actions: [], credentials: [], providers: [] });
  });
  it("selects the employee cookie through the unlink query without changing its body", async () => {
    await admin("/users", { id: "employee-unlink", username: "employee-unlink", enabled: true, credentials: [{ id: "password", type: "password" }], federatedIdentities: [{ identityProvider: "google", userId: "g" }] }, "POST");
    const { sessionId } = await createIdentitySession(tokens, { sub: "employee-unlink", email: "employee@example.test" }, config.keycloakEmployeeClientId,
      { surface: "employee", boundTenant: { urlSlug: "county", tenantId: "ke", rootTenantId: "ke", name: "County" } });
    const options = { method: "POST", headers: { Cookie: `${config.identityEmployeeCookieName}=${sessionId}`, "Content-Type": "application/json" }, body: JSON.stringify({ alias: "google" }) };
    expect((await fetch(`${base}/identity/v1/account/providers/_unlink`, options)).status).toBe(401);
    const response = await fetch(`${base}/identity/v1/account/providers/_unlink?surface=employee`, options);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: [] });
  });
  it("does not count citizen phone proof as a staff sign-in method", async () => {
    await admin("/users", { id: "staff-phone-only", username: "staff-phone-only", enabled: true, attributes: { phoneNumber: ["+254711222333"], phoneNumberVerified: ["true"] }, federatedIdentities: [{ identityProvider: "google", userId: "g" }] }, "POST");
    const { sessionId } = await session("staff-phone-only");
    const response = await fetch(`${base}/identity/v1/account/providers/_unlink`, { method: "POST", headers: { Cookie: cookie(sessionId), "Content-Type": "application/json" }, body: JSON.stringify({ alias: "google" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("LAST_SIGNIN_METHOD");
  });
  it("serializes concurrent unlinks and does not count TOTP as a primary method", async () => {
    await admin("/users", { id: "unlink-person", username: "unlink-person", enabled: true, credentials: [{ id: "otp", type: "otp" }], federatedIdentities: [{ identityProvider: "google", userId: "g" }, { identityProvider: "github", userId: "h" }] }, "POST");
    const { sessionId } = await session("unlink-person");
    const unlink = (alias: string) => fetch(`${base}/identity/v1/account/providers/_unlink`, { method: "POST", headers: { Cookie: cookie(sessionId), "Content-Type": "application/json" }, body: JSON.stringify({ alias }) });
    const responses = await Promise.all([unlink("google"), unlink("github")]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(await responses.find(response => response.status === 409)!.json()).toMatchObject({ code: "LAST_SIGNIN_METHOD" });
  });
});

describe("Keycloak session id from a signed token", () => {
  // The mock token endpoint signs a real RS256 access token (test key, served by the JWKS mock)
  // with `sid` = `kc-sid-<nonce>`, so this runs the server's own verifier and session save.
  async function signIn() {
    const authorize = await fetch(`${base}/identity/v1/authorize?method=password&returnTo=/account`, { redirect: "manual" });
    const nonce = new URL(authorize.headers.get("location")!).searchParams.get("nonce")!;
    const state = new URL(authorize.headers.get("location")!).searchParams.get("state")!;
    const callback = await fetch(`${base}/identity/v1/callback?state=${state}&code=valid-code:${nonce}`,
      { redirect: "manual", headers: { Cookie: authorize.headers.getSetCookie()[0].split(";")[0] } });
    expect(callback.status).toBe(303);
    const sessionCookie = callback.headers.getSetCookie().find(value => value.startsWith(`${config.identityCookieName}=`))!;
    return { sessionId: sessionCookie.split(";")[0].split("=")[1], kcSessionId: `kc-sid-${nonce}` };
  }
  it("a callback stores the token's sid as kcSessionId and writes the kc-session index", async () => {
    const before = Math.floor(Date.now() / 1000) * 1000;
    const { sessionId, kcSessionId } = await signIn();
    expect(await getIdentitySession(sessionId)).toMatchObject({ kcSessionId, oidcClientId: config.keycloakBffClientId });
    // auth_time (s) is stored as authTime (ms) and kept by a refresh that lacks it (GET /session refreshes here).
    const { authTime } = (await getIdentitySession(sessionId))!;
    expect(authTime).toBeGreaterThanOrEqual(before); expect(authTime! % 1000).toBe(0);
    expect((await fetch(`${base}/identity/v1/session`, { headers: { Cookie: cookie(sessionId) } })).status).toBe(200);
    expect(await getIdentitySession(sessionId)).toMatchObject({ authTime });
    expect(await getRedis().get(kcSessionSubjectKey(kcSessionId))).toBe("identity-user-1");
  });
  it("B3: a self UPDATE_PASSWORD keeps the initiating session and ends the others", async () => {
    const initiator = await signIn(); const other = await signIn();
    // Both sessions authenticated before the change, so only B3 can keep the initiator.
    const changedAt = Date.now() + 2000;
    const details = { credential_type: "password", code_id: initiator.kcSessionId };
    const shape = { userId: "identity-user-1", clientId: config.keycloakBffClientId, details };
    // Keycloak 26.7.3 emits the UPDATE_PASSWORD twin 1 ms before UPDATE_CREDENTIAL.
    await applyKeycloakEvent("user", { ...shape, id: "twin", time: changedAt - 1, type: "UPDATE_PASSWORD" });
    await applyKeycloakEvent("user", { ...shape, id: "change", time: changedAt, type: "UPDATE_CREDENTIAL" });
    await drainRevocationJobs();
    expect(await getIdentitySession(initiator.sessionId)).not.toBeNull();
    expect(await getIdentitySession(other.sessionId)).toBeNull();
    const kept = await fetch(`${base}/identity/v1/session`, { headers: { Cookie: cookie(initiator.sessionId) } });
    expect(kept.status).toBe(200);
  });
});

describe("scoped logout", () => {
  it.each(["current", "others", "all"])("ends only the %s sessions across surfaces", async scope => {
    const subject = `logout-${scope}`;
    const first = await session(subject);
    const second = await createIdentitySession(tokens, { sub: subject, email: "" }, config.keycloakEmployeeClientId, { surface: "employee", boundTenant: { tenantId: "ke", rootTenantId: "ke", urlSlug: "county", name: "County" } });
    const third = await createPhoneOtpSession({ subject, name: "Citizen", phoneNumber: "+254711222333", boundTenant: { tenantId: "ke", rootTenantId: "ke", urlSlug: "county", name: "County" } });
    const response = await fetch(`${base}/identity/v1/logout`, { method: "POST", headers: { Cookie: cookie(first.sessionId), "Content-Type": "application/json" }, body: JSON.stringify({ scope }) });
    expect(response.status).toBe(204);
    expect(response.headers.has("set-cookie")).toBe(scope !== "others");
    expect(Boolean(await getIdentitySession(first.sessionId))).toBe(scope === "others");
    for (const other of [second, third]) expect(Boolean(await getIdentitySession(other.sessionId))).toBe(scope === "current");
  });
  it("rejects invalid scopes without ending the session", async () => {
    const { sessionId } = await session("invalid-logout");
    const response = await fetch(`${base}/identity/v1/logout?scope=everyone`, { method: "POST", headers: { Cookie: cookie(sessionId) } });
    expect(response.status).toBe(400);
    expect(await getIdentitySession(sessionId)).not.toBeNull();
  });
});

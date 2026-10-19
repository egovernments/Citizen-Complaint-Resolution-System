import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { currentPersonLease, personLeaseKey, withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { createIdentitySession, getIdentitySession, requireCurrentSession, saveSelectedIdentityContext } from "../../src/modules/sessions/session-store.js";
import { privateRef } from "../../src/modules/citizen-otp/otp-store.js";
import { cachedToken, drainKeycloakLogoutRetries, drainRevocationJobs, enqueueRevocation, runPendingRevocations, drainTokenRetries, endKeycloakSessions, endPhoneSessions, holdToken, logoutSessions, recordToken, revokeAccount, revokePerson, revokeTenantMembers } from "../../src/modules/revocation/index.js";
import { key, personTokensKey, readToken, tokenKey, tokenHoldersKey } from "../../src/modules/revocation/inventory.js";
import * as keycloak from "../../src/modules/revocation/keycloak.js";
import * as credentials from "../../src/modules/accounts/credential-service.js";
import * as bindings from "../../src/modules/bindings/store.js";
import * as organizations from "../../src/modules/onboarding/organization-reader.js";
import * as digit from "../../src/modules/managed-accounts/digit-user-client.js";
import { applyKeycloakEvent } from "../../src/modules/revocation/event-effects.js";

const prefix = `revocation-test-${process.pid}`;
const account = { tenantId: "tenant-a", uuid: "uuid-a" };
const second = { tenantId: "tenant-b", uuid: "uuid-b" };
let subject = "";
let sequence = 0;
const login = (ref = account, name = "digit-token") => ({ accessToken: name, expiresAt: Date.now() + 3600_000,
  user: { ...ref, active: true, userName: "staff", type: "EMPLOYEE" } });
const session = async (sid = "kc-one", phone?: string) => (await createIdentitySession(
  { accessToken: "keycloak-token", accessExpiresIn: 600, refreshExpiresIn: 3600 },
  { sub: subject, email: "test@example.invalid", ...{ sid }, ...(phone && { phone_number: phone }) }, "client-a")).sessionId;
const inventory = async (ref = account, token = login(ref), sid?: string) => withPersonLease(subject, async lease => {
  await recordToken(lease, ref, token, "staff");
  if (sid) await holdToken(lease, ref, sid);
});
beforeAll(() => {
  Object.assign(config, { cachePrefix: prefix, digitUserServiceUrl: "http://digit.invalid/user" });
  initCache(`redis://localhost:${process.env.REDIS_PORT || "16387"}`);
});
async function clear() {
  const keys = await getRedis().keys(`${prefix}:*`);
  if (keys.length) await getRedis().del(...keys);
}
beforeEach(async () => {
  vi.restoreAllMocks(); await clear(); subject = `subject-${++sequence}`;
  vi.spyOn(digit, "revokeToken").mockResolvedValue();
  vi.spyOn(keycloak, "getRevocationUser").mockImplementation(async sub => ({ id: sub }));
  vi.spyOn(credentials, "findLiveStaffToken").mockResolvedValue(null);
  vi.spyOn(keycloak, "endKeycloakSession").mockResolvedValue();
});
afterAll(async () => { vi.restoreAllMocks(); await clear(); await closeCache(); });

describe("token inventory and revocation", () => {
  it("keeps inventory, person index and holders to actual expiry, not the read skew", async () => {
    const sid = await session(); await inventory(account, login(), sid);
    for (const entry of [tokenKey(account), personTokensKey(subject), tokenHoldersKey(account)])
      expect(await getRedis().pttl(entry)).toBeGreaterThan(3590_000);
    expect(await getRedis().smembers(tokenHoldersKey(account))).toEqual([privateRef("session", sid)]);
  });
  it("discards an externally revoked cached token", async () => {
    await inventory();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await withPersonLease(subject, lease => cachedToken(lease, account))).toBeNull();
    expect(await readToken(account)).toBeNull();
  });
  it("returns safe live profile fields; validation dependency failure fails closed", async () => {
    await inventory();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ...login().user, password: "must-not-return" })));
    expect((await withPersonLease(subject, lease => cachedToken(lease, account)))?.user).not.toHaveProperty("password");
    fetcher.mockResolvedValue(new Response("", { status: 503 }));
    await expect(withPersonLease(subject, lease => cachedToken(lease, account))).rejects.toMatchObject({ status: 503 });
    expect(await readToken(account)).not.toBeNull();
  });
  it("cleans up a mint when its lease is lost before recording", async () => {
    await withPersonLease(subject, async lease => {
      await getRedis().set(personLeaseKey(subject), "replacement", "PX", 1000);
      await expect(recordToken(lease, account, login(), "staff")).rejects.toMatchObject({ code: "IDENTITY_BUSY" });
    });
    expect(digit.revokeToken).toHaveBeenCalledWith("digit-token");
    expect(await readToken(account)).toBeNull();
  });
  it.each(["KEYCLOAK_DISABLED", "KEYCLOAK_DELETED", "LOGOUT_ALL", "CREDENTIAL_CHANGED"] as const)("%s ends sessions/tokens; new login can resume", async reason => {
    const sid = await session(); await inventory(account, login(), sid);
    await revokePerson(subject, reason);
    expect(await getIdentitySession(sid)).toBeNull(); expect(await readToken(account)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledWith("digit-token");
    expect(await getIdentitySession(await session("new-login"))).toMatchObject({ revocationGeneration: 1 });
  });
  it("binding removal ends all BFF sessions but only the removed account token", async () => {
    const sid = await session(); const other = await session("other");
    await inventory(account, login(), sid); await inventory(second, login(second, "other-token"), other);
    await revokeAccount(subject, account, "BINDING_REMOVED");
    expect(await getIdentitySession(sid)).toBeNull(); expect(await getIdentitySession(other)).toBeNull();
    expect(await readToken(second)).not.toBeNull(); expect(digit.revokeToken).toHaveBeenCalledTimes(1);
  });
  it.each(["MEMBERSHIP_REMOVED", "ROLE_CHANGED", "DIGIT_INACTIVE", "DIGIT_ACCOUNT_MISSING"] as const)("%s targets the affected tenant", async reason => {
    const sid = await session(); const other = await session("other");
    for (const [sessionId, ref] of [[sid, account], [other, second]] as const)
      await saveSelectedIdentityContext(sessionId, { organizationId: "o", organizationAlias: "a", tenantId: ref.tenantId, name: "Tenant" });
    await inventory(); await inventory(second, login(second, "other-token"));
    await revokeAccount(subject, account, reason);
    expect(await getIdentitySession(sid)).toBeNull(); expect(await getIdentitySession(other)).not.toBeNull();
    expect(await readToken(second)).not.toBeNull();
  });
  it("persists failed logout in retry set and drains after recovery", async () => {
    await inventory(); vi.mocked(digit.revokeToken).mockRejectedValue(new Error("unavailable"));
    await revokePerson(subject, "LOGOUT_ALL");
    expect(await getRedis().zcard(key("revoke-retry"))).toBe(1); expect(await readToken(account)).toBeNull();
    vi.mocked(digit.revokeToken).mockResolvedValue(); await drainTokenRetries();
    expect(await getRedis().zcard(key("revoke-retry"))).toBe(0);
  });
  it("recovers grant-eligible staff after a crash between mint and record; loss limits hold", async () => {
    vi.mocked(keycloak.getRevocationUser).mockResolvedValue({ id: subject, attributes: { "digit.accounts": [JSON.stringify({ v: 1, entries: [
      { ...account, kind: "staff", boundAt: 1, active: true, roles: [], userName: "staff", credential: { keyVersion: 1 } },
      { ...second, kind: "citizen", boundAt: 1, active: true, roles: [], userName: "citizen" },
      { tenantId: "locked", uuid: "locked", kind: "staff", boundAt: 1, active: true, roles: [], userName: "locked", credential: { keyVersion: 1 } },
    ] })] } });
    vi.mocked(credentials.findLiveStaffToken).mockImplementation(async ref => ref.uuid === account.uuid ? login() : null);
    await revokePerson(subject, "KEYCLOAK_DISABLED");
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("digit-token");
    expect(credentials.findLiveStaffToken).toHaveBeenCalledWith({ ...account, userName: "staff", keyVersion: 1 });
    expect(credentials.findLiveStaffToken).toHaveBeenCalledTimes(2);
    vi.mocked(credentials.findLiveStaffToken).mockClear(); await revokePerson(subject, "KEYCLOAK_DELETED");
    expect(credentials.findLiveStaffToken).not.toHaveBeenCalled();
  });
  it("retains subject jobs on dependency failure and resumes them", async () => {
    await inventory(); vi.mocked(keycloak.getRevocationUser).mockRejectedValue(new Error("Keycloak unavailable"));
    await expect(revokePerson(subject, "LOGOUT_ALL")).rejects.toThrow("unavailable");
    expect(await getRedis().zcard(key("revoke-jobs"))).toBe(1);
    vi.mocked(keycloak.getRevocationUser).mockResolvedValue({ id: subject }); await drainRevocationJobs();
    expect(await getRedis().zcard(key("revoke-jobs"))).toBe(0);
    expect(digit.revokeToken).toHaveBeenCalledWith("digit-token");
  });
  it.each(["person", "account"] as const)("%s fallback false cleans up new inventory and sessions without grants on steady passes", async scope => {
    vi.mocked(keycloak.getRevocationUser).mockResolvedValue({ id: subject, attributes: { "digit.accounts": [JSON.stringify({ v: 1, entries: [
      { ...account, kind: "staff", boundAt: 1, active: true, roles: [], userName: "staff", credential: { keyVersion: 1 } },
    ] })] } });
    const revoke = (fallback?: boolean) => scope === "person"
      ? revokePerson(subject, "KEYCLOAK_DISABLED", { fallback })
      : revokeAccount(subject, account, "DIGIT_INACTIVE", { fallback });
    for (const name of ["first-token", "new-token"]) {
      const sid = await session();
      await saveSelectedIdentityContext(sid, { organizationId: "o", organizationAlias: "a", tenantId: account.tenantId, name: "Tenant" });
      await inventory(account, login(account, name), sid);
      await revoke(false);
      expect(await getIdentitySession(sid)).toBeNull(); expect(await readToken(account)).toBeNull();
      expect(digit.revokeToken).toHaveBeenCalledWith(name);
      const calls = vi.mocked(digit.revokeToken).mock.calls.length;
      await revoke(false);
      expect(digit.revokeToken).toHaveBeenCalledTimes(calls);
      expect(credentials.findLiveStaffToken).not.toHaveBeenCalled();
    }
    await revoke(); // Default remains the full fallback path.
    expect(credentials.findLiveStaffToken).toHaveBeenCalledExactlyOnceWith({ ...account, userName: "staff", keyVersion: 1 });
  });
  it.each(["person", "account"] as const)("%s fallback false survives a durable job retry", async scope => {
    await inventory();
    vi.mocked(keycloak.getRevocationUser).mockRejectedValueOnce(new Error("Keycloak unavailable"));
    const attempt = scope === "person"
      ? revokePerson(subject, "KEYCLOAK_DISABLED", { fallback: false })
      : revokeAccount(subject, account, "DIGIT_INACTIVE", { fallback: false });
    await expect(attempt).rejects.toThrow("unavailable");
    const jobs = await getRedis().zrange(key("revoke-jobs"), 0, -1);
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(Buffer.from(jobs[0].split("|")[2], "base64url").toString())).toMatchObject({ fallback: false });
    vi.mocked(keycloak.getRevocationUser).mockResolvedValue({ id: subject, attributes: { "digit.accounts": [JSON.stringify({ v: 1, entries: [
      { ...account, kind: "staff", boundAt: 1, active: true, roles: [], userName: "staff", credential: { keyVersion: 1 } },
    ] })] } });
    await drainRevocationJobs();
    expect(await getRedis().zcard(key("revoke-jobs"))).toBe(0);
    expect(credentials.findLiveStaffToken).not.toHaveBeenCalled();
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("digit-token");
  });
  it("keeps only initiating session generation after self password change", async () => {
    const keep = await session(); const other = await session("other");
    await inventory(account, login(), keep); await withPersonLease(subject, lease => holdToken(lease, account, other));
    await revokePerson(subject, "CREDENTIAL_CHANGED", { keepSessionId: keep });
    expect(await getIdentitySession(keep)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(other)).toBeNull();
    // The ended session also held the token, so it goes even though the initiator holds it.
    expect(await readToken(account)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("digit-token");
  });
  it("self password change keeps a token only the initiating session holds", async () => {
    const keep = await session(); const other = await session("other");
    await inventory(account, login(), keep); await inventory(second, login(second, "other-token"), other);
    await revokePerson(subject, "CREDENTIAL_CHANGED", { keepSessionId: keep });
    expect(await readToken(account)).not.toBeNull(); expect(await readToken(second)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("other-token");
  });
  it("logout current preserves a shared token; logout all revokes last holder", async () => {
    const first = await session(); const other = await session("other");
    await inventory(account, login(), first); await withPersonLease(subject, lease => holdToken(lease, account, other));
    await logoutSessions(subject, "current", first);
    expect(await getIdentitySession(first)).toBeNull(); expect(await getIdentitySession(other)).not.toBeNull();
    expect(digit.revokeToken).not.toHaveBeenCalled();
    await logoutSessions(subject, "all", other);
    expect(digit.revokeToken).toHaveBeenCalledWith("digit-token");
    expect(keycloak.endKeycloakSession).toHaveBeenCalledTimes(2);
  });
  it.each([false, true])("logout others keeps the current shared token usable (duplicate inventory: %s)", async duplicate => {
    const current = await session("current-device"), other = await session("other-device");
    const alias = { tenantId: "legacy-tenant-alias", uuid: account.uuid };
    const tokens = new Set(["shared-account-token", "unshared-account-token"]);
    vi.mocked(digit.revokeToken).mockImplementation(async token => { tokens.delete(token); });
    vi.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const token = new URL(String(input)).searchParams.get("access_token");
      return tokens.has(token || "") ? new Response(JSON.stringify(login().user)) : new Response("{}", { status: 401 });
    });
    await inventory(account, login(account, "shared-account-token"), current);
    await withPersonLease(subject, lease => holdToken(lease, account, other));
    // The same egov-user account/token can be inventoried through an older tenant alias.
    // Even an alias held only by the other device must not revoke the current token.
    if (duplicate) await inventory(alias, login(alias, "shared-account-token"), other);
    await inventory(second, login(second, "unshared-account-token"), other);
    await logoutSessions(subject, "others", current);
    expect(await getIdentitySession(current)).not.toBeNull();
    expect(await getIdentitySession(other)).toBeNull();
    expect(keycloak.endKeycloakSession).toHaveBeenCalledExactlyOnceWith("other-device");
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("unshared-account-token");
    expect((await withPersonLease(subject, lease => cachedToken(lease, account)))?.accessToken).toBe("shared-account-token");
    expect(await readToken(second)).toBeNull();
    if (duplicate) expect(await readToken(alias)).toBeNull();
    expect(await getRedis().smembers(tokenHoldersKey(account))).toEqual([privateRef("session", current)]);
    // Retried logout must not schedule revocation of the protected token either.
    await logoutSessions(subject, "others", current);
    await endKeycloakSessions("other-device", undefined, subject);
    expect(await getRedis().zcard(key("revoke-retry"))).toBe(0);
    await drainTokenRetries();
    expect(tokens.has("shared-account-token")).toBe(true);
    await logoutSessions(subject, "all", current);
    expect(tokens.has("shared-account-token")).toBe(false);
    expect(await getIdentitySession(current)).toBeNull();
  });
  it("logout deletes the BFF session during a Keycloak outage and ends Keycloak's session later", async () => {
    const sid = await session("kc-outage");
    vi.mocked(keycloak.endKeycloakSession).mockRejectedValue(new Error("Keycloak Admin API returned 503"));
    await expect(logoutSessions(subject, "current", sid)).resolves.toBeUndefined();
    expect(await getIdentitySession(sid)).toBeNull();
    expect(await getRedis().zrange(key("kc-logout-retry"), 0, -1)).toEqual(["kc-outage"]);
    vi.mocked(keycloak.endKeycloakSession).mockClear().mockResolvedValue();
    await getRedis().zadd(key("kc-logout-retry"), 0, "kc-outage");
    await drainKeycloakLogoutRetries();
    expect(keycloak.endKeycloakSession).toHaveBeenCalledExactlyOnceWith("kc-outage");
    expect(await getRedis().zcard(key("kc-logout-retry"))).toBe(0);
    expect(await getRedis().exists(key("kc-logout-retry:kc-outage"))).toBe(0);
  });
  it("logout does not wait on a hung Keycloak", async () => {
    const sid = await session("kc-hung");
    vi.mocked(keycloak.endKeycloakSession).mockImplementation(() => new Promise(() => {}));
    const started = Date.now();
    await logoutSessions(subject, "current", sid);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await getIdentitySession(sid)).toBeNull();
    expect(await getRedis().zrange(key("kc-logout-retry"), 0, -1)).toEqual(["kc-hung"]);
  });
  it("phone change ends old-number sessions except the keeper", async () => {
    const keep = await session("keep", "+254700000001"); const old = await session("old", "+254700000001");
    const fresh = await session("fresh", "+254700000002");
    await endPhoneSessions(subject, privateRef("phone", "+254700000001"), keep);
    expect(await getIdentitySession(old)).toBeNull(); expect(await getIdentitySession(keep)).not.toBeNull();
    expect(await getIdentitySession(fresh)).not.toBeNull();
  });
  it("tenant fanout queues union before sequential person work and is repeatable", async () => {
    vi.spyOn(organizations, "readOrganizationByTenant").mockResolvedValue({ id: "org", alias: "org", name: "Org", lifecycle: "FAILED", enabled: false });
    vi.spyOn(keycloak, "listOrganizationMembers").mockResolvedValue([{ id: "member" }]);
    vi.spyOn(bindings, "bindingsFor").mockResolvedValue([{ subject: "bound", binding: account }]);
    const observed: string[] = [];
    vi.mocked(keycloak.getRevocationUser).mockImplementation(async sub => {
      expect(currentPersonLease()?.subject).toBe(sub);
      if (!observed.length) expect(await getRedis().zcard(key("revoke-jobs"))).toBe(2);
      observed.push(sub); return { id: sub };
    });
    await revokeTenantMembers(account.tenantId, "ORGANIZATION_DISABLED");
    expect(new Set(observed)).toEqual(new Set(["member", "bound"])); expect(await getRedis().zcard(key("revoke-jobs"))).toBe(0);
    await revokeTenantMembers(account.tenantId, "ORGANIZATION_DISABLED"); expect(observed).toHaveLength(4);
  });
  it("runPendingRevocations runs only the lease holder's queued jobs, including ones waiting to retry (#2286)", async () => {
    const sid = await session(); await inventory(account, login(), sid);
    const mine = await enqueueRevocation(subject, "CREDENTIAL_CHANGED");
    await getRedis().zadd(key("revoke-jobs"), Date.now() + 5_000, mine); // a failed run waiting for the worker
    const others = await enqueueRevocation("someone-else", "LOGOUT_ALL");
    await withPersonLease(subject, lease => runPendingRevocations(lease));
    expect(await getIdentitySession(sid)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("digit-token");
    expect(await getRedis().zrange(key("revoke-jobs"), 0, -1)).toEqual([others]);
  });
  it("_select rejects its session after revocation wins the lease", async () => {
    const sid = await session(); await revokePerson(subject, "LOGOUT_ALL");
    await expect(withPersonLease(subject, lease => requireCurrentSession(lease, sid))).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  });
});

describe("revocation log (#2285)", () => {
  const sync = { propagateVerifiedIdentifiers: vi.fn(async () => {}), requestReconcileNow: vi.fn(async () => {}) };
  const time = Date.UTC(2026, 9, 5, 10, 0, 0);
  const lines = (spy: { mock: { calls: unknown[][] } }, event: string) => spy.mock.calls
    .filter(call => typeof call[0] === "string" && call[0].includes(`"${event}"`)).map(call => JSON.parse(call[0] as string));
  const tokenRef = expect.stringMatching(/^[0-9a-f]{12}$/);
  function expectNoSecrets(spy: { mock: { calls: unknown[][] } }, secrets: string[]) {
    const written = spy.mock.calls.map(call => call.join(" ")).join("\n");
    for (const secret of secrets) expect(written).not.toContain(secret);
  }

  it("credential change: logs the kept B3 initiator and the shared token it revoked", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const keep = await session("kc-keep"); const other = await session("kc-other");
    await inventory(account, login(account, "shared-digit-token"), keep);
    await withPersonLease(subject, lease => holdToken(lease, account, other));
    await inventory(second, login(second, "initiator-only-token"), keep);
    await applyKeycloakEvent("user", { id: "evt-cred", time, type: "UPDATE_CREDENTIAL", userId: subject, clientId: "client-a",
      details: { credential_type: "password", code_id: "kc-keep" } }, sync);
    await drainRevocationJobs();
    const [line] = lines(info, "identity.revocation.job");
    expect(line).toEqual({
      event: "identity.revocation.job", outcome: "ok", reason: "CREDENTIAL_CHANGED", subject,
      trigger: { eventId: `${time}:evt-cred`, eventType: "UPDATE_CREDENTIAL", eventTime: "2026-10-05T10:00:00.000Z" },
      sessionsEnded: 1, sessionsKept: 1, tokensRevoked: 1, tokensKept: 1,
      sessions: { ended: [privateRef("session", other)], kept: [{ ref: privateRef("session", keep), reason: "B3_INITIATOR" }] },
      tokens: expect.arrayContaining([
        { account: "tenant-a:uuid-a", tokenRef, outcome: "revoked", why: "SHARED_WITH_ENDED_SESSION" },
        { account: "tenant-b:uuid-b", tokenRef, outcome: "kept", why: "KEPT_SESSIONS_ONLY_HOLDERS" },
      ]),
      durationMs: expect.any(Number),
    });
    expect(lines(info, "identity.revocation.job")).toHaveLength(1);
    expectNoSecrets(info, ["shared-digit-token", "initiator-only-token", "keycloak-token", keep, other]);
  });
  it("account disabled: logs every session ended and every token revoked in scope", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const sid = await session(); await inventory(account, login(), sid);
    await applyKeycloakEvent("admin", { id: "evt-disable", time, operationType: "UPDATE", resourceType: "USER",
      resourcePath: `users/${subject}`, representation: JSON.stringify({ enabled: false }) }, sync);
    await drainRevocationJobs();
    expect(lines(info, "identity.revocation.job")).toEqual([expect.objectContaining({
      outcome: "ok", reason: "KEYCLOAK_DISABLED", subject,
      trigger: { eventId: `${time}:evt-disable`, eventType: "UPDATE USER", eventTime: "2026-10-05T10:00:00.000Z" },
      sessionsEnded: 1, sessionsKept: 0, tokensRevoked: 1, tokensKept: 0,
      sessions: { ended: [privateRef("session", sid)], kept: [] },
      tokens: [{ account: "tenant-a:uuid-a", tokenRef, outcome: "revoked", why: "IN_SCOPE" }],
    })]);
    expectNoSecrets(info, ["digit-token", sid]);
  });
  it("membership removed: logs sessions at other tenants as kept, with the tenant", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const sid = await session(); const other = await session("other");
    for (const [sessionId, ref] of [[sid, account], [other, second]] as const)
      await saveSelectedIdentityContext(sessionId, { organizationId: "o", organizationAlias: "a", tenantId: ref.tenantId, name: "Tenant" });
    await revokeAccount(subject, account, "MEMBERSHIP_REMOVED");
    expect(lines(info, "identity.revocation.job")[0]).toMatchObject({ reason: "MEMBERSHIP_REMOVED", tenantId: "tenant-a", account: "tenant-a:uuid-a",
      sessions: { ended: [privateRef("session", sid)], kept: [{ ref: privateRef("session", other), reason: "OTHER_TENANT" }] } });
  });
  it("a failed job logs one retry line with what it did so far", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sid = await session(); await inventory(account, login(), sid);
    vi.mocked(keycloak.getRevocationUser).mockRejectedValue(new Error("Keycloak unavailable"));
    await expect(revokePerson(subject, "LOGOUT_ALL")).rejects.toThrow("unavailable");
    expect(lines(warn, "identity.revocation.job")).toEqual([expect.objectContaining({
      outcome: "retry", reason: "LOGOUT_ALL", error: "Keycloak unavailable", sessionsEnded: 1, tokensRevoked: 1 })]);
    expectNoSecrets(warn, ["digit-token", sid]);
  });
  it("logout: logs the initiator kept and a shared token still held", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const first = await session(); const other = await session("other");
    await inventory(account, login(), first); await withPersonLease(subject, lease => holdToken(lease, account, other));
    await logoutSessions(subject, "current", first);
    expect(lines(info, "identity.revocation.logout")).toEqual([expect.objectContaining({
      outcome: "ok", reason: "LOGOUT", scope: "current", subject, trigger: {},
      sessions: { ended: [privateRef("session", first)], kept: [{ ref: privateRef("session", other), reason: "NOT_TARGETED" }] },
      tokens: [{ account: "tenant-a:uuid-a", tokenRef, outcome: "kept", why: "STILL_HELD" }],
    })]);
    await logoutSessions(subject, "all", other);
    expect(lines(info, "identity.revocation.logout")[1]).toMatchObject({ scope: "all", sessionsEnded: 1, sessionsKept: 0,
      tokens: [{ outcome: "revoked", why: "NO_LIVE_HOLDER" }] });
    expectNoSecrets(info, ["digit-token", first, other]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { currentPersonLease, personLeaseKey, withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { createIdentitySession, getIdentitySession, requireCurrentSession, saveSelectedIdentityContext } from "../../src/modules/sessions/session-store.js";
import { privateRef } from "../../src/modules/citizen-otp/otp-store.js";
import { cachedToken, drainRevocationJobs, drainTokenRetries, endPhoneSessions, holdToken, logoutSessions, recordToken, revokeAccount, revokePerson, revokeTenantMembers } from "../../src/modules/revocation/index.js";
import { key, personTokensKey, readToken, tokenKey, tokenHoldersKey } from "../../src/modules/revocation/inventory.js";
import { revocationPorts } from "../../src/modules/revocation/ports.js";
import * as digit from "../../src/modules/managed-accounts/digit-user-client.js";

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
  vi.spyOn(revocationPorts, "user").mockImplementation(async sub => ({ id: sub }));
  vi.spyOn(revocationPorts, "findLiveStaffToken").mockResolvedValue(null);
  vi.spyOn(revocationPorts, "endKeycloakSession").mockResolvedValue();
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
    vi.mocked(revocationPorts.user).mockResolvedValue({ id: subject, attributes: { "digit.accounts": [JSON.stringify({ v: 1, entries: [
      { ...account, kind: "staff", userName: "staff", credential: { keyVersion: 1 } },
      { ...second, kind: "citizen", userName: "citizen" },
      { tenantId: "locked", uuid: "locked", kind: "staff", userName: "locked", credential: { keyVersion: 1 } },
    ] })] } });
    vi.mocked(revocationPorts.findLiveStaffToken).mockImplementation(async ref => ref.uuid === account.uuid ? login() : null);
    await revokePerson(subject, "KEYCLOAK_DISABLED");
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("digit-token");
    expect(revocationPorts.findLiveStaffToken).toHaveBeenCalledWith({ ...account, userName: "staff", keyVersion: 1 });
    expect(revocationPorts.findLiveStaffToken).toHaveBeenCalledTimes(2);
    vi.mocked(revocationPorts.findLiveStaffToken).mockClear(); await revokePerson(subject, "KEYCLOAK_DELETED");
    expect(revocationPorts.findLiveStaffToken).not.toHaveBeenCalled();
  });
  it("retains subject jobs on dependency failure and resumes them", async () => {
    await inventory(); vi.mocked(revocationPorts.user).mockRejectedValue(new Error("Keycloak unavailable"));
    await expect(revokePerson(subject, "LOGOUT_ALL")).rejects.toThrow("unavailable");
    expect(await getRedis().zcard(key("revoke-jobs"))).toBe(1);
    vi.mocked(revocationPorts.user).mockResolvedValue({ id: subject }); await drainRevocationJobs();
    expect(await getRedis().zcard(key("revoke-jobs"))).toBe(0);
    expect(digit.revokeToken).toHaveBeenCalledWith("digit-token");
  });
  it("keeps only initiating session generation after self password change", async () => {
    const keep = await session(); const other = await session("other");
    await inventory(account, login(), keep); await withPersonLease(subject, lease => holdToken(lease, account, other));
    await revokePerson(subject, "CREDENTIAL_CHANGED", { keepSessionId: keep });
    expect(await getIdentitySession(keep)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(other)).toBeNull(); expect(await readToken(account)).not.toBeNull();
  });
  it("logout current preserves a shared token; logout all revokes last holder", async () => {
    const first = await session(); const other = await session("other");
    await inventory(account, login(), first); await withPersonLease(subject, lease => holdToken(lease, account, other));
    await logoutSessions(subject, "current", first);
    expect(await getIdentitySession(first)).toBeNull(); expect(await getIdentitySession(other)).not.toBeNull();
    expect(digit.revokeToken).not.toHaveBeenCalled();
    await logoutSessions(subject, "all", other);
    expect(digit.revokeToken).toHaveBeenCalledWith("digit-token");
    expect(revocationPorts.endKeycloakSession).toHaveBeenCalledTimes(2);
  });
  it("phone change ends old-number sessions except the keeper", async () => {
    const keep = await session("keep", "+254700000001"); const old = await session("old", "+254700000001");
    const fresh = await session("fresh", "+254700000002");
    await endPhoneSessions(subject, privateRef("phone", "+254700000001"), keep);
    expect(await getIdentitySession(old)).toBeNull(); expect(await getIdentitySession(keep)).not.toBeNull();
    expect(await getIdentitySession(fresh)).not.toBeNull();
  });
  it("tenant fanout queues union before sequential person work and is repeatable", async () => {
    vi.spyOn(revocationPorts, "readOrganizationByTenant").mockResolvedValue({ id: "org", alias: "org", name: "Org", lifecycle: "FAILED", enabled: false });
    vi.spyOn(revocationPorts, "members").mockResolvedValue([{ id: "member" }]);
    vi.spyOn(revocationPorts, "bindingsFor").mockResolvedValue([{ subject: "bound", binding: account }]);
    const observed: string[] = [];
    vi.mocked(revocationPorts.user).mockImplementation(async sub => {
      expect(currentPersonLease()?.subject).toBe(sub);
      if (!observed.length) expect(await getRedis().zcard(key("revoke-jobs"))).toBe(2);
      observed.push(sub); return { id: sub };
    });
    await revokeTenantMembers(account.tenantId, "ORGANIZATION_DISABLED");
    expect(new Set(observed)).toEqual(new Set(["member", "bound"])); expect(await getRedis().zcard(key("revoke-jobs"))).toBe(0);
    await revokeTenantMembers(account.tenantId, "ORGANIZATION_DISABLED"); expect(observed).toHaveLength(4);
  });
  it("_select rejects its session after revocation wins the lease", async () => {
    const sid = await session(); await revokePerson(subject, "LOGOUT_ALL");
    await expect(withPersonLease(subject, lease => requireCurrentSession(lease, sid))).rejects.toMatchObject({ code: "SESSION_REVOKED" });
  });
});

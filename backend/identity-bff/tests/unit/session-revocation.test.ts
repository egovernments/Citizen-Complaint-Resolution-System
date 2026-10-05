import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { personLeaseKey, withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { createIdentitySession, deleteIdentitySession, getIdentitySession, personSessionsKey, listPersonSessions, requireCurrentSession, revocationGenerationKey, saveIdentitySession, saveSelectedIdentityContext, sessionCookie, sessionKey, SessionRevokedError, touchIdentitySession } from "../../src/modules/sessions/session-store.js";
import { currentSession } from "../../src/modules/sessions/current-session.js";
import * as oidc from "../../src/modules/authentication/oidc.js";

vi.mock("../../src/modules/authentication/oidc.js", async original => ({ ...await original<typeof import("../../src/modules/authentication/oidc.js")>(), refreshIdentityTokens: vi.fn(), verifyIdentityAccessToken: vi.fn() }));
const tokens = { accessToken: "test-access", refreshToken: "test-refresh", accessExpiresIn: 600, refreshExpiresIn: 3600 };
const claims = { sub: "test-person", email: "test@example.invalid", sid: "kc-session" };
const prefix = `session-revocation-${process.pid}`;
beforeAll(() => {
  Object.assign(config, { cachePrefix: prefix });
  initCache(`redis://localhost:${process.env.REDIS_PORT || "16379"}`);
});
async function cleanup() {
  const keys = await getRedis().keys(`${prefix}:*`);
  if (keys.length) await getRedis().del(...keys);
}
beforeEach(async () => { await cleanup(); vi.clearAllMocks(); });
afterAll(async () => { await cleanup(); await closeCache(); });

describe("session revocation fencing", () => {
  it("creates version 2 with current generation, KC session id and person index", async () => {
    await getRedis().set(revocationGenerationKey(claims.sub), 4);
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    expect(await getIdentitySession(sessionId)).toMatchObject({ schemaVersion: 2, revocationGeneration: 4, kcSessionId: "kc-session" });
    expect(await getRedis().smembers(personSessionsKey(claims.sub))).toEqual([sessionId]);
    expect(await getRedis().pttl(personSessionsKey(claims.sub))).toBeGreaterThan(0);
  });
  it("concurrent currentSession fast paths return while another request holds the person lease", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    await getRedis().set(personLeaseKey(claims.sub), "slow-mint", "PX", 30_000);
    const reads = Promise.all([currentSession(sessionCookie(sessionId, 600)), currentSession(sessionCookie(sessionId, 600))]);
    let timeout: ReturnType<typeof setTimeout>;
    try {
      const result = await Promise.race([reads, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("valid reads waited for person lease")), 1000);
      })]);
      expect(result.map(value => value?.sessionId)).toEqual([sessionId, sessionId]);
    } finally { clearTimeout(timeout!); }
  });
  it("lists safe person session metadata and removes stale index entries", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    await getRedis().sadd(personSessionsKey(claims.sub), "expired-session");
    const sessions = await listPersonSessions(claims.sub);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ sessionId, surface: "configurator", kcSessionId: "kc-session" });
    expect(sessions[0]).not.toHaveProperty("accessToken");
    expect(await getRedis().smembers(personSessionsKey(claims.sub))).toEqual([sessionId]);
  });
  it("never recreates a revoked session through refresh, touch or context selection", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    const stale = (await getIdentitySession(sessionId))!;
    await deleteIdentitySession(sessionId);
    await expect(saveIdentitySession(sessionId, tokens, claims)).rejects.toBeInstanceOf(SessionRevokedError);
    expect(await touchIdentitySession(sessionId, stale)).toBe(false);
    expect(await saveSelectedIdentityContext(sessionId, { organizationId: "o", organizationAlias: "a", tenantId: "t", name: "Tenant" })).toBe(false);
    expect(await getRedis().exists(sessionKey(sessionId))).toBe(0);
    expect(await getRedis().smembers(personSessionsKey(claims.sub))).toEqual([]);
  });
  it("rejects a generation mismatch on reads and _select; a new login can resume", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    await getRedis().incr(revocationGenerationKey(claims.sub));
    expect(await getIdentitySession(sessionId)).toBeNull();
    await expect(withPersonLease(claims.sub, lease => requireCurrentSession(lease, sessionId))).rejects.toBeInstanceOf(SessionRevokedError);
    const next = await createIdentitySession(tokens, claims, "client");
    expect((await getIdentitySession(next.sessionId))?.revocationGeneration).toBe(1);
  });
  it("touch never reverts a newer write with the caller's stale copy", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    const stale = (await getIdentitySession(sessionId))!;
    // An account-action callback rotates the tokens after the caller's read.
    await saveIdentitySession(sessionId, { ...tokens, accessToken: "rotated-access", refreshToken: "rotated-refresh" }, claims);
    expect(await touchIdentitySession(sessionId, stale, fresh => ({ ...fresh, identityCheckedAt: 42 }))).toBe(true);
    expect(await getIdentitySession(sessionId)).toMatchObject({ accessToken: "rotated-access", refreshToken: "rotated-refresh", identityCheckedAt: 42 });
    expect(await touchIdentitySession(sessionId, stale)).toBe(true);
    expect(await getIdentitySession(sessionId)).toMatchObject({ refreshToken: "rotated-refresh", identityCheckedAt: 42 });
  });
  it("touch keeps TTL, and a lost lease cannot write context or refresh", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    const session = (await getIdentitySession(sessionId))!;
    const ttl = await getRedis().pttl(sessionKey(sessionId));
    await touchIdentitySession(sessionId, session);
    expect(await getRedis().pttl(sessionKey(sessionId))).toBeLessThanOrEqual(ttl);
    await withPersonLease(claims.sub, async () => {
      await getRedis().set(personLeaseKey(claims.sub), "new-holder", "PX", 100);
      await expect(saveSelectedIdentityContext(sessionId, { organizationId: "o", organizationAlias: "a", tenantId: "t", name: "Tenant" })).rejects.toMatchObject({ code: "IDENTITY_BUSY" });
      await expect(saveIdentitySession(sessionId, tokens, claims)).rejects.toMatchObject({ code: "IDENTITY_BUSY" });
    });
  });
  it.each(["KEYCLOAK_DISABLED", "LOGOUT_ALL", "CREDENTIAL_CHANGED"])("%s during refresh cannot resurrect the deleted record", async () => {
    const { sessionId } = await createIdentitySession({ ...tokens, accessExpiresIn: 1 }, claims, "client");
    vi.mocked(oidc.refreshIdentityTokens).mockImplementation(async () => {
      await getRedis().incr(revocationGenerationKey(claims.sub));
      await deleteIdentitySession(sessionId);
      return tokens;
    });
    vi.mocked(oidc.verifyIdentityAccessToken).mockResolvedValue(claims);
    expect(await currentSession(sessionCookie(sessionId, 600))).toBeNull();
    expect(await getRedis().exists(sessionKey(sessionId))).toBe(0);
  });
  it("reads legacy sessions as generation zero and refresh preserves the re-read generation", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    const legacy = (await getIdentitySession(sessionId))!;
    delete legacy.schemaVersion; delete legacy.revocationGeneration;
    await getRedis().set(sessionKey(sessionId), JSON.stringify(legacy), "EX", 600);
    expect(await getIdentitySession(sessionId)).not.toBeNull();
    await saveIdentitySession(sessionId, tokens, claims);
    expect((await getIdentitySession(sessionId))?.revocationGeneration).toBe(0);
  });
});

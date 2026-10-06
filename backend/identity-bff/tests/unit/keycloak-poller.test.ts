import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { createIdentitySession, getIdentitySession, kcSessionSubjectKey, sessionCookie, saveSelectedIdentityContext, sessionKey } from "../../src/modules/sessions/session-store.js";
import { personLeaseKey } from "../../src/modules/accounts/person-lease.js";
import { currentSession } from "../../src/modules/sessions/current-session.js";
import { checkpointKey, getPollerReadiness, pollKeycloakEvents, seenKey } from "../../src/modules/revocation/poller.js";
import { applyKeycloakEvent, type IdentifierEffects } from "../../src/modules/revocation/event-effects.js";
import type { EventSource, EventStream, KeycloakEvent } from "../../src/modules/revocation/event-source.js";
import { drainRevocationJobs, holdToken, recordToken, revokePerson } from "../../src/modules/revocation/index.js";
import { key, readToken } from "../../src/modules/revocation/inventory.js";
import { startRevocationWorkers } from "../../src/modules/revocation/workers.js";
import * as keycloak from "../../src/modules/revocation/keycloak.js";
import * as digit from "../../src/modules/managed-accounts/digit-user-client.js";
import * as oidc from "../../src/modules/authentication/oidc.js";
vi.mock("../../src/modules/authentication/oidc.js", () => ({ refreshIdentityTokens: vi.fn(), verifyIdentityAccessToken: vi.fn() }));
const prefix = `poller-test-${process.pid}`;
const subject = "poller-subject";
const account = { tenantId: "tenant", uuid: "account" };
const tokens = { accessToken: "kc-access", refreshToken: "kc-refresh", accessExpiresIn: 600, refreshExpiresIn: 3600 };
let now = 0;
let events: Record<EventStream, KeycloakEvent[]>;
let source: EventSource;
let sync: IdentifierEffects;
const effect = (stream: EventStream, event: KeycloakEvent) => applyKeycloakEvent(stream, event, sync);
async function session(sid = "kc-session", client = "client", refresh = false, authTime?: number) {
  return (await createIdentitySession({ ...tokens, accessExpiresIn: refresh ? 1 : 600 },
    { sub: subject, email: "test@example.invalid", ...{ sid }, ...(authTime !== undefined && { auth_time: authTime }) }, client)).sessionId;
}
const event = (id: string, extra: Partial<KeycloakEvent> = {}): KeycloakEvent => ({ id, time: now - 100, userId: subject, ...extra });
const adminEvent = (kind: "disable" | "logout" | "credential") => event(kind, {
  resourceType: "USER", operationType: kind === "disable" ? "UPDATE" : "ACTION",
  resourcePath: `users/${subject}${kind === "disable" ? "" : kind === "logout" ? "/logout" : "/reset-password"}`,
  ...(kind === "disable" && { representation: '{"enabled":false}' }),
});
beforeAll(() => { Object.assign(config, { cachePrefix: prefix }); initCache(`redis://localhost:${process.env.REDIS_PORT || "16387"}`); });
async function cleanup() { const keys = await getRedis().keys(`${prefix}:*`); if (keys.length) await getRedis().del(...keys); }
beforeEach(async () => {
  vi.restoreAllMocks(); await cleanup(); now = Date.now(); events = { user: [], admin: [] };
  source = { retentionMs: vi.fn(async () => 86400_000), page: vi.fn(async (stream, from, to, first, max) => events[stream].filter(e => e.time >= from && e.time <= to).slice(first, first + max).map(e => ({ ...e }))) };
  sync = { propagateVerifiedIdentifiers: vi.fn(async () => {}), requestReconcileNow: vi.fn(async () => {}) };
  vi.spyOn(keycloak, "listRevocationUsers").mockResolvedValue([{ id: subject }]);
  vi.spyOn(keycloak, "getRevocationUser").mockImplementation(async id => ({ id }));
  vi.spyOn(digit, "revokeToken").mockResolvedValue();
  vi.spyOn(keycloak, "endKeycloakSession").mockResolvedValue();
  vi.spyOn(keycloak, "keycloakSessionStarts").mockResolvedValue(new Map());
  for (const stream of ["user", "admin"] as const) await getRedis().hset(checkpointKey(stream), { time: now - 1000, idsAtTime: "[]" });
});
afterAll(async () => { vi.restoreAllMocks(); await cleanup(); await closeCache(); });

describe("Keycloak event poller", () => {
  it("missing checkpoints bootstrap at now without revocation or historical replay, including the next overlap", async () => {
    await getRedis().del(checkpointKey("user"), checkpointKey("admin"));
    const sid = await session();
    await withPersonLease(subject, lease => recordToken(lease, account, { accessToken: "digit", expiresAt: Date.now() + 600000, user: account }, "staff"));
    events.user = [event("old-reset", { type: "UPDATE_CREDENTIAL", details: { credential_type: "password" } })];
    events.admin = [adminEvent("disable")];
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await pollKeycloakEvents({ source, effect, now });
    expect(source.page).not.toHaveBeenCalled();
    expect(keycloak.listRevocationUsers).not.toHaveBeenCalled();
    for (const stream of ["user", "admin"] as const) {
      expect(await getRedis().hgetall(checkpointKey(stream))).toEqual({ time: String(now), idsAtTime: "[]", startedAt: String(now) });
      expect(log).toHaveBeenCalledWith({ event: "KEYCLOAK_EVENT_CHECKPOINT_BOOTSTRAPPED", stream, time: now });
    }
    events.user.push(event("new-email", { time: now + 1, type: "VERIFY_EMAIL" }));
    await pollKeycloakEvents({ source, effect, now: now + 1000 });
    expect(source.page).toHaveBeenCalledWith("user", now, now + 1000, 0, 100);
    expect(sync.propagateVerifiedIdentifiers).toHaveBeenCalledTimes(1);
    expect(await getIdentitySession(sid)).not.toBeNull();
    expect(await readToken(account)).not.toBeNull();
    expect(digit.revokeToken).not.toHaveBeenCalled();
  });
  it("lease loss prevents missing-checkpoint bootstrap", async () => {
    await getRedis().del(checkpointKey("user"), checkpointKey("admin"));
    vi.mocked(source.retentionMs).mockImplementation(async () => {
      await getRedis().set(key("kc-events:lease"), "other");
      return 86400_000;
    });
    await expect(pollKeycloakEvents({ source, effect, now })).rejects.toThrow();
    expect(await getRedis().exists(checkpointKey("user"), checkpointKey("admin"))).toBe(0);
    expect(source.page).not.toHaveBeenCalled();
  });
  it("dedupes (time,id), processes late out-of-order events, and overlaps windows", async () => {
    events.user = [event("b"), event("a", { time: now - 200 }), event("b")];
    const apply = vi.fn(async () => {});
    await pollKeycloakEvents({ source, effect: apply, now });
    expect(apply.mock.calls.map(call => call[1].id)).toEqual(["a", "b"]);
    events.user.push(event("late", { time: now - 150 }));
    await pollKeycloakEvents({ source, effect: apply, now: now + 1000 });
    expect(apply.mock.calls.map(call => call[1].id)).toEqual(["a", "b", "late"]);
    expect(source.page).toHaveBeenCalledWith("user", now - 60000, now + 1000, 0, 100);
    expect(await getRedis().zcard(seenKey("user"))).toBe(3);
  });
  it("does not advance past an unrecorded effect; a retry replays it", async () => {
    events.user = [event("email", { type: "VERIFY_EMAIL" })];
    vi.mocked(sync.propagateVerifiedIdentifiers).mockRejectedValueOnce(new Error("dependency"));
    await expect(pollKeycloakEvents({ source, effect, now })).rejects.toThrow("dependency");
    expect(await getRedis().hget(checkpointKey("user"), "time")).toBe(String(now - 1000));
    expect(await getRedis().zcard(seenKey("user"))).toBe(0);
    await pollKeycloakEvents({ source, effect, now });
    expect(sync.propagateVerifiedIdentifiers).toHaveBeenCalledTimes(2);
  });
  it("checkpoint outside retention conservatively revokes known sessions and tokens", async () => {
    const sid = await session();
    await withPersonLease(subject, lease => recordToken(lease, account, { accessToken: "digit", expiresAt: Date.now() + 600000, user: account }, "staff"));
    await getRedis().hset(checkpointKey("user"), "time", now - 2 * 86400_000);
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(sid)).toBeNull(); expect(await readToken(account)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledWith("digit");
    expect(await getRedis().hget(checkpointKey("user"), "time")).toBe(String(now));
  });
  const sessionDeleted = (kcSessionId: string, extra: Partial<KeycloakEvent> = {}) => event(`end-${kcSessionId}`,
    { userId: undefined, resourceType: "USER_SESSION", operationType: "DELETE", resourcePath: `sessions/${kcSessionId}`, ...extra });
  it("an admin USER_SESSION DELETE resolves its person from the kcSessionId index, without a realm scan", async () => {
    const sid = await session("kc-indexed");
    expect(await getRedis().get(kcSessionSubjectKey("kc-indexed"))).toBe(subject);
    expect(await getRedis().pttl(kcSessionSubjectKey("kc-indexed"))).toBeGreaterThanOrEqual(await getRedis().pttl(sessionKey(sid)) - 1000);
    await effect("admin", sessionDeleted("kc-indexed"));
    expect(await getIdentitySession(sid)).toBeNull();
    expect(keycloak.listRevocationUsers).not.toHaveBeenCalled();
  });
  it("without an index entry, the event's own user id is used before any scan", async () => {
    const sid = await session("kc-unindexed");
    await getRedis().del(kcSessionSubjectKey("kc-unindexed"));
    await effect("admin", sessionDeleted("kc-unindexed", { representation: JSON.stringify({ id: "kc-unindexed", userId: subject }) }));
    expect(await getIdentitySession(sid)).toBeNull();
    expect(keycloak.listRevocationUsers).not.toHaveBeenCalled();
  });
  it("the last-resort scan skips people without the session and survives a busy one", async () => {
    const sid = await session("kc-scan");
    await getRedis().del(kcSessionSubjectKey("kc-scan"));
    vi.mocked(keycloak.listRevocationUsers).mockResolvedValue([{ id: "busy-bystander" }, { id: subject }]);
    await getRedis().set(personLeaseKey("busy-bystander"), "someone-else", "PX", 30_000);
    await getRedis().set(personLeaseKey(subject), "someone-else", "PX", 30_000);
    const started = Date.now();
    await effect("admin", sessionDeleted("kc-scan"));
    expect(await getIdentitySession(sid)).toBeNull();
    // Only the holder waited for (and then bypassed) a busy lease; the bystander was never locked.
    expect(Date.now() - started).toBeLessThan(5_000);
  });
  it("writes deletion audit before scheduling revocation", async () => {
    const sid = await session();
    const redis = getRedis(); const zadd = redis.zadd.bind(redis); let auditBeforeQueue = false;
    vi.spyOn(redis, "zadd").mockImplementation(async (...args: any[]) => {
      if (args[0] === key("revoke-jobs")) auditBeforeQueue = await redis.xlen(key("audit")) > 0;
      return (zadd as any)(...args);
    });
    events.admin = [event("delete", { resourceType: "USER", operationType: "DELETE", resourcePath: `users/${subject}` })];
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await pollKeycloakEvents({ source, effect, now });
    expect(auditBeforeQueue).toBe(true); expect(log).toHaveBeenCalled();
    expect(await getIdentitySession(sid)).toBeNull();
  });
  it("self password change matches code_id + clientId, ignores the UPDATE_PASSWORD twin", async () => {
    const keep = await session(); const other = await session("other");
    const details = { credential_type: "password", code_id: "kc-session" };
    events.user = [event("twin", { type: "UPDATE_PASSWORD", details, clientId: "client", time: now - 101 }), event("password", { type: "UPDATE_CREDENTIAL", details, clientId: "client" })];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(keep)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(other)).toBeNull();
    events.admin = [adminEvent("credential")];
    await pollKeycloakEvents({ source, effect, now: now + 1 });
    expect(await getIdentitySession(keep)).toBeNull();
  });
  // Credential events are timed `now - 100`; Keycloak's auth_time is in whole seconds.
  const authedAfter = () => Math.ceil(now / 1000);
  const authedBefore = () => Math.floor((now - 100) / 1000) - 1;
  const setupEvent = (extra: Partial<KeycloakEvent> = {}) => event("setup", { type: "UPDATE_CREDENTIAL", clientId: "employee-client",
    details: { credential_type: "password", code_id: "kc-action-token" }, ...extra });
  it("live repro: a sign-in authenticated after an action-token password setup survives; an older one is revoked", async () => {
    const old = await session("kc-old", "employee-client", false, authedBefore());
    const fresh = await session("kc-fresh", "employee-client", false, authedAfter());
    expect(await getIdentitySession(fresh)).toMatchObject({ authTime: authedAfter() * 1000 });
    events.user = [setupEvent()];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(old)).toBeNull();
    expect(await getIdentitySession(fresh)).toMatchObject({ revocationGeneration: 1 });
    expect(await currentSession(sessionCookie(fresh, 600))).not.toBeNull();
  });
  it("a delayed code exchange of an old-password login is revoked though created after the change", async () => {
    // Authenticated before the change, code exchanged (BFF session created) after it.
    const late = await session("kc-attacker", "employee-client", false, authedBefore());
    expect((await getIdentitySession(late))!.createdAt).toBeGreaterThan(now - 100);
    events.user = [setupEvent({ details: { credential_type: "password", code_id: "kc-owner" } })];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(late)).toBeNull();
  });
  it("the Keycloak session that made the change survives whatever its client and auth_time", async () => {
    const changer = await session("kc-changer", "other-client", false, authedBefore());
    const other = await session("kc-other", "employee-client", false, authedBefore());
    events.user = [setupEvent({ details: { credential_type: "password", code_id: "kc-changer" } })];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(changer)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(other)).toBeNull();
  });
  it("a self password change keeps the initiating session (B3) and later sign-ins, and ends older ones", async () => {
    const keep = await session("kc-session", "client", false, authedBefore());
    const other = await session("other", "client", false, authedBefore());
    const fresh = await session("fresh", "client", false, authedAfter());
    events.user = [event("password", { type: "UPDATE_CREDENTIAL", details: { credential_type: "password", code_id: "kc-session" }, clientId: "client" })];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(keep)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(fresh)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(other)).toBeNull();
  });
  it("without auth_time, the Keycloak session start from the Admin API decides", async () => {
    const later = await session("kc-later"); const earlier = await session("kc-earlier");
    vi.mocked(keycloak.keycloakSessionStarts).mockResolvedValue(new Map([["kc-later", authedAfter() * 1000], ["kc-earlier", authedBefore() * 1000]]));
    events.user = [setupEvent()];
    await pollKeycloakEvents({ source, effect, now });
    expect(keycloak.keycloakSessionStarts).toHaveBeenCalledWith(subject);
    expect(await getIdentitySession(later)).not.toBeNull();
    expect(await getIdentitySession(earlier)).toBeNull();
  });
  it.each(["no Keycloak session", "an Admin API failure"])("without auth_time and with %s, the session counts as older", async kind => {
    const sid = await session("kc-unknown");
    if (kind === "an Admin API failure") vi.mocked(keycloak.keycloakSessionStarts).mockRejectedValue(new Error("down"));
    events.user = [setupEvent()];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(sid)).toBeNull();
  });
  it("an admin password reset also spares sessions authenticated after it", async () => {
    const old = await session("kc-old", "client", false, authedBefore()); const fresh = await session("kc-fresh", "client", false, authedAfter());
    events.admin = [adminEvent("credential")];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(old)).toBeNull();
    expect(await getIdentitySession(fresh)).not.toBeNull();
  });
  it("a spared session keeps a DIGIT token only it holds, not one an ended session also holds", async () => {
    const old = await session("kc-old", "client", false, authedBefore()); const fresh = await session("kc-fresh", "client", false, authedAfter());
    const shared = { tenantId: "tenant", uuid: "shared" };
    await withPersonLease(subject, async lease => {
      await recordToken(lease, account, { accessToken: "own", expiresAt: Date.now() + 600000, user: account }, "staff");
      await recordToken(lease, shared, { accessToken: "shared", expiresAt: Date.now() + 600000, user: shared }, "staff");
      await holdToken(lease, account, fresh); await holdToken(lease, shared, fresh); await holdToken(lease, shared, old);
    });
    events.user = [setupEvent()];
    await pollKeycloakEvents({ source, effect, now });
    expect(await readToken(account)).toMatchObject({ accessToken: "own" });
    expect(await readToken(shared)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledWith("shared");
    expect(digit.revokeToken).not.toHaveBeenCalledWith("own");
  });
  it.each(["client", "other-client"])("event client %s: the changer survives; a token it shares with an ended session is revoked", async client => {
    const sid = await session(); const old = await session("kc-old");
    await withPersonLease(subject, async lease => {
      await recordToken(lease, account, { accessToken: "shared", expiresAt: Date.now() + 600000, user: account }, "staff");
      await holdToken(lease, account, sid); await holdToken(lease, account, old);
    });
    events.user = [event("password", { type: "UPDATE_CREDENTIAL", details: { credential_type: "password", code_id: "kc-session" }, clientId: client })];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(sid)).not.toBeNull(); expect(await getIdentitySession(old)).toBeNull();
    expect(await readToken(account)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("shared");
  });
  it.each([false, true])("B3 keep and an auth_time-spared session as T's only holders keep T; an ended third holder revokes it (%s)", async ended => {
    const keep = await session("kc-session", "client", false, authedBefore());
    const fresh = await session("kc-fresh", "client", false, authedAfter());
    const old = await session("kc-old", "client", false, authedBefore());
    await withPersonLease(subject, async lease => {
      await recordToken(lease, account, { accessToken: "shared", expiresAt: Date.now() + 600000, user: account }, "staff");
      await holdToken(lease, account, keep); await holdToken(lease, account, fresh);
      if (ended) await holdToken(lease, account, old);
    });
    events.user = [event("password", { type: "UPDATE_CREDENTIAL", details: { credential_type: "password", code_id: "kc-session" }, clientId: "client" })];
    await pollKeycloakEvents({ source, effect, now });
    expect(await getIdentitySession(keep)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(fresh)).toMatchObject({ revocationGeneration: 1 });
    expect(await getIdentitySession(old)).toBeNull();
    if (ended) {
      expect(await readToken(account)).toBeNull();
      expect(digit.revokeToken).toHaveBeenCalledExactlyOnceWith("shared");
    } else {
      expect(await readToken(account)).toMatchObject({ accessToken: "shared" });
      expect(digit.revokeToken).not.toHaveBeenCalled();
    }
  });
  it("unmapped Organization deletion waits for a durable reconcile request before checkpoint", async () => {
    events.admin = [event("org-delete", { operationType: "DELETE", resourceType: "ORGANIZATION", resourcePath: "organizations/missing" })];
    vi.mocked(sync.requestReconcileNow).mockRejectedValueOnce(new Error("Redis failure"));
    await expect(pollKeycloakEvents({ source, effect, now })).rejects.toThrow("Redis failure");
    expect(await getRedis().hget(checkpointKey("admin"), "time")).toBe(String(now - 1000));
    await pollKeycloakEvents({ source, effect, now });
    expect(sync.requestReconcileNow).toHaveBeenCalledWith("organization-deleted");
  });
  it("readiness reports missing checkpoints, lag, and successful empty polls", async () => {
    await getRedis().del(checkpointKey("user")); expect(await getPollerReadiness()).toEqual({ status: "down", lagSeconds: null });
    for (const stream of ["user", "admin"] as const) await getRedis().hset(checkpointKey(stream), "time", now - 3600000);
    expect(await getPollerReadiness()).toMatchObject({ status: "down", lagSeconds: expect.any(Number) });
    await pollKeycloakEvents({ source, effect, now: Date.now() }); expect(await getPollerReadiness()).toMatchObject({ status: "ok" });
  });
  it("lease loss after an effect leaves it unseen for replay", async () => {
    events.user = [event("one")];
    await expect(pollKeycloakEvents({ source, now, effect: async () => { await getRedis().set(key("kc-events:lease"), "other"); } })).rejects.toThrow();
    expect(await getRedis().zcard(seenKey("user"))).toBe(0);
    expect(await getRedis().get(key("kc-events:lease"))).toBe("other");
  });
  it.each(["disable", "logout", "credential"] as const)("%s during _select revokes the recorded mint after its lease finishes", async kind => {
    const sid = await session(); let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pause = new Promise<void>(resolve => { release = resolve; });
    const select = withPersonLease(subject, async lease => {
      started(); await pause;
      await recordToken(lease, account, { accessToken: "in-flight", expiresAt: Date.now() + 600000, user: account }, "staff");
      await saveSelectedIdentityContext(sid, { organizationId: "org", organizationAlias: "org", tenantId: "tenant", name: "Tenant" });
    });
    await ready; await effect("admin", adminEvent(kind));
    const revoke = drainRevocationJobs(); release(); await Promise.all([select, revoke]);
    expect(await readToken(account)).toBeNull(); expect(await getIdentitySession(sid)).toBeNull();
    expect(digit.revokeToken).toHaveBeenCalledWith("in-flight");
  });
  it.each(["disable", "logout", "credential"] as const)("%s racing session refresh leaves no recreated session", async kind => {
    const sid = await session("kc-session", "client", true); let release!: () => void; let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const pause = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(oidc.refreshIdentityTokens).mockImplementation(async () => { started(); await pause; return tokens; });
    vi.mocked(oidc.verifyIdentityAccessToken).mockResolvedValue({ sub: subject, email: "test@example.invalid" });
    const refresh = currentSession(sessionCookie(sid, 600)); await ready;
    await effect("admin", adminEvent(kind)); const revoke = drainRevocationJobs(); release();
    await Promise.all([refresh, revoke]); expect(await getIdentitySession(sid)).toBeNull();
  });
  it("the next scheduled worker tick completes a previously failed revocation", async () => {
    await session(); vi.mocked(keycloak.getRevocationUser).mockRejectedValue(new Error("KC unavailable"));
    await expect(revokePerson(subject, "LOGOUT_ALL")).rejects.toThrow();
    vi.mocked(keycloak.getRevocationUser).mockResolvedValue({ id: subject });
    let tick!: () => Promise<void>;
    const originalSchedule = globalThis.setInterval;
    const schedule = vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => Promise<void>, delay: number) => {
      if (delay !== 5000) return originalSchedule(fn, delay);
      tick = fn; return { unref() {} } as any;
    }) as any);
    const clear = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    const stop = startRevocationWorkers();
    // Let the initial tick finish (Redis I/O); a later timer tick must also be safe.
    for (let i = 0; i < 100 && await getRedis().zcard(key("revoke-jobs")); i++) await new Promise(resolve => setImmediate(resolve));
    await tick(); stop(); schedule.mockRestore(); clear.mockRestore();
    expect(await getRedis().zcard(key("revoke-jobs"))).toBe(0);
  });
});

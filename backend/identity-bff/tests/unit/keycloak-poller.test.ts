import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { createIdentitySession, getIdentitySession, sessionCookie, saveSelectedIdentityContext } from "../../src/modules/sessions/session-store.js";
import { currentSession } from "../../src/modules/sessions/current-session.js";
import { checkpointKey, getPollerReadiness, pollKeycloakEvents, seenKey } from "../../src/modules/revocation/poller.js";
import { applyKeycloakEvent, type IdentifierEffects } from "../../src/modules/revocation/event-effects.js";
import type { EventSource, EventStream, KeycloakEvent } from "../../src/modules/revocation/event-source.js";
import { drainRevocationJobs, recordToken, revokePerson } from "../../src/modules/revocation/index.js";
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
async function session(sid = "kc-session", client = "client", refresh = false) {
  return (await createIdentitySession({ ...tokens, accessExpiresIn: refresh ? 1 : 600 },
    { sub: subject, email: "test@example.invalid", ...{ sid } }, client)).sessionId;
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
  for (const stream of ["user", "admin"] as const) await getRedis().hset(checkpointKey(stream), { time: now - 1000, idsAtTime: "[]" });
});
afterAll(async () => { vi.restoreAllMocks(); await cleanup(); await closeCache(); });

describe("Keycloak event poller", () => {
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
  it("a mismatched password-change client exempts no session", async () => {
    const sid = await session();
    events.user = [event("password", { type: "UPDATE_CREDENTIAL", details: { credential_type: "password", code_id: "kc-session" }, clientId: "other-client" })];
    await pollKeycloakEvents({ source, effect, now }); expect(await getIdentitySession(sid)).toBeNull();
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

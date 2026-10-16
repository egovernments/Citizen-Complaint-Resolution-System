import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { contextKey, createIdentitySession, getIdentitySession, saveSelectedIdentityContext, sessionCookie, sessionKey } from "../../src/modules/sessions/session-store.js";
import { currentSession } from "../../src/modules/sessions/current-session.js";
import * as oidc from "../../src/modules/authentication/oidc.js";

vi.mock("../../src/modules/authentication/oidc.js", async original => ({ ...await original<typeof import("../../src/modules/authentication/oidc.js")>(), refreshIdentityTokens: vi.fn(), verifyIdentityAccessToken: vi.fn() }));
// An access token already due for refresh, and Keycloak's idle limit as the refresh lifetime.
const tokens = { accessToken: "test-access", refreshToken: "test-refresh", accessExpiresIn: 1, refreshExpiresIn: 60 };
const refreshed = { accessToken: "next-access", refreshToken: "next-refresh", accessExpiresIn: 300, refreshExpiresIn: 1800 };
const claims = { sub: "test-lifetime", email: "test@example.invalid", sid: "kc-lifetime" };
const prefix = `session-lifetime-${process.pid}`;
beforeAll(() => {
  Object.assign(config, { cachePrefix: prefix });
  initCache(`redis://localhost:${process.env.REDIS_PORT || "16379"}`);
});
async function cleanup() {
  const keys = await getRedis().keys(`${prefix}:*`);
  if (keys.length) await getRedis().del(...keys);
}
beforeEach(async () => {
  await cleanup();
  vi.clearAllMocks();
  vi.mocked(oidc.refreshIdentityTokens).mockResolvedValue(refreshed);
  vi.mocked(oidc.verifyIdentityAccessToken).mockResolvedValue(claims);
});
afterAll(async () => { await cleanup(); await closeCache(); });

describe("session lifetime", () => {
  it("keeps the cookie for the longest a session can last", async () => {
    expect((await createIdentitySession(tokens, claims, "client")).maxAge).toBe(config.identitySessionTtlSeconds);
  });

  it("a refresh moves the session's end, and its selected context's, to the new refresh lifetime", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    await saveSelectedIdentityContext(sessionId, { organizationId: "o", organizationAlias: "a", tenantId: "t", name: "Tenant" });
    expect((await getIdentitySession(sessionId))!.sessionExpiresAt).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(await getRedis().pttl(contextKey(sessionId))).toBeLessThanOrEqual(60_000);

    const current = await currentSession(sessionCookie(sessionId, 600));
    expect(oidc.refreshIdentityTokens).toHaveBeenCalledTimes(1);
    expect(current?.session.accessToken).toBe("next-access");
    expect(current!.session.sessionExpiresAt).toBeGreaterThan(Date.now() + 1_700_000);
    expect(await getRedis().pttl(sessionKey(sessionId))).toBeGreaterThan(1_700_000);
    expect(await getRedis().pttl(contextKey(sessionId))).toBeGreaterThan(1_700_000);
  });

  it("an unused session still ends at its idle limit", async () => {
    const { sessionId } = await createIdentitySession({ ...tokens, refreshExpiresIn: 1 }, claims, "client");
    expect(await getIdentitySession(sessionId)).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, 1_200));
    expect(await currentSession(sessionCookie(sessionId, 600))).toBeNull();
    expect(oidc.refreshIdentityTokens).not.toHaveBeenCalled();
  });

  it("never slides past IDENTITY_SESSION_TTL_SECONDS after sign-in", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    // Signed in almost the whole session lifetime ago: 5 s are left.
    const signedInAt = Date.now() - config.identitySessionTtlSeconds * 1000 + 5_000;
    const record = (await getIdentitySession(sessionId))!;
    await getRedis().set(sessionKey(sessionId), JSON.stringify({ ...record, createdAt: signedInAt }), "KEEPTTL");

    const current = await currentSession(sessionCookie(sessionId, 600));
    expect(oidc.refreshIdentityTokens).toHaveBeenCalledTimes(1);
    expect(current!.session.sessionExpiresAt).toBe(signedInAt + config.identitySessionTtlSeconds * 1000);
    expect(await getRedis().pttl(sessionKey(sessionId))).toBeLessThanOrEqual(5_000);
  });

  it("caps a record written before createdAt existed from its sign-in, not from the refresh", async () => {
    const { sessionId } = await createIdentitySession(tokens, claims, "client");
    const signedInAt = Date.now() - config.identitySessionTtlSeconds * 1000 + 5_000;
    const { createdAt: _createdAt, ...legacy } = (await getIdentitySession(sessionId))!;
    await getRedis().set(sessionKey(sessionId), JSON.stringify({ ...legacy, authTime: signedInAt }), "KEEPTTL");

    const current = await currentSession(sessionCookie(sessionId, 600));
    expect(current!.session.sessionExpiresAt).toBe(signedInAt + config.identitySessionTtlSeconds * 1000);
    expect(current!.session.createdAt).toBe(signedInAt);
  });
});

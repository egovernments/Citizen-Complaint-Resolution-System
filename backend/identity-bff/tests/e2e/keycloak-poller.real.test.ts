import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { resetAdminToken } from "../../src/integrations/keycloak/admin-session.js";
import { createIdentitySession, getIdentitySession } from "../../src/modules/sessions/session-store.js";
import { withPersonLease } from "../../src/modules/accounts/person-lease.js";
import { recordToken } from "../../src/modules/revocation/index.js";
import { readToken, key } from "../../src/modules/revocation/inventory.js";
import { checkpointKey, pollKeycloakEvents } from "../../src/modules/revocation/poller.js";
import { applyKeycloakEvent } from "../../src/modules/revocation/event-effects.js";
import * as digit from "../../src/modules/managed-accounts/digit-user-client.js";
import { keycloakTestClient } from "../fixtures/keycloak/client.js";

const enabled = Boolean(process.env.KEYCLOAK_TEST_URL);
describe.skipIf(!enabled)("stock Keycloak 26.7.3 event poller", () => {
  let client: Awaited<ReturnType<typeof keycloakTestClient>>;
  let subject: string;
  const prefix = `real-poller-${process.pid}`;
  const account = { tenantId: "tenant", uuid: randomUUID() };
  const sync = { propagateVerifiedIdentifiers: async () => {}, requestReconcileNow: async () => {} };
  beforeAll(async () => {
    client = await keycloakTestClient();
    Object.assign(config, { cachePrefix: prefix, keycloakAdminUrl: client.base, keycloakAdminRealm: "master",
      keycloakAdminClientId: "admin-cli", keycloakAdminClientSecret: "", keycloakAdminUsername: "test-admin",
      keycloakAdminPassword: process.env.KEYCLOAK_TEST_ADMIN_PASSWORD, keycloakOrganizationRealm: "identity-test" });
    resetAdminToken(); initCache(`redis://localhost:${process.env.REDIS_PORT || "16387"}`);
    const created = await client.request("/users", "POST", { username: `poller-${randomUUID()}`, enabled: true });
    subject = created.headers.get("location")!.split("/").at(-1)!;
    for (const stream of ["user", "admin"] as const) await getRedis().hset(checkpointKey(stream), { time: Date.now() - 1000, idsAtTime: "[]" });
    vi.spyOn(digit, "revokeToken").mockResolvedValue();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (subject) await client.request(`/users/${subject}`, "DELETE").catch(() => undefined);
    const keys = await getRedis().keys(`${prefix}:*`); if (keys.length) await getRedis().del(...keys);
    await closeCache(); resetAdminToken();
  });
  async function openSession() {
    const { sessionId } = await createIdentitySession({ accessToken: "test-kc", accessExpiresIn: 600 }, { sub: subject, email: "test@example.invalid" }, "client");
    await withPersonLease(subject, lease => recordToken(lease, account, { accessToken: `digit-${sessionId}`, expiresAt: Date.now() + 600000, user: account }, "staff"));
    return sessionId;
  }
  it("consumes actual disable, logout-all and reset-password admin events and allows a fresh login after re-enable", async () => {
    for (const action of ["disable", "logout", "reset-password"]) {
      const sid = await openSession();
      if (action === "disable") await client.request(`/users/${subject}`, "PUT", { enabled: false });
      else await client.request(`/users/${subject}/${action}`, action === "logout" ? "POST" : "PUT",
        action === "reset-password" ? { type: "password", value: "FixtureOnly4@Secret", temporary: false } : undefined);
      await pollKeycloakEvents({ effect: (stream, event) => applyKeycloakEvent(stream, event, sync) });
      expect(await getIdentitySession(sid), action).toBeNull(); expect(await readToken(account), action).toBeNull();
      if (action === "disable") await client.request(`/users/${subject}`, "PUT", { enabled: true });
    }
  });
  it("audits a real user deletion before queued token revocation", async () => {
    const sid = await openSession();
    await client.request(`/users/${subject}`, "DELETE");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await pollKeycloakEvents({ effect: (stream, event) => applyKeycloakEvent(stream, event, sync) });
    expect(await getIdentitySession(sid)).toBeNull(); expect(await readToken(account)).toBeNull();
    expect(await getRedis().xlen(key("audit"))).toBeGreaterThan(0);
    log.mockRestore(); subject = "";
  });
});

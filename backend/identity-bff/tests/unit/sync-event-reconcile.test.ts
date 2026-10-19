import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { initCache, closeCache, getRedis } from "../../src/infrastructure/redis.js";
import { applyKeycloakEvent } from "../../src/modules/revocation/event-effects.js";
import { reconcileStatsKey } from "../../src/modules/sync/reconcile.js";

beforeAll(() => {
  Object.assign(config, { cachePrefix: `sync-event-${process.pid}` });
  initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16379}`);
});
afterAll(async () => {
  await getRedis().del(reconcileStatsKey());
  await closeCache();
});

describe("poller to real reconciliation provider", () => {
  it("an Organization DELETE without tenant metadata durably requests a forced pass", async () => {
    await getRedis().del(reconcileStatsKey());
    // No injected effects: exercise event-effects' lazy import of the real export.
    await applyKeycloakEvent("admin", { id: "deleted-org", time: Date.now(),
      resourceType: "ORGANIZATION", operationType: "DELETE", resourcePath: "organizations/gone" });
    const stats = await getRedis().hgetall(reconcileStatsKey());
    expect(stats.requestGeneration).toBe("1");
    expect(stats.requestReason).toBe("organization-deleted");
    expect(Number(stats.requestedAt)).toBeGreaterThan(0);
    expect(stats.completedGeneration).toBeUndefined();
  });
});

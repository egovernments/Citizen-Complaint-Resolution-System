import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeCache, getRedis, initCache } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import {
  currentPersonLease,
  LeaseBusyError,
  LeaseLostError,
  personLeaseKey,
  withPersonLease,
} from "../../src/modules/accounts/person-lease.js";
import { uuidLockKey, withUuidLock } from "../../src/modules/accounts/uuid-lock.js";

let run = 0;
const subject = () => `person-${process.pid}-${++run}`;

beforeAll(() => {
  Object.assign(config as any, { cachePrefix: `lease-test-${process.pid}` });
  initCache(`redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || "16379"}`);
});

afterAll(async () => {
  const keys = await getRedis().keys(`lease-test-${process.pid}:*`);
  if (keys.length) await getRedis().del(...keys);
  await closeCache();
});

describe("person lease", () => {
  it("serialises two operations on the same person", async () => {
    const sub = subject();
    const order: string[] = [];
    const first = withPersonLease(sub, async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 300));
      order.push("first:end");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = withPersonLease(sub, async () => { order.push("second"); });
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("times out with LeaseBusyError while another holder keeps it", async () => {
    const sub = subject();
    await getRedis().set(personLeaseKey(sub), "someone-else", "PX", 5_000);
    await expect(withPersonLease(sub, async () => "never", { waitMs: 200 }))
      .rejects.toSatisfy((error) => error instanceof LeaseBusyError && error.code === "IDENTITY_BUSY");
  });

  it("releases on success and on error", async () => {
    const sub = subject();
    await withPersonLease(sub, async () => undefined);
    expect(await getRedis().get(personLeaseKey(sub))).toBeNull();
    await expect(withPersonLease(sub, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await getRedis().get(personLeaseKey(sub))).toBeNull();
  });

  it("is re-entrant for the same person and refuses a second person", async () => {
    const sub = subject();
    await withPersonLease(sub, async (outer) => {
      await withPersonLease(sub, async (inner) => {
        expect(inner.token).toBe(outer.token);
      }, { waitMs: 0 });
      await expect(withPersonLease(subject(), async () => undefined)).rejects.toThrow(/one at a time/);
      expect(currentPersonLease()?.subject).toBe(sub);
    });
    expect(currentPersonLease()).toBeNull();
  });

  it("detects a lost lease and refuses fenced writes", async () => {
    const sub = subject();
    const target = `${config.cachePrefix}:fenced:${sub}`;
    await withPersonLease(sub, async (lease) => {
      expect(await lease.fencedSet(target, "a", Date.now() + 60_000)).toBe(true);
      expect(await getRedis().get(target)).toBe("a");
      await getRedis().set(personLeaseKey(sub), "stolen");
      expect(await lease.fencedSet(target, "b", Date.now() + 60_000)).toBe(false);
      await expect(lease.assertHeld()).rejects.toBeInstanceOf(LeaseLostError);
    });
    expect(await getRedis().get(target)).toBe("a");
    // The stolen lease belongs to someone else and is not released by us.
    expect(await getRedis().get(personLeaseKey(sub))).toBe("stolen");
  });

  it("fenced writes expire at the given time", async () => {
    const sub = subject();
    const target = `${config.cachePrefix}:fenced-ttl:${sub}`;
    await withPersonLease(sub, (lease) => lease.fencedSet(target, "x", Date.now() + 10_000));
    const ttl = await getRedis().pttl(target);
    expect(ttl).toBeGreaterThan(8_000);
    expect(ttl).toBeLessThanOrEqual(10_500); // host and Redis clocks may differ slightly
  });
});

describe("uuid lock", () => {
  it("is renewed while held and reports a lost lock", async () => {
    const uuid = `uuid-renew-${process.pid}-${++run}`;
    await withPersonLease(subject(), () => withUuidLock("pg", uuid, async (lock) => {
      await getRedis().pexpire(uuidLockKey("pg", uuid), 50);
      await new Promise((resolve) => setTimeout(resolve, 120));
      await expect(lock.assertHeld()).rejects.toBeInstanceOf(LeaseLostError);
    }));
    await withPersonLease(subject(), () => withUuidLock("pg", uuid, async (lock) => {
      await lock.assertHeld();
      expect(await getRedis().pttl(uuidLockKey("pg", uuid))).toBeGreaterThan(20_000);
    }));
  });

  it("is refused outside a person lease", async () => {
    await expect(withUuidLock("pg", "u-1", async () => undefined)).rejects.toThrow(/inside a person lease/);
  });

  it("lets only one of two people bind the same uuid at a time", async () => {
    const uuid = `uuid-${process.pid}-${++run}`;
    let inside = 0;
    let maxInside = 0;
    const attempt = (sub: string) => withPersonLease(sub, () => withUuidLock("pg", uuid, async () => {
      inside += 1;
      maxInside = Math.max(maxInside, inside);
      await new Promise((resolve) => setTimeout(resolve, 150));
      inside -= 1;
    }));
    await Promise.all([attempt(subject()), attempt(subject())]);
    expect(maxInside).toBe(1);
    expect(await getRedis().get(uuidLockKey("pg", uuid))).toBeNull();
  });
});

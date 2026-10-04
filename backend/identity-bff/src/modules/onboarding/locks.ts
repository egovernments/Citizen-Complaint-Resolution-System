import { randomUUID } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import { OnboardingError } from "./errors.js";

export interface OnboardingFence { assertHeld(): Promise<void> }
export type LockFamily = "op" | "tenant" | "slug";

/** Only onboarding locks live here. Person/uuid locking belongs to core. */
export async function withOnboardingLock<T>(
  family: LockFamily,
  id: string,
  operation: (fence: OnboardingFence) => Promise<T>,
  parent?: OnboardingFence,
  options: { waitMs?: number; ttlMs?: number } = {},
): Promise<T> {
  const redis = getRedis();
  const key = `${config.cachePrefix}:identity:${family}-lock:${id}`;
  const token = randomUUID();
  const ttl = options.ttlMs ?? 60_000;
  const deadline = Date.now() + (options.waitMs ?? 15_000);
  const busy = () => new OnboardingError("IDENTITY_BUSY", "Onboarding is busy; retry the same request");
  while (await redis.set(key, token, "PX", ttl, "NX") !== "OK") {
    await parent?.assertHeld();
    if (Date.now() >= deadline) throw busy();
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  let lost = false;
  const fence: OnboardingFence = {
    async assertHeld() {
      await parent?.assertHeld();
      if (lost || await redis.get(key) !== token) throw busy();
    },
  };
  const timer = setInterval(() => {
    void redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
      1, key, token, ttl,
    ).then((held) => { if (held !== 1) lost = true; }).catch(() => { lost = true; });
  }, Math.max(1, Math.floor(ttl / 3)));
  timer.unref();
  try {
    await fence.assertHeld();
    const result = await operation(fence);
    await fence.assertHeld();
    return result;
  } finally {
    clearInterval(timer);
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, key, token,
    );
  }
}

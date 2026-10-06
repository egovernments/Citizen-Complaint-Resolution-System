import { config } from "../../infrastructure/config.js";
import { acquireRedisLease } from "../../infrastructure/redis.js";
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
  const ttl = options.ttlMs ?? 60_000;
  const busy = () => new OnboardingError("IDENTITY_BUSY", "Onboarding is busy; retry the same request");
  const lease = await acquireRedisLease(`${config.cachePrefix}:identity:${family}-lock:${id}`, {
    ttlMs: ttl, waitMs: options.waitMs ?? 15_000, retryMs: 25, renewMs: Math.max(1, Math.floor(ttl / 3)),
    onWait: async () => { await parent?.assertHeld(); },
  });
  if (!lease) throw busy();
  const fence: OnboardingFence = {
    async assertHeld() {
      await parent?.assertHeld();
      if (!await lease.held()) throw busy();
    },
  };
  try {
    await fence.assertHeld();
    const result = await operation(fence);
    await fence.assertHeld();
    return result;
  } finally {
    await lease.release();
  }
}

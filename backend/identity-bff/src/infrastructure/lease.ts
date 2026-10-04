import { randomUUID } from "node:crypto";
import { getRedis } from "./redis.js";

const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Runs `operation` while holding a Redis lease on `key` (SET NX EX), across
 * replicas. Waits up to `waitMs` for the lease, then throws `busy()`. Only
 * the holder's own value is released, so an expired lease taken over by
 * someone else is never deleted.
 */
export async function withRedisLease<T>(
  key: string,
  options: { ttlSeconds: number; waitMs: number; pollMs: number },
  busy: () => Error,
  operation: () => Promise<T>,
): Promise<T> {
  const value = randomUUID();
  const deadline = Date.now() + options.waitMs;
  while (await getRedis().set(key, value, "EX", options.ttlSeconds, "NX") !== "OK") {
    if (Date.now() >= deadline) throw busy();
    await new Promise((resolve) => setTimeout(resolve, options.pollMs));
  }
  try {
    return await operation();
  } finally {
    await getRedis().eval(RELEASE, 1, key, value);
  }
}

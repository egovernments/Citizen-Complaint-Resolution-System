import { createHmac } from "node:crypto";
import { config } from "./config.js";
import { getRedis } from "./redis.js";

/**
 * Counts one event in a fixed window that starts with the first event. The
 * expiry is also set again whenever the key has none (e.g. after a failed
 * EXPIRE), so a counter can never become permanent.
 */
const COUNT_IN_WINDOW = `local current = redis.call('INCR', KEYS[1])
  if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return {current, redis.call('TTL', KEYS[1])}`;

export async function countInWindow(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
  const [count, ttl] = await getRedis().eval(COUNT_IN_WINDOW, 1, key, windowSeconds) as [number, number];
  return { count: Number(count), ttl: Number(ttl) };
}

/** True while `key` has seen at most `limit` events in its window. */
export async function withinLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  return (await countInWindow(key, windowSeconds)).count <= limit;
}

/** Takes back one counted event (never below zero), e.g. for a send that failed. */
const UNCOUNT = `local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current > 0 then redis.call('DECR', KEYS[1]) end
  return 0`;

export async function uncount(key: string): Promise<void> {
  await getRedis().eval(UNCOUNT, 1, key);
}

/** HMAC of an identifier under a per-purpose key: rate-limit keys never hold the identifier. */
export function privateRateKey(purpose: string, identifier: string): string {
  const key = createHmac("sha256", config.keycloakBffClientSecret)
    .update(`digit.identity.${purpose}.rate-limit.v1`)
    .digest();
  return createHmac("sha256", key).update(identifier).digest("hex");
}

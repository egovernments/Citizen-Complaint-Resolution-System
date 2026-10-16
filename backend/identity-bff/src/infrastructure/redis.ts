import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { config } from "./config.js";

let redis: Redis;

export function initCache(redisUrl?: string) {
  redis = redisUrl
    ? new Redis(redisUrl)
    : new Redis({ host: config.redisHost, port: config.redisPort });
  return redis;
}

export function getRedis() {
  return redis;
}

export async function closeCache(): Promise<void> {
  await redis?.quit();
}

const RENEW = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end";
const RELEASE = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** A token-owned Redis key (SET NX PX), released only by compare-and-delete. */
export interface RedisLease {
  readonly key: string;
  readonly token: string;
  /** Set once a renewal or held() check fails; never cleared. */
  lost: boolean;
  /** True while this token still owns the key. */
  held(): Promise<boolean>;
  /** Stops renewal and deletes the key if this token still owns it. */
  release(): Promise<unknown>;
}

export interface RedisLeaseOptions {
  ttlMs: number;
  /** How long to retry a held key; 0 tries once. */
  waitMs?: number;
  retryMs?: number;
  /** Renew to ttlMs on this interval while held; omitted means no renewal. */
  renewMs?: number;
  /** Runs before each deadline check while waiting. */
  onWait?: () => Promise<void>;
}

/** Null when the key is still held by someone else after `waitMs`. */
export async function acquireRedisLease(key: string, options: RedisLeaseOptions): Promise<RedisLease | null> {
  const token = randomUUID();
  const deadline = Date.now() + (options.waitMs ?? 0);
  while (await redis.set(key, token, "PX", options.ttlMs, "NX") !== "OK") {
    await options.onWait?.();
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, options.retryMs ?? 100));
  }
  const timer = options.renewMs ? setInterval(() => {
    if (lease.lost) return;
    redis.eval(RENEW, 1, key, token, String(options.ttlMs))
      .then((result) => { if (result !== 1) lease.lost = true; }, () => { lease.lost = true; });
  }, options.renewMs) : undefined;
  timer?.unref();
  const lease: RedisLease = {
    key, token, lost: false,
    async held() {
      if (!lease.lost && await redis.get(key) === token) return true;
      lease.lost = true;
      return false;
    },
    release() {
      clearInterval(timer);
      return redis.eval(RELEASE, 1, key, token);
    },
  };
  return lease;
}

/** Acquire (or throw `busy()`), run, then release; `quietRelease` ignores a failed release. */
export async function withRedisLease<T>(
  key: string,
  options: RedisLeaseOptions & { busy: () => Error; quietRelease?: boolean },
  operation: (lease: RedisLease) => Promise<T>,
): Promise<T> {
  const lease = await acquireRedisLease(key, options);
  if (!lease) throw options.busy();
  try {
    return await operation(lease);
  } finally {
    const released = lease.release();
    await (options.quietRelease ? released.catch(() => undefined) : released);
  }
}

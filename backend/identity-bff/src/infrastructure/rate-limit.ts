import { createHmac } from "node:crypto";
import { isIP } from "node:net";
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

/** Takes back one counted event (never below zero), e.g. for a send that failed. */
const UNCOUNT = `local current = tonumber(redis.call('GET', KEYS[1]) or '0')
  if current > 0 then redis.call('DECR', KEYS[1]) end
  return 0`;

export async function uncount(key: string): Promise<void> {
  await getRedis().eval(UNCOUNT, 1, key);
}

/**
 * Counts one request against several fixed windows in a single atomic script
 * (one round trip), in order. The first bucket over its limit refuses the
 * request and keeps that charge, as refused requests count where they were
 * refused. Later buckets are not counted. Earlier ones give their charge back
 * unless they are `keepOnRefusal`. A given-back counter that reaches zero is
 * deleted, so a refused request never starts a window. Returns the 1-based
 * index of the refusing bucket and its window's remaining seconds, or 0.
 */
const RESERVE_IN_WINDOWS = `for i = 1, #KEYS do
    local count = redis.call('INCR', KEYS[i])
    if redis.call('TTL', KEYS[i]) < 0 then redis.call('EXPIRE', KEYS[i], ARGV[3 * i - 1]) end
    if count > tonumber(ARGV[3 * i - 2]) then
      for j = 1, i - 1 do
        if ARGV[3 * j] ~= '1' and redis.call('DECR', KEYS[j]) <= 0 then redis.call('DEL', KEYS[j]) end
      end
      return {i, redis.call('TTL', KEYS[i])}
    end
  end
  return {0, 0}`;

export interface WindowBucket {
  key: string;
  limit: number;
  windowSeconds: number;
  /** Keep this charge when a later bucket refuses the request; by default it is given back. */
  keepOnRefusal?: boolean;
}

export type WindowReservation =
  | { allowed: true }
  | { allowed: false; refusedBy: number; retryAfter: number };

/**
 * One request against `buckets`, checked in the given order: either all of
 * them have room and are charged, or `refusedBy` is the index of the first
 * that refused, with the seconds left in its window. A Redis failure leaves
 * nothing half-charged.
 */
export async function reserveInWindows(buckets: readonly WindowBucket[]): Promise<WindowReservation> {
  const args = buckets.flatMap((bucket) => [bucket.limit, bucket.windowSeconds, bucket.keepOnRefusal ? 1 : 0]);
  const [refusedBy, ttl] = await getRedis().eval(
    RESERVE_IN_WINDOWS, buckets.length, ...buckets.map((bucket) => bucket.key), ...args,
  ) as [number, number];
  return Number(refusedBy) === 0
    ? { allowed: true }
    : { allowed: false, refusedBy: Number(refusedBy) - 1, retryAfter: Math.max(1, Number(ttl)) };
}

/** The eight 16-bit groups of a valid IPv6 address (an embedded IPv4 tail fills the last two). */
function ipv6Groups(address: string): number[] {
  const parse = (part: string | undefined) => (part ? part.split(":") : []).flatMap((group) => {
    if (!group.includes(".")) return [parseInt(group, 16)];
    const [a, b, c, d] = group.split(".").map(Number) as [number, number, number, number];
    return [(a << 8) | b, (c << 8) | d];
  });
  const [head, tail] = address.split("::");
  const front = parse(head);
  const back = parse(tail);
  return [...front, ...new Array<number>(8 - front.length - back.length).fill(0), ...back];
}

/**
 * The network a per-IP limit counts a caller under. IPv4 is the address
 * itself, also when written as IPv4-mapped IPv6. IPv6 is its /64: a home or
 * host is normally given a whole /64, so keying single IPv6 addresses would
 * give one caller endless fresh budgets.
 */
export function rateLimitNetwork(ip: string | undefined): string {
  if (!ip) return "unknown";
  const address = ip.split("%")[0]!;
  if (isIP(address) !== 6) return ip;
  const groups = ipv6Groups(address);
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

/** HMAC of an identifier under a per-purpose key: rate-limit keys never hold the identifier. */
export function privateRateKey(purpose: string, identifier: string): string {
  const key = createHmac("sha256", config.keycloakBffClientSecret)
    .update(`digit.identity.${purpose}.rate-limit.v1`)
    .digest();
  return createHmac("sha256", key).update(identifier).digest("hex");
}

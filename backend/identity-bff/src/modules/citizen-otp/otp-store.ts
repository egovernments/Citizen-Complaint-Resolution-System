import { createHmac, randomBytes, randomInt } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import type { BoundTenant } from "../authentication/surfaces.js";

/**
 * Citizen OTP state in Redis (#2189). Codes are stored only as an HMAC keyed
 * by IDENTITY_CITIZEN_OTP_SECRET and bound to their challenge, so a Redis dump
 * cannot be brute-forced offline. Phone-keyed buckets use the same keyed hash,
 * never the number itself.
 */

const PREFIX = () => `${config.cachePrefix}:identity:citizen-otp`;

function keyed(value: string): string {
  return createHmac("sha256", config.identityCitizenOtpSecret).update(value).digest("hex");
}

/** Stable, non-reversible reference for a phone number or IP in keys and audit. */
export function privateRef(kind: "phone" | "ip" | "session", value: string): string {
  return keyed(`${kind}\n${value}`).slice(0, 32);
}

function codeHash(challengeId: string, code: string): string {
  return keyed(`code\n${challengeId}\n${code}`);
}

const challengeKey = (id: string) => `${PREFIX()}:challenge:${id}`;
const lockKey = (phoneRef: string) => `${PREFIX()}:lock:${phoneRef}`;
const failuresKey = (phoneRef: string) => `${PREFIX()}:failures:${phoneRef}`;
const cooldownKey = (phoneRef: string) => `${PREFIX()}:cooldown:${phoneRef}`;
const phoneSendsKey = (phoneRef: string) => `${PREFIX()}:sends:phone:${phoneRef}`;
const ipSendsKey = (ipRef: string) => `${PREFIX()}:sends:ip:${ipRef}`;

export interface OtpChallenge {
  id: string;
  phoneNumber: string;
  tenant: BoundTenant;
}

/** Seconds until the phone's lockout ends, or 0 when it is not locked. */
export async function lockoutRemaining(phoneNumber: string): Promise<number> {
  const ttl = await getRedis().ttl(lockKey(privateRef("phone", phoneNumber)));
  return ttl > 0 ? ttl : 0;
}

const COUNT_IN_WINDOW = `local current = redis.call('INCR', KEYS[1])
  if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return {current, redis.call('TTL', KEYS[1])}`;

async function countInWindow(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
  const [count, ttl] = await getRedis().eval(COUNT_IN_WINDOW, 1, key, windowSeconds) as [number, number];
  return { count: Number(count), ttl: Number(ttl) };
}

export type SendAllowance =
  | { allowed: true }
  | { allowed: false; reason: "COOLDOWN" | "PHONE_LIMIT" | "IP_LIMIT"; retryAfter: number };

/**
 * Resend limits: a per-phone cooldown between codes, and per-phone and per-IP
 * counts in a rolling window. Every request counts, including refused ones.
 */
export async function reserveSend(phoneNumber: string, ip: string): Promise<SendAllowance> {
  const phoneRef = privateRef("phone", phoneNumber);
  const window = config.identityCitizenOtpSendWindowSeconds;
  const ipSends = await countInWindow(ipSendsKey(privateRef("ip", ip)), window);
  if (ipSends.count > config.identityCitizenOtpIpSendLimit) {
    return { allowed: false, reason: "IP_LIMIT", retryAfter: Math.max(1, ipSends.ttl) };
  }
  const cooled = config.identityCitizenOtpResendSeconds <= 0 || await getRedis().set(
    cooldownKey(phoneRef), "1", "EX", config.identityCitizenOtpResendSeconds, "NX",
  );
  if (!cooled) {
    const ttl = await getRedis().ttl(cooldownKey(phoneRef));
    return { allowed: false, reason: "COOLDOWN", retryAfter: Math.max(1, ttl) };
  }
  const phoneSends = await countInWindow(phoneSendsKey(phoneRef), window);
  if (phoneSends.count > config.identityCitizenOtpPhoneSendLimit) {
    return { allowed: false, reason: "PHONE_LIMIT", retryAfter: Math.max(1, phoneSends.ttl) };
  }
  return { allowed: true };
}

/** A new six-digit code for a new challenge. The code itself is never stored. */
export async function createChallenge(
  phoneNumber: string,
  tenant: BoundTenant,
): Promise<{ challenge: OtpChallenge; code: string }> {
  const id = randomBytes(24).toString("base64url");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const key = challengeKey(id);
  await getRedis().multi()
    .hset(key, {
      hash: codeHash(id, code),
      attempts: "0",
      phoneNumber,
      tenant: JSON.stringify(tenant),
    })
    .expire(key, config.identityCitizenOtpTtlSeconds)
    .exec();
  return { challenge: { id, phoneNumber, tenant }, code };
}

export async function deleteChallenge(id: string): Promise<void> {
  await getRedis().del(challengeKey(id));
}

export async function readChallenge(id: string): Promise<OtpChallenge | null> {
  const stored = await getRedis().hgetall(challengeKey(id));
  if (!stored.hash || !stored.phoneNumber || !stored.tenant) return null;
  try {
    return { id, phoneNumber: stored.phoneNumber, tenant: JSON.parse(stored.tenant) as BoundTenant };
  } catch {
    return null;
  }
}

/**
 * Compare, count and consume in one step, so concurrent guesses cannot share
 * an attempt and a right code is accepted exactly once.
 */
const CHECK_CODE = `local hash = redis.call('HGET', KEYS[1], 'hash')
  if not hash then return {'MISSING', 0} end
  if hash == ARGV[1] or ARGV[3] == '1' then
    if redis.call('DEL', KEYS[1]) == 1 then return {'OK', 0} end
    return {'MISSING', 0}
  end
  local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
  local remaining = tonumber(ARGV[2]) - attempts
  if remaining <= 0 then redis.call('DEL', KEYS[1]) end
  return {'WRONG', remaining}`;

export type CodeCheck =
  | { status: "OK"; fixedCode: boolean }
  | { status: "MISSING" }
  | { status: "WRONG"; attemptsRemaining: number; locked: boolean };

/**
 * `fixedCode` is the enabled legacy fixed OTP: it satisfies any live
 * challenge, still single-use and still behind lockout.
 */
export async function checkCode(
  challenge: OtpChallenge,
  code: string,
  fixedCode: string | null = null,
): Promise<CodeCheck> {
  const fixed = fixedCode !== null && code === fixedCode;
  const [status, remaining] = await getRedis().eval(
    CHECK_CODE, 1, challengeKey(challenge.id),
    codeHash(challenge.id, code), config.identityCitizenOtpMaxAttempts, fixed ? "1" : "0",
  ) as [string, number];
  if (status === "OK") {
    await getRedis().del(failuresKey(privateRef("phone", challenge.phoneNumber)));
    return { status: "OK", fixedCode: fixed };
  }
  if (status !== "WRONG") return { status: "MISSING" };
  // Wrong guesses also add up per phone across challenges; enough of them
  // lock the phone out of both sending and verifying.
  const phoneRef = privateRef("phone", challenge.phoneNumber);
  const failures = await countInWindow(failuresKey(phoneRef), config.identityCitizenOtpLockoutSeconds);
  const locked = failures.count >= config.identityCitizenOtpLockoutFailures;
  if (locked) {
    await getRedis().multi()
      .set(lockKey(phoneRef), "1", "EX", config.identityCitizenOtpLockoutSeconds)
      .del(failuresKey(phoneRef), challengeKey(challenge.id))
      .exec();
  }
  return { status: "WRONG", attemptsRemaining: locked ? 0 : Math.max(0, Number(remaining)), locked };
}

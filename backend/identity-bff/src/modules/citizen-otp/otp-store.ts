import { createHmac, randomBytes, randomInt } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { countInWindow, uncount } from "../../infrastructure/rate-limit.js";
import { getRedis } from "../../infrastructure/redis.js";
import type { BoundTenant } from "../authentication/surfaces.js";

/**
 * Citizen OTP state in Redis (#2189). Codes are stored only as an HMAC keyed
 * by IDENTITY_CITIZEN_OTP_SECRET and bound to their challenge, so a Redis dump
 * cannot be brute-forced offline. Phone-keyed buckets use the same keyed hash,
 * never the number itself.
 *
 * Guessing is bounded per challenge (IDENTITY_CITIZEN_OTP_MAX_ATTEMPTS) and by
 * the per-phone and per-IP send limits. There is deliberately no lockout per
 * phone number: anyone who knows a number could use one to lock its owner out.
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
const cooldownKey = (phoneRef: string) => `${PREFIX()}:cooldown:${phoneRef}`;
const phoneSendsKey = (phoneRef: string) => `${PREFIX()}:sends:phone:${phoneRef}`;
const ipSendsKey = (ipRef: string) => `${PREFIX()}:sends:ip:${ipRef}`;

export interface OtpChallenge {
  id: string;
  phoneNumber: string;
  tenant: BoundTenant;
}

/** What a granted send charged, so a failed delivery can give it back. */
export interface SendReservation {
  phoneRef: string;
  ipRef: string;
  cooldown: boolean;
}

export type SendAllowance =
  | { allowed: true; reservation: SendReservation }
  | { allowed: false; reason: "COOLDOWN" | "PHONE_LIMIT" | "IP_LIMIT"; retryAfter: number };

/**
 * Resend limits: a per-phone cooldown between codes, and per-phone and per-IP
 * counts in a window. Refused requests count too; a granted send that then
 * fails to deliver is refunded with `refundSend`.
 */
export async function reserveSend(phoneNumber: string, ip: string): Promise<SendAllowance> {
  const phoneRef = privateRef("phone", phoneNumber);
  const ipRef = privateRef("ip", ip);
  const window = config.identityCitizenOtpSendWindowSeconds;
  const cooldown = config.identityCitizenOtpResendSeconds > 0;
  const inCooldown = async () => {
    const ttl = await getRedis().ttl(cooldownKey(phoneRef));
    return { allowed: false as const, reason: "COOLDOWN" as const, retryAfter: Math.max(1, ttl) };
  };
  // The cooldown is checked first, so pressing "resend" too early costs
  // nothing from the IP budget that others behind the same address share.
  if (cooldown && await getRedis().exists(cooldownKey(phoneRef))) return inCooldown();
  const ipSends = await countInWindow(ipSendsKey(ipRef), window);
  if (ipSends.count > config.identityCitizenOtpIpSendLimit) {
    return { allowed: false, reason: "IP_LIMIT", retryAfter: Math.max(1, ipSends.ttl) };
  }
  if (cooldown && !await getRedis().set(
    cooldownKey(phoneRef), "1", "EX", config.identityCitizenOtpResendSeconds, "NX",
  )) {
    // Lost a race with another send for the same number.
    await uncount(ipSendsKey(ipRef));
    return inCooldown();
  }
  const phoneSends = await countInWindow(phoneSendsKey(phoneRef), window);
  if (phoneSends.count > config.identityCitizenOtpPhoneSendLimit) {
    return { allowed: false, reason: "PHONE_LIMIT", retryAfter: Math.max(1, phoneSends.ttl) };
  }
  return { allowed: true, reservation: { phoneRef, ipRef, cooldown } };
}

/** A code that never reached the citizen costs them nothing. */
export async function refundSend(reservation: SendReservation): Promise<void> {
  await uncount(phoneSendsKey(reservation.phoneRef));
  await uncount(ipSendsKey(reservation.ipRef));
  if (reservation.cooldown) await getRedis().del(cooldownKey(reservation.phoneRef));
}

/** A new six-digit code for a new challenge. The code itself is never stored. */
export async function createChallenge(
  phoneNumber: string,
  tenant: BoundTenant,
): Promise<{ challenge: OtpChallenge; code: string }> {
  const id = randomBytes(24).toString("base64url");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const key = challengeKey(id);
  const results = await getRedis().multi()
    .hset(key, {
      hash: codeHash(id, code),
      attempts: "0",
      phoneNumber,
      tenant: JSON.stringify(tenant),
    })
    .expire(key, config.identityCitizenOtpTtlSeconds)
    .exec();
  // ioredis reports a failed command inside the result, not as a throw. A
  // challenge that was not stored, or would never expire, must not be sent.
  const failed = !results || results.some(([error]) => error) || results[1]?.[1] !== 1;
  if (failed) {
    await getRedis().del(key).catch(() => undefined);
    throw new Error("The OTP challenge could not be stored");
  }
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
 * Compare and count in one step. A right code CLAIMS the challenge instead of
 * deleting it: the claim makes it unusable for anyone else while sign-in
 * completes, and the route then either consumes it (`deleteChallenge`) or,
 * when Keycloak was briefly unavailable, releases it (`releaseChallenge`) so
 * the same code still works.
 */
const CLAIM_CODE = `local hash = redis.call('HGET', KEYS[1], 'hash')
  if not hash then return {'MISSING', 0} end
  if redis.call('HEXISTS', KEYS[1], 'claimed') == 1 then return {'MISSING', 0} end
  if hash == ARGV[1] or ARGV[3] == '1' then
    redis.call('HSET', KEYS[1], 'claimed', '1')
    return {'OK', 0}
  end
  local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
  local remaining = tonumber(ARGV[2]) - attempts
  if remaining <= 0 then redis.call('DEL', KEYS[1]) end
  return {'WRONG', remaining}`;

export type CodeCheck =
  | { status: "OK"; fixedCode: boolean }
  | { status: "MISSING" }
  | { status: "WRONG"; attemptsRemaining: number };

/**
 * `fixedCode` is the enabled legacy fixed OTP: it satisfies any live
 * challenge, still single-use and still behind the attempt limit.
 */
export async function claimCode(
  challenge: OtpChallenge,
  code: string,
  fixedCode: string | null = null,
): Promise<CodeCheck> {
  const fixed = fixedCode !== null && code === fixedCode;
  const [status, remaining] = await getRedis().eval(
    CLAIM_CODE, 1, challengeKey(challenge.id),
    codeHash(challenge.id, code), config.identityCitizenOtpMaxAttempts, fixed ? "1" : "0",
  ) as [string, number];
  if (status === "OK") return { status: "OK", fixedCode: fixed };
  if (status !== "WRONG") return { status: "MISSING" };
  return { status: "WRONG", attemptsRemaining: Math.max(0, Number(remaining)) };
}

export async function releaseChallenge(id: string): Promise<void> {
  await getRedis().hdel(challengeKey(id), "claimed");
}

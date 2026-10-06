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
 * Guessing is bounded per challenge (IDENTITY_CITIZEN_OTP_MAX_ATTEMPTS), by
 * one live challenge per number (a new code replaces the previous one), and
 * by the per-phone and per-IP send limits. Wrong codes never lock a number:
 * anyone who knows it could use that to lock its owner out. The resend
 * cooldown is per number AND caller IP for the same reason. The hourly
 * per-phone send cap is the one deliberate exception: it bounds SMS cost and
 * total guesses per number (send limit × attempts), so a determined caller
 * can still use up a number's sends for the window.
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
const cooldownKey = (phoneRef: string, ipRef: string) => `${PREFIX()}:cooldown:${phoneRef}:${ipRef}`;
/** The newest delivered challenge for a number; only that one is usable. */
const latestKey = (phoneRef: string) => `${PREFIX()}:latest:${phoneRef}`;
const phoneSendsKey = (phoneRef: string) => `${PREFIX()}:sends:phone:${phoneRef}`;
const ipSendsKey = (ipRef: string) => `${PREFIX()}:sends:ip:${ipRef}`;

export type OtpPurpose = "signin" | "stepup" | "change_phone";
export interface OtpBinding { purpose: OtpPurpose; subject?: string; sessionRef?: string }

export interface OtpChallenge extends OtpBinding {
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
    const ttl = await getRedis().ttl(cooldownKey(phoneRef, ipRef));
    return { allowed: false as const, reason: "COOLDOWN" as const, retryAfter: Math.max(1, ttl) };
  };
  // The cooldown is checked first, so pressing "resend" too early costs
  // nothing from the IP budget that others behind the same address share.
  if (cooldown && await getRedis().exists(cooldownKey(phoneRef, ipRef))) return inCooldown();
  const ipSends = await countInWindow(ipSendsKey(ipRef), window);
  if (ipSends.count > config.identityCitizenOtpIpSendLimit) {
    return { allowed: false, reason: "IP_LIMIT", retryAfter: Math.max(1, ipSends.ttl) };
  }
  if (cooldown && !await getRedis().set(
    cooldownKey(phoneRef, ipRef), "1", "EX", config.identityCitizenOtpResendSeconds, "NX",
  )) {
    // Lost a race with another send for the same number.
    await uncount(ipSendsKey(ipRef));
    return inCooldown();
  }
  const phoneSends = await countInWindow(phoneSendsKey(phoneRef), window);
  if (phoneSends.count > config.identityCitizenOtpPhoneSendLimit) {
    // Nothing was sent: give back the IP charge and the cooldown, so a number
    // at its cap neither drains the address's shared budget nor turns the
    // next attempt into a misleading OTP_RESEND_TOO_SOON.
    await uncount(ipSendsKey(ipRef));
    if (cooldown) await getRedis().del(cooldownKey(phoneRef, ipRef));
    return { allowed: false, reason: "PHONE_LIMIT", retryAfter: Math.max(1, phoneSends.ttl) };
  }
  return { allowed: true, reservation: { phoneRef, ipRef, cooldown } };
}

/** A code that never reached the citizen costs them nothing. */
export async function refundSend(reservation: SendReservation): Promise<void> {
  await uncount(phoneSendsKey(reservation.phoneRef));
  await uncount(ipSendsKey(reservation.ipRef));
  if (reservation.cooldown) await getRedis().del(cooldownKey(reservation.phoneRef, reservation.ipRef));
}

/** A new six-digit code for a new challenge. The code itself is never stored. */
export async function createChallenge(
  phoneNumber: string,
  tenant: BoundTenant,
  binding: OtpBinding = { purpose: "signin" },
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
      purpose: binding.purpose,
      ...(binding.subject && { subject: binding.subject }),
      ...(binding.sessionRef && { sessionRef: binding.sessionRef }),
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
  return { challenge: { id, phoneNumber, tenant, ...binding }, code };
}

/**
 * Makes `challenge` the number's only usable code once it has been
 * delivered: the previous challenge, if any, is deleted in the same step.
 */
const REPLACE_LATEST = `local previous = redis.call('GET', KEYS[1])
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  if previous and previous ~= ARGV[1] then redis.call('DEL', ARGV[3] .. previous) end
  return 0`;

export async function replacePreviousChallenge(challenge: OtpChallenge): Promise<void> {
  await getRedis().eval(
    REPLACE_LATEST, 1, latestKey(privateRef("phone", challenge.phoneNumber)),
    challenge.id, config.identityCitizenOtpTtlSeconds, challengeKey(""),
  );
}

export async function deleteChallenge(id: string): Promise<void> {
  await getRedis().del(challengeKey(id));
}

export async function readChallenge(id: string): Promise<OtpChallenge | null> {
  const stored = await getRedis().hgetall(challengeKey(id));
  if (!stored.hash || !stored.phoneNumber || !stored.tenant) return null;
  try {
    if (!["signin", "stepup", "change_phone"].includes(stored.purpose || "signin")) return null;
    return { id, phoneNumber: stored.phoneNumber, tenant: JSON.parse(stored.tenant) as BoundTenant,
      purpose: (stored.purpose || "signin") as OtpPurpose,
      ...(stored.subject && { subject: stored.subject }), ...(stored.sessionRef && { sessionRef: stored.sessionRef }),
    };
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

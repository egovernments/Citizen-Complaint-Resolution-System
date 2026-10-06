import { createHash } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import { LeaseLostError, personLeaseKey, type PersonLease } from "../accounts/person-lease.js";
import { DigitUnavailableError, loginProfile, revokeToken, type DigitLogin } from "../managed-accounts/digit-user-client.js";

export interface AccountRef { tenantId: string; uuid: string }
export interface TokenRecord {
  accessToken: string;
  expiresAt: number;
  mintedAt: number;
  subject: string;
  kind: "staff" | "citizen";
  keyVersion?: number;
}
export const key = (suffix: string) => `${config.cachePrefix}:identity:${suffix}`;
export const accountId = (account: AccountRef) => `${account.tenantId}:${account.uuid}`;
export const tokenKey = (account: AccountRef) => key(`token:${accountId(account)}`);
export const personTokensKey = (subject: string) => key(`person-tokens:${subject}`);
export const tokenHoldersKey = (account: AccountRef) => key(`token-holders:${accountId(account)}`);
export function parseAccountId(id: string): AccountRef {
  const separator = id.lastIndexOf(":");
  if (separator < 1 || separator === id.length - 1) throw new Error("Invalid token account reference");
  return { tenantId: id.slice(0, separator), uuid: id.slice(separator + 1) };
}
export async function readToken(account: AccountRef): Promise<TokenRecord | null> {
  const raw = await getRedis().get(tokenKey(account));
  return raw ? JSON.parse(raw) as TokenRecord : null;
}

/** Queue before the external effect. A crash or failed logout leaves a retry until actual expiry. */
export async function revokeInventoriedToken(account: AccountRef, token: TokenRecord, reason: string): Promise<void> {
  if (token.expiresAt <= Date.now()) return;
  const id = createHash("sha256").update(token.accessToken).digest("hex");
  const retryKey = key(`revoke-retry:${id}`);
  await getRedis().eval(`
    redis.call('hset', KEYS[1], 'tenantId', ARGV[1], 'uuid', ARGV[2], 'accessToken', ARGV[3],
      'expiresAt', ARGV[4], 'subject', ARGV[5], 'reason', ARGV[6], 'attempts', 0)
    redis.call('pexpireat', KEYS[1], ARGV[4])
    redis.call('zadd', KEYS[2], ARGV[7], ARGV[8])
    return 1`, 2, retryKey, key("revoke-retry"), account.tenantId, account.uuid, token.accessToken,
      Math.ceil(token.expiresAt), token.subject, reason, Date.now(), id);
  try {
    await revokeToken(token.accessToken);
    await getRedis().multi().del(retryKey).zrem(key("revoke-retry"), id).exec();
  } catch {
    // The worker owns retries; no token is logged.
  }
}

const RECORD_TOKEN = `
if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('set', KEYS[2], ARGV[2], 'PXAT', ARGV[3])
redis.call('sadd', KEYS[3], ARGV[4])
local desired = tonumber(ARGV[3]) - tonumber(ARGV[5])
if redis.call('pttl', KEYS[3]) < desired then redis.call('pexpireat', KEYS[3], ARGV[3]) end
return 1`;

/** Mint and record callers hold the same person lease as revocation. */
export async function recordToken(lease: PersonLease, account: AccountRef, login: DigitLogin & { keyVersion?: number }, kind: "staff" | "citizen"): Promise<void> {
  const token: TokenRecord = { accessToken: login.accessToken, expiresAt: login.expiresAt,
    mintedAt: Date.now(), subject: lease.subject, kind, ...(login.keyVersion && { keyVersion: login.keyVersion }) };
  if (!login.accessToken || !Number.isFinite(login.expiresAt) || login.expiresAt <= Date.now()) {
    throw new DigitUnavailableError("DIGIT login returned an expired token");
  }
  try {
    await lease.assertHeld();
    const written = await getRedis().eval(RECORD_TOKEN, 3, personLeaseKey(lease.subject), tokenKey(account),
      personTokensKey(lease.subject), lease.token, JSON.stringify(token), Math.ceil(login.expiresAt), accountId(account), Date.now());
    if (written !== 1) throw new LeaseLostError();
  } catch (error) {
    // Even a lease lost between mint and record must not leak the minted token.
    // If Redis itself is unavailable, still attempt logout directly.
    try { await revokeInventoriedToken(account, token, "LEASE_LOST"); }
    catch { await revokeToken(login.accessToken).catch(() => undefined); }
    throw error;
  }
}

/**
 * egov-user's token details endpoint, reached on the same direct internal path
 * as logout (DIGIT_USER_LOGOUT_URL). Through Kong, `/_details` returns 401 for
 * valid tokens (8c gate 2), which made every cached token look revoked.
 */
export function tokenDetailsUrl(): string {
  const direct = config.digitUserLogoutUrl.trim();
  if (direct && /\/_logout\/?$/.test(direct)) return direct.replace(/\/_logout\/?$/, "/_details");
  return `${config.digitUserServiceUrl.replace(/\/$/, "")}/_details`;
}

/** egov-user's token details endpoint validates the token and returns its current profile. */
export async function cachedToken(lease: PersonLease, account: AccountRef): Promise<DigitLogin | null> {
  await lease.assertHeld();
  const token = await readToken(account);
  if (!token || token.subject !== lease.subject || token.expiresAt <= Date.now() + 60_000) return null;
  const url = new URL(tokenDetailsUrl());
  url.searchParams.set("access_token", token.accessToken);
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: "{}", signal: AbortSignal.timeout(config.digitTimeoutMs) });
  } catch { throw new DigitUnavailableError("DIGIT token validation failed"); }
  if ([400, 401, 403, 404].includes(response.status)) {
    await response.body?.cancel();
    await forgetToken(lease, account, token.accessToken);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DigitUnavailableError(`DIGIT token validation returned ${response.status}`);
  }
  const user = await response.json() as Record<string, unknown>;
  await lease.assertHeld();
  if (user.uuid !== account.uuid || user.tenantId !== account.tenantId || user.active === false) {
    await revokeInventoriedToken(account, token, "TOKEN_INVALID");
    await forgetToken(lease, account, token.accessToken);
    return null;
  }
  return { accessToken: token.accessToken, expiresAt: token.expiresAt, user: loginProfile(user) };
}

/** Never erase a replacement token, even if a timed-out effect finishes late. */
export async function forgetToken(lease: PersonLease, account: AccountRef, accessToken: string): Promise<void> {
  const result = await getRedis().eval(`
    if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end
    local raw = redis.call('get', KEYS[2])
    if raw and cjson.decode(raw).accessToken ~= ARGV[2] then return 0 end
    redis.call('del', KEYS[2], KEYS[4])
    redis.call('srem', KEYS[3], ARGV[3])
    return 1`, 4, personLeaseKey(lease.subject), tokenKey(account), personTokensKey(lease.subject), tokenHoldersKey(account), lease.token, accessToken, accountId(account));
  if (result === -1) throw new LeaseLostError();
}

export async function drainTokenRetries(limit = 100): Promise<void> {
  const redis = getRedis();
  const ids = await redis.zrangebyscore(key("revoke-retry"), "-inf", Date.now(), "LIMIT", 0, limit);
  for (const id of ids) {
    const retryKey = key(`revoke-retry:${id}`);
    const item = await redis.hgetall(retryKey);
    if (!item.accessToken || Number(item.expiresAt) <= Date.now()) {
      await redis.multi().del(retryKey).zrem(key("revoke-retry"), id).exec();
      continue;
    }
    try {
      await revokeToken(item.accessToken);
      await redis.multi().del(retryKey).zrem(key("revoke-retry"), id).exec();
    } catch {
      await redis.eval(`
        if redis.call('exists', KEYS[1]) == 0 then redis.call('zrem', KEYS[2], ARGV[1]); return 0 end
        local attempts = redis.call('hincrby', KEYS[1], 'attempts', 1)
        redis.call('zadd', KEYS[2], tonumber(ARGV[2]) + math.min(60000, 1000 * 2 ^ math.min(attempts, 6)), ARGV[1])
        return 1`, 2, retryKey, key("revoke-retry"), id, Date.now());
    }
  }
}

/** Add a live browser session as a holder without extending the token lifetime. */
export async function holdToken(lease: PersonLease, account: AccountRef, sessionId: string): Promise<void> {
  const { privateRef } = await import("../citizen-otp/otp-store.js");
  const result = await getRedis().eval(`
    if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end
    local session = redis.call('get', KEYS[2])
    local raw = redis.call('get', KEYS[3])
    if not session or not raw then return 0 end
    local record = cjson.decode(session)
    if record.claims.sub ~= ARGV[3] or tonumber(record.revocationGeneration or 0) ~= tonumber(redis.call('get', KEYS[5]) or '0') then return 0 end
    local token = cjson.decode(raw)
    if token.subject ~= ARGV[3] then return 0 end
    redis.call('sadd', KEYS[4], ARGV[2])
    redis.call('pexpireat', KEYS[4], token.expiresAt)
    return 1`, 5, personLeaseKey(lease.subject), key(`session:${sessionId}`), tokenKey(account), tokenHoldersKey(account),
      key(`revgen:${lease.subject}`), lease.token, privateRef("session", sessionId), lease.subject);
  if (result === -1) throw new LeaseLostError();
  if (result !== 1) {
    const { SessionRevokedError } = await import("../sessions/session-store.js");
    throw new SessionRevokedError();
  }
}

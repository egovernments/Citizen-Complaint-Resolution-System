import { randomUUID } from "node:crypto";
import { getRedis } from "../../infrastructure/redis.js";
import { currentPersonLease, LeaseBusyError, LeaseLostError, personLeaseKey, withPersonLease, type PersonLease } from "../accounts/person-lease.js";
import { privateRef } from "../citizen-otp/otp-store.js";
import { deleteIdentitySession, getIdentitySession, getSelectedIdentityContext, listPersonSessions, personSessionsKey, revocationGenerationKey, sessionKey } from "../sessions/session-store.js";
import type { IdentitySession } from "../sessions/types.js";
import { accountId, forgetToken, key, parseAccountId, personTokensKey, readToken, revokeInventoriedToken, tokenHoldersKey, type AccountRef, type TokenRecord } from "./inventory.js";
import { getRevocationUser, listRevocationUsers, listOrganizationMembers, endKeycloakSession, keycloakSessionStarts } from "./keycloak.js";
import { accountEntries, type AccountEntry } from "../sync/state.js";
import { bindingsFor } from "../bindings/store.js";
import { findLiveStaffToken } from "../accounts/credential-service.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";
export { cachedToken, recordToken, holdToken, drainTokenRetries } from "./inventory.js";

export type RevocationReason =
  | "KEYCLOAK_DISABLED" | "KEYCLOAK_DELETED" | "LOGOUT_ALL" | "CREDENTIAL_CHANGED"
  | "MEMBERSHIP_REMOVED" | "BINDING_REMOVED" | "DIGIT_INACTIVE" | "ROLE_CHANGED"
  | "ORGANIZATION_DISABLED" | "TENANT_INACTIVE" | "DIGIT_ACCOUNT_MISSING" | "LOGOUT";

interface JobOptions {
  account?: AccountRef; tenantId?: string; keepSessionId?: string; eventId?: string; fallback?: boolean;
  /**
   * CREDENTIAL_CHANGED only: the Keycloak event's `time` (ms epoch). Sessions whose Keycloak
   * authentication is at or after it survive (§10).
   */
  changedAt?: number;
  /** CREDENTIAL_CHANGED only: the Keycloak session that made the change (`code_id`); it survives. */
  changeKcSessionId?: string;
}
interface SubjectJob { subject: string; reason: RevocationReason; options: JobOptions }

/** The job itself carries only ids; never tokens or credentials. */
export async function enqueueRevocation(subject: string, reason: RevocationReason, options: JobOptions = {}): Promise<string> {
  const event = { ...options, eventId: options.eventId ?? randomUUID() };
  const id = `${subject}|${reason}|${Buffer.from(JSON.stringify(event)).toString("base64url")}`;
  await getRedis().zadd(key("revoke-jobs"), "NX", Date.now(), id);
  return id;
}
function decodeJob(id: string): SubjectJob {
  const [subject, reason, encoded] = id.split("|");
  return { subject, reason: reason as RevocationReason, options: JSON.parse(Buffer.from(encoded, "base64url").toString()) as JobOptions };
}

async function sessionsRaw(subject: string): Promise<Array<{ sessionId: string; session: IdentitySession }>> {
  const result = [];
  for (const sessionId of await getRedis().smembers(personSessionsKey(subject))) {
    const raw = await getRedis().get(sessionKey(sessionId));
    if (raw) {
      const session = JSON.parse(raw) as IdentitySession;
      if (session.claims.sub === subject) result.push({ sessionId, session });
    }
  }
  return result;
}

/** Increment and rewrite the exemptions under one fence, so it can never revive a removed session. */
async function bumpGeneration(lease: PersonLease, keepSessionIds: string[] = []): Promise<void> {
  const result = await getRedis().eval(`
    if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end
    local previous = tonumber(redis.call('get', KEYS[2]) or '0')
    local generation = redis.call('incr', KEYS[2])
    for i = 3, #KEYS do
      local raw = redis.call('get', KEYS[i])
      if raw then
        local session = cjson.decode(raw)
        if session.claims.sub == ARGV[2] and tonumber(session.revocationGeneration or 0) == previous then
          session.revocationGeneration = generation
          redis.call('set', KEYS[i], cjson.encode(session), 'XX', 'KEEPTTL')
        end
      end
    end
    return generation`, 2 + keepSessionIds.length, personLeaseKey(lease.subject), revocationGenerationKey(lease.subject),
      ...keepSessionIds.map(sessionKey), lease.token, lease.subject);
  if (result === -1) throw new LeaseLostError();
}

async function heldOnlyBy(account: AccountRef, sessionIds: string[]): Promise<boolean> {
  const holders = await getRedis().smembers(tokenHoldersKey(account));
  const allowed = new Set(sessionIds.map(id => privateRef("session", id)));
  return holders.length > 0 && holders.every(holder => allowed.has(holder));
}

/** Sessions a revocation leaves alone: the B3 initiator, and those a credential change spares. */
interface Survivors { keepSessionId?: string; spared: string[] }

/**
 * Sessions that proved a credential at or after the change: Keycloak's `auth_time` (stored as
 * `authTime`), else the Keycloak session's `start` from the Admin API, both on the event's clock.
 * The session that made the change also survives. Neither time known → older, so revoked.
 */
async function spareAfterChange(subject: string, sessions: Array<{ sessionId: string; session: IdentitySession }>,
  changedAt: number, changeKcSessionId?: string): Promise<string[]> {
  let starts: Map<string, number> | undefined;
  const spared = [];
  for (const { sessionId, session } of sessions) {
    let authTime = session.authTime;
    if (authTime === undefined && session.kcSessionId) {
      starts ??= await keycloakSessionStarts(subject).catch(() => new Map<string, number>());
      authTime = starts.get(session.kcSessionId);
    }
    if ((changeKcSessionId && session.kcSessionId === changeKcSessionId) || (authTime !== undefined && authTime >= changedAt))
      spared.push(sessionId);
  }
  return spared;
}

async function revokeOne(lease: PersonLease, account: AccountRef, entry: AccountEntry | undefined, reason: RevocationReason, survivors: Survivors, fallback = true): Promise<void> {
  const token = await readToken(account);
  if (token && token.subject !== lease.subject) return;
  const { keepSessionId, spared } = survivors;
  // Keep a token only if surviving sessions (the B3 initiator and those the change spares) are
  // its sole holders. One an ended session also holds may sit on the device the person is
  // locking out, so it is revoked; a surviving holder gets a fresh token at its next _select.
  const kept = [...(keepSessionId ? [keepSessionId] : []), ...spared];
  if (kept.length && await heldOnlyBy(account, kept)) return;
  if (token) {
    await lease.assertHeld();
    await revokeInventoriedToken(account, token, reason);
    await forgetToken(lease, account, token.accessToken);
    return;
  }
  if (!fallback || entry?.kind !== "staff" || !entry.userName) return;
  await lease.assertHeld();
  const live = await findLiveStaffToken({ tenantId: account.tenantId, uuid: account.uuid, userName: entry.userName, keyVersion: entry.credential?.keyVersion });
  if (!live) return;
  const recovered: TokenRecord = { accessToken: live.accessToken, expiresAt: live.expiresAt,
    subject: lease.subject, mintedAt: Date.now(), kind: "staff" };
  // Recovery can return after losing the lease. Always revoke the token it discovered.
  await revokeInventoriedToken(account, recovered, reason);
  await lease.assertHeld();
}

async function perform(job: SubjectJob): Promise<void> {
  await withPersonLease(job.subject, async lease => {
    const { account, tenantId } = job.options;
    const keeper = job.options.keepSessionId ? await getIdentitySession(job.options.keepSessionId) : null;
    const keepSessionId = keeper?.claims.sub === job.subject ? job.options.keepSessionId : undefined;
    const scopedTenant = account?.tenantId ?? tenantId;
    const sessions = await sessionsRaw(job.subject);
    const { changedAt, changeKcSessionId } = job.options;
    const spared = job.reason === "CREDENTIAL_CHANGED" && typeof changedAt === "number" && Number.isFinite(changedAt)
      ? await spareAfterChange(job.subject, sessions.filter(({ sessionId }) => sessionId !== keepSessionId), changedAt, changeKcSessionId)
      : [];
    const survivors: Survivors = { keepSessionId, spared };
    const endAllSessions = !scopedTenant || job.reason === "BINDING_REMOVED";
    if (endAllSessions) await bumpGeneration(lease, [...(keepSessionId ? [keepSessionId] : []), ...spared]);
    for (const { sessionId, session } of sessions) {
      if (sessionId === keepSessionId || spared.includes(sessionId)) continue;
      if (!endAllSessions && scopedTenant) {
        const context = await getSelectedIdentityContext(sessionId);
        if (session.boundTenant?.tenantId !== scopedTenant && context?.tenantId !== scopedTenant) continue;
      }
      await lease.assertHeld();
      await deleteIdentitySession(sessionId);
    }
    const matches = (ref: AccountRef) => (!account || accountId(account) === accountId(ref)) && (!scopedTenant || ref.tenantId === scopedTenant);
    const inventoried = new Set<string>();
    for (const id of await getRedis().smembers(personTokensKey(job.subject))) {
      const ref = parseAccountId(id);
      if (!matches(ref)) continue;
      if (await readToken(ref)) inventoried.add(id);
      await revokeOne(lease, ref, undefined, job.reason, survivors);
    }
    // An unavailable Keycloak lookup must not delay tokens already in Redis.
    const entries = job.reason === "KEYCLOAK_DELETED" ? [] : accountEntries(await getRevocationUser(job.subject) ?? {});
    for (const entry of entries) {
      if (!matches(entry) || inventoried.has(accountId(entry))) continue;
      await revokeOne(lease, entry, entry, job.reason, survivors, job.options.fallback);
    }
  });
}
async function runJob(id: string): Promise<void> {
  await perform(decodeJob(id));
  await getRedis().zrem(key("revoke-jobs"), id);
}
export async function revokePerson(subject: string, reason: RevocationReason, options: { keepSessionId?: string; fallback?: boolean; changedAt?: number; changeKcSessionId?: string } = {}): Promise<void> {
  const id = await enqueueRevocation(subject, reason, options);
  await runJob(id);
}
export async function revokeAccount(subject: string, account: AccountRef, reason: RevocationReason, options: { fallback?: boolean } = {}): Promise<void> {
  const id = await enqueueRevocation(subject, reason, { ...options, account });
  await runJob(id);
}

export async function drainRevocationJobs(limit = 100): Promise<void> {
  for (const id of await getRedis().zrangebyscore(key("revoke-jobs"), "-inf", Date.now(), "LIMIT", 0, limit)) {
    try { await runJob(id); }
    catch { await getRedis().zadd(key("revoke-jobs"), Date.now() + 5_000, id); }
  }
}

/** All jobs are recorded before taking a person lease; repeats repair interrupted fan-out. */
export async function revokeTenantMembers(tenantId: string, reason: "ORGANIZATION_DISABLED" | "TENANT_INACTIVE"): Promise<void> {
  if (currentPersonLease()) throw new Error("Tenant fan-out must run outside the person lease");
  const organization = await readOrganizationByTenant(tenantId);
  const members = organization ? await listOrganizationMembers(organization.id) : [];
  const bindings = await bindingsFor(tenantId);
  const subjects = new Set([...members.map(member => member.id), ...bindings.map(binding => binding.subject)]);
  for (const subject of subjects) await enqueueRevocation(subject, reason, { tenantId, eventId: `tenant:${tenantId}` });
  await drainRevocationJobs();
}

interface RetainedSessionTokens {
  sessionRef: string;
  accounts: Set<string>;
  accessTokens: Set<string>;
}

/** Snapshot before external session termination can trigger Keycloak logout events. */
async function retainedSessionTokens(lease: PersonLease, sessionId: string): Promise<RetainedSessionTokens | undefined> {
  const session = await getIdentitySession(sessionId);
  if (session?.claims.sub !== lease.subject) return undefined;
  const retained: RetainedSessionTokens = { sessionRef: privateRef("session", sessionId), accounts: new Set(), accessTokens: new Set() };
  for (const id of await getRedis().smembers(personTokensKey(lease.subject))) {
    await lease.assertHeld();
    const account = parseAccountId(id);
    if (!await getRedis().sismember(tokenHoldersKey(account), retained.sessionRef)) continue;
    const token = await readToken(account);
    if (token?.subject !== lease.subject) continue;
    retained.accounts.add(id);
    retained.accessTokens.add(token.accessToken);
  }
  return retained;
}

/** Drop only the holders being logged out. Shared DIGIT tokens survive while another live session holds them. */
async function releaseSessionTokens(lease: PersonLease, ended: string[], retained?: RetainedSessionTokens): Promise<void> {
  const liveRefs = new Set((await listPersonSessions(lease.subject)).map(item => privateRef("session", item.sessionId)));
  if (retained) liveRefs.add(retained.sessionRef);
  for (const id of await getRedis().smembers(personTokensKey(lease.subject))) {
    const account = parseAccountId(id);
    await lease.assertHeld();
    const holders = await getRedis().smembers(tokenHoldersKey(account));
    const stale = holders.filter(ref => !liveRefs.has(ref));
    const remove = [...new Set([...stale, ...ended.map(sid => privateRef("session", sid))])];
    if (remove.length) await getRedis().srem(tokenHoldersKey(account), ...remove);
    if (retained?.accounts.has(id) || await getRedis().scard(tokenHoldersKey(account))) continue;
    const token = await readToken(account);
    if (token?.subject === lease.subject) {
      // A duplicate inventory entry may name the same shared token. Forget
      // its ended claims without invalidating the retained account or queuing logout.
      if (!retained?.accessTokens.has(token.accessToken)) await revokeInventoriedToken(account, token, "LOGOUT");
      await forgetToken(lease, account, token.accessToken);
    }
  }
}

const KC_LOGOUT_RETRY = "kc-logout-retry";
const kcLogoutEntryKey = (kcSessionId: string) => key(`${KC_LOGOUT_RETRY}:${kcSessionId}`);
/** How long a logout waits on Keycloak before leaving the end to the retry worker. */
export const KEYCLOAK_LOGOUT_WAIT_MS = 2_000;

/**
 * Durable before the BFF session goes: a crash or Keycloak outage after the
 * delete still ends the Keycloak session later. The entry lives as long as
 * the BFF session would have, which bounds the Keycloak session it mirrors.
 */
async function queueKeycloakLogout(kcSessionId: string, expiresAt: number): Promise<void> {
  const entry = kcLogoutEntryKey(kcSessionId);
  await getRedis().multi().hset(entry, "attempts", 0).pexpireat(entry, Math.max(Date.now() + 60_000, Math.ceil(expiresAt)))
    .zadd(key(KC_LOGOUT_RETRY), Date.now() + KEYCLOAK_LOGOUT_WAIT_MS, kcSessionId).exec();
}

async function attemptKeycloakLogout(kcSessionId: string): Promise<boolean> {
  const entry = kcLogoutEntryKey(kcSessionId);
  try {
    await endKeycloakSession(kcSessionId);
    await getRedis().multi().del(entry).zrem(key(KC_LOGOUT_RETRY), kcSessionId).exec();
    return true;
  } catch {
    await getRedis().eval(`
      if redis.call('exists', KEYS[1]) == 0 then redis.call('zrem', KEYS[2], ARGV[1]); return 0 end
      local attempts = redis.call('hincrby', KEYS[1], 'attempts', 1)
      redis.call('zadd', KEYS[2], tonumber(ARGV[2]) + math.min(60000, 1000 * 2 ^ math.min(attempts, 6)), ARGV[1])
      return 1`, 2, entry, key(KC_LOGOUT_RETRY), kcSessionId, Date.now());
    return false;
  }
}

/** Best effort: one bounded attempt each. Anything unfinished stays queued for the worker. */
async function endKeycloakSessionsBestEffort(kcSessionIds: string[]): Promise<void> {
  await Promise.all(kcSessionIds.map(id => Promise.race([
    attemptKeycloakLogout(id).catch(() => false),
    new Promise<boolean>(resolve => setTimeout(resolve, KEYCLOAK_LOGOUT_WAIT_MS, false).unref()),
  ])));
}

export async function drainKeycloakLogoutRetries(limit = 100): Promise<void> {
  for (const id of await getRedis().zrangebyscore(key(KC_LOGOUT_RETRY), "-inf", Date.now(), "LIMIT", 0, limit)) {
    if (!await getRedis().exists(kcLogoutEntryKey(id))) { await getRedis().zrem(key(KC_LOGOUT_RETRY), id); continue; }
    await attemptKeycloakLogout(id);
  }
}

/**
 * Ends the person's sessions matching `ends`, then releases their token
 * claims. With `keycloak`, each ended session's Keycloak session (unless a
 * session that stays still uses it) is queued for ending and returned; the
 * BFF session is deleted regardless, and the caller ends Keycloak's side
 * best-effort once it is outside the lease.
 */
async function endSessions(lease: PersonLease, ends: (item: { sessionId: string; session: IdentitySession }) => boolean,
  options: { keycloak: boolean; bump?: boolean; retained?: RetainedSessionTokens }): Promise<string[]> {
  const sessions = await sessionsRaw(lease.subject);
  const ended = sessions.filter(ends);
  const retainedKcSessions = new Set(sessions.filter(item => !ended.includes(item)).map(item => item.session.kcSessionId));
  const kcSessions = new Set<string>();
  for (const { sessionId, session } of ended) {
    await lease.assertHeld();
    if (options.keycloak && session.kcSessionId && !retainedKcSessions.has(session.kcSessionId)) {
      await queueKeycloakLogout(session.kcSessionId, session.sessionExpiresAt);
      kcSessions.add(session.kcSessionId);
    }
    await deleteIdentitySession(sessionId);
  }
  if (options.bump) await bumpGeneration(lease);
  await releaseSessionTokens(lease, ended.map(item => item.sessionId), options.retained);
  return [...kcSessions];
}

export async function logoutSessions(subject: string, scope: "current" | "others" | "all", currentSessionId: string): Promise<void> {
  const kcSessions = await withPersonLease(subject, async lease => {
    const retained = scope === "others" ? await retainedSessionTokens(lease, currentSessionId) : undefined;
    return endSessions(lease, item => scope === "all" || (scope === "current" ? item.sessionId === currentSessionId : item.sessionId !== currentSessionId),
      { keycloak: true, bump: scope === "all", retained });
  });
  await endKeycloakSessionsBestEffort(kcSessions);
}
export async function endPhoneSessions(subject: string, oldPhoneRef: string, keepSessionId?: string): Promise<void> {
  const kcSessions = await withPersonLease(subject, lease => endSessions(lease,
    item => item.sessionId !== keepSessionId && item.session.phoneRef === oldPhoneRef, { keycloak: true }));
  await endKeycloakSessionsBestEffort(kcSessions);
}

/**
 * Event already ended Keycloak's session; do not call back to Keycloak again.
 * Without a subject this is the last-resort realm scan: people are matched
 * with a lock-free read first, so only those holding the session take a
 * lease, and one busy person cannot stall the effect: their matching BFF
 * sessions are deleted directly (a delete never revives anything), and their
 * token claims are pruned as stale at their next logout.
 */
const SCAN_LEASE_WAIT_MS = 2_000;
export async function endKeycloakSessions(kcSessionId: string, clientId?: string, subject?: string): Promise<void> {
  const matches = ({ session }: { session: IdentitySession }) =>
    session.kcSessionId === kcSessionId && (!clientId || session.oidcClientId === clientId);
  const end = (sub: string, waitMs?: number) => withPersonLease(sub, async lease => { await endSessions(lease, matches, { keycloak: false }); }, { waitMs });
  if (subject) return end(subject);
  for (const user of await listRevocationUsers()) {
    const held = (await sessionsRaw(user.id)).filter(matches);
    if (!held.length) continue;
    try { await end(user.id, SCAN_LEASE_WAIT_MS); }
    catch (error) {
      if (!(error instanceof LeaseBusyError)) throw error;
      for (const { sessionId } of held) await deleteIdentitySession(sessionId);
    }
  }
}

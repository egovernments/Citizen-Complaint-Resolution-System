import { createHash, randomUUID } from "node:crypto";
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

/** `eventId` is `<time>:<id>` for a Keycloak event; `eventType` names it (user event type, or admin operation and resource). */
interface JobOptions {
  account?: AccountRef; tenantId?: string; keepSessionId?: string; eventId?: string; eventType?: string; fallback?: boolean;
  /**
   * CREDENTIAL_CHANGED only: the Keycloak event's `time` (ms epoch). Sessions whose Keycloak
   * authentication is at or after it survive (§10).
   */
  changedAt?: number;
  /** CREDENTIAL_CHANGED only: the Keycloak session that made the change (`code_id`); it survives. */
  changeKcSessionId?: string;
}
interface SubjectJob { subject: string; reason: RevocationReason; options: JobOptions }

/**
 * Why a revocation left a session alone (§12 revocation log). A credential change also spares
 * the session that made it (CHANGING_SESSION) and sessions Keycloak authenticated at or after
 * it (AUTHENTICATED_AFTER_CHANGE).
 */
export type KeptSessionReason = "B3_INITIATOR" | "INITIATOR" | "OTHER_TENANT" | "NOT_TARGETED"
  | "CHANGING_SESSION" | "AUTHENTICATED_AFTER_CHANGE";
/** Why a DIGIT token was revoked or kept (§12 revocation log). */
export type TokenDecisionReason =
  | "IN_SCOPE" | "SHARED_WITH_ENDED_SESSION" | "RECOVERED" | "NO_LIVE_HOLDER"
  | "KEPT_SESSIONS_ONLY_HOLDERS" | "STILL_HELD" | "RETAINED_BY_CURRENT" | "OTHER_PERSON";
interface TokenDecision { account: string; tokenRef: string; outcome: "revoked" | "kept"; why: TokenDecisionReason }
interface RevocationReport { ended: string[]; kept: Array<{ ref: string; reason: KeptSessionReason }>; tokens: TokenDecision[] }
const newReport = (): RevocationReport => ({ ended: [], kept: [], tokens: [] });
const sessionRef = (sessionId: string) => privateRef("session", sessionId);
const tokenDecision = (account: AccountRef, accessToken: string, outcome: TokenDecision["outcome"], why: TokenDecisionReason): TokenDecision =>
  ({ account: accountId(account), tokenRef: createHash("sha256").update(accessToken).digest("hex").slice(0, 12), outcome, why });
function triggerOf(eventId?: string, eventType?: string): Record<string, string> {
  const time = /^(\d+):/.exec(eventId ?? "")?.[1];
  return { ...(eventId && { eventId }), ...(eventType && { eventType }), ...(time && { eventTime: new Date(Number(time)).toISOString() }) };
}

/**
 * One line per revocation run (#2285). Session and token references are keyed
 * or truncated hashes; no token, cookie or session id is ever written.
 */
function logRevocation(event: "identity.revocation.job" | "identity.revocation.logout", fields: Record<string, unknown>,
  report: RevocationReport, started: number, failure?: { outcome: "retry" | "failed"; error: unknown }): void {
  const revoked = report.tokens.filter(token => token.outcome === "revoked").length;
  const line = {
    event, outcome: failure?.outcome ?? "ok", ...fields,
    sessionsEnded: report.ended.length, sessionsKept: report.kept.length,
    tokensRevoked: revoked, tokensKept: report.tokens.length - revoked,
    sessions: { ended: report.ended, kept: report.kept }, tokens: report.tokens,
    durationMs: Date.now() - started,
    ...(failure && { error: (failure.error as Error)?.message ?? String(failure.error) }),
  };
  if (failure) console.warn(JSON.stringify(line));
  else console.info(JSON.stringify(line));
}

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
 * Each spared session is returned with why it was spared (§12 revocation log).
 */
async function spareAfterChange(subject: string, sessions: Array<{ sessionId: string; session: IdentitySession }>,
  changedAt: number, changeKcSessionId?: string): Promise<Map<string, KeptSessionReason>> {
  let starts: Map<string, number> | undefined;
  const spared = new Map<string, KeptSessionReason>();
  for (const { sessionId, session } of sessions) {
    let authTime = session.authTime;
    if (authTime === undefined && session.kcSessionId) {
      starts ??= await keycloakSessionStarts(subject).catch(() => new Map<string, number>());
      authTime = starts.get(session.kcSessionId);
    }
    if (changeKcSessionId && session.kcSessionId === changeKcSessionId) spared.set(sessionId, "CHANGING_SESSION");
    else if (authTime !== undefined && authTime >= changedAt) spared.set(sessionId, "AUTHENTICATED_AFTER_CHANGE");
  }
  return spared;
}

async function revokeOne(lease: PersonLease, account: AccountRef, entry: AccountEntry | undefined, reason: RevocationReason, survivors: Survivors, fallback = true): Promise<TokenDecision | undefined> {
  const token = await readToken(account);
  if (token && token.subject !== lease.subject) return tokenDecision(account, token.accessToken, "kept", "OTHER_PERSON");
  const { keepSessionId, spared } = survivors;
  // Keep a token only if surviving sessions (the B3 initiator and those the change spares) are
  // its sole holders. One an ended session also holds may sit on the device the person is
  // locking out, so it is revoked; a surviving holder gets a fresh token at its next _select.
  const kept = [...(keepSessionId ? [keepSessionId] : []), ...spared];
  if (kept.length && await heldOnlyBy(account, kept))
    return token ? tokenDecision(account, token.accessToken, "kept", "KEPT_SESSIONS_ONLY_HOLDERS") : undefined;
  if (token) {
    const shared = keepSessionId && await getRedis().sismember(tokenHoldersKey(account), sessionRef(keepSessionId));
    await lease.assertHeld();
    await revokeInventoriedToken(account, token, reason);
    await forgetToken(lease, account, token.accessToken);
    return tokenDecision(account, token.accessToken, "revoked", shared ? "SHARED_WITH_ENDED_SESSION" : "IN_SCOPE");
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
  return tokenDecision(account, live.accessToken, "revoked", "RECOVERED");
}

async function perform(job: SubjectJob, report: RevocationReport): Promise<void> {
  await withPersonLease(job.subject, async lease => {
    const { account, tenantId } = job.options;
    const keeper = job.options.keepSessionId ? await getIdentitySession(job.options.keepSessionId) : null;
    const keepSessionId = keeper?.claims.sub === job.subject ? job.options.keepSessionId : undefined;
    const scopedTenant = account?.tenantId ?? tenantId;
    const sessions = await sessionsRaw(job.subject);
    const { changedAt, changeKcSessionId } = job.options;
    const sparedReasons = job.reason === "CREDENTIAL_CHANGED" && typeof changedAt === "number" && Number.isFinite(changedAt)
      ? await spareAfterChange(job.subject, sessions.filter(({ sessionId }) => sessionId !== keepSessionId), changedAt, changeKcSessionId)
      : new Map<string, KeptSessionReason>();
    const spared = [...sparedReasons.keys()];
    const survivors: Survivors = { keepSessionId, spared };
    const endAllSessions = !scopedTenant || job.reason === "BINDING_REMOVED";
    if (endAllSessions) await bumpGeneration(lease, [...(keepSessionId ? [keepSessionId] : []), ...spared]);
    for (const { sessionId, session } of sessions) {
      if (sessionId === keepSessionId) { report.kept.push({ ref: sessionRef(sessionId), reason: "B3_INITIATOR" }); continue; }
      const sparedReason = sparedReasons.get(sessionId);
      if (sparedReason) { report.kept.push({ ref: sessionRef(sessionId), reason: sparedReason }); continue; }
      if (!endAllSessions && scopedTenant) {
        const context = await getSelectedIdentityContext(sessionId);
        if (session.boundTenant?.tenantId !== scopedTenant && context?.tenantId !== scopedTenant) {
          report.kept.push({ ref: sessionRef(sessionId), reason: "OTHER_TENANT" }); continue;
        }
      }
      await lease.assertHeld();
      await deleteIdentitySession(sessionId);
      report.ended.push(sessionRef(sessionId));
    }
    const matches = (ref: AccountRef) => (!account || accountId(account) === accountId(ref)) && (!scopedTenant || ref.tenantId === scopedTenant);
    const inventoried = new Set<string>();
    for (const id of await getRedis().smembers(personTokensKey(job.subject))) {
      const ref = parseAccountId(id);
      if (!matches(ref)) continue;
      if (await readToken(ref)) inventoried.add(id);
      const decision = await revokeOne(lease, ref, undefined, job.reason, survivors);
      if (decision) report.tokens.push(decision);
    }
    // An unavailable Keycloak lookup must not delay tokens already in Redis.
    const entries = job.reason === "KEYCLOAK_DELETED" ? [] : accountEntries(await getRevocationUser(job.subject) ?? {});
    for (const entry of entries) {
      if (!matches(entry) || inventoried.has(accountId(entry))) continue;
      const decision = await revokeOne(lease, entry, entry, job.reason, survivors, job.options.fallback);
      if (decision) report.tokens.push(decision);
    }
  });
}
async function runJob(id: string): Promise<void> {
  const job = decodeJob(id);
  const report = newReport();
  const started = Date.now();
  const { account, eventId, eventType } = job.options;
  const tenantId = account?.tenantId ?? job.options.tenantId;
  const fields = { reason: job.reason, subject: job.subject, ...(tenantId && { tenantId }),
    ...(account && { account: accountId(account) }), trigger: triggerOf(eventId, eventType) };
  try {
    await perform(job, report);
    await getRedis().zrem(key("revoke-jobs"), id);
  } catch (error) {
    // The job stays queued; the revocation worker runs it again.
    logRevocation("identity.revocation.job", fields, report, started, { outcome: "retry", error });
    throw error;
  }
  logRevocation("identity.revocation.job", fields, report, started);
}
export async function revokePerson(subject: string, reason: RevocationReason, options: { keepSessionId?: string; fallback?: boolean; changedAt?: number; changeKcSessionId?: string } = {}): Promise<void> {
  const id = await enqueueRevocation(subject, reason, options);
  await runJob(id);
}
export async function revokeAccount(subject: string, account: AccountRef, reason: RevocationReason, options: { fallback?: boolean } = {}): Promise<void> {
  const id = await enqueueRevocation(subject, reason, { ...options, account });
  await runJob(id);
}

/**
 * Runs the person's queued revocation jobs under the lease the caller holds (#2286).
 * `_select` calls it before reading the token cache: otherwise it could hand out a
 * cached token that a job already queued for the person (e.g. a credential change)
 * revokes as soon as the worker gets the lease. A failing job stays queued and fails the caller.
 */
export async function runPendingRevocations(lease: PersonLease): Promise<void> {
  const pattern = `${lease.subject.replace(/[*?[\]\\]/g, "\\$&")}|*`;
  const pending: Array<[string, number]> = [];
  let cursor = "0";
  do {
    const [next, items] = await getRedis().zscan(key("revoke-jobs"), cursor, "MATCH", pattern, "COUNT", 100);
    for (let i = 0; i < items.length; i += 2) pending.push([items[i], Number(items[i + 1])]);
    cursor = next;
  } while (cursor !== "0");
  for (const [id] of pending.sort((a, b) => a[1] - b[1])) await runJob(id);
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
async function releaseSessionTokens(lease: PersonLease, ended: string[], retained?: RetainedSessionTokens): Promise<TokenDecision[]> {
  const decisions: TokenDecision[] = [];
  const liveRefs = new Set((await listPersonSessions(lease.subject)).map(item => privateRef("session", item.sessionId)));
  if (retained) liveRefs.add(retained.sessionRef);
  for (const id of await getRedis().smembers(personTokensKey(lease.subject))) {
    const account = parseAccountId(id);
    await lease.assertHeld();
    const holders = await getRedis().smembers(tokenHoldersKey(account));
    const stale = holders.filter(ref => !liveRefs.has(ref));
    const remove = [...new Set([...stale, ...ended.map(sid => privateRef("session", sid))])];
    const released = remove.length ? await getRedis().srem(tokenHoldersKey(account), ...remove) : 0;
    const retainedAccount = retained?.accounts.has(id);
    if (retainedAccount || await getRedis().scard(tokenHoldersKey(account))) {
      const token = released ? await readToken(account) : null;
      if (token?.subject === lease.subject) decisions.push(tokenDecision(account, token.accessToken, "kept", retainedAccount ? "RETAINED_BY_CURRENT" : "STILL_HELD"));
      continue;
    }
    const token = await readToken(account);
    if (token?.subject === lease.subject) {
      // A duplicate inventory entry may name the same shared token. Forget
      // its ended claims without invalidating the retained account or queuing logout.
      const keep = retained?.accessTokens.has(token.accessToken);
      if (!keep) await revokeInventoriedToken(account, token, "LOGOUT");
      await forgetToken(lease, account, token.accessToken);
      decisions.push(tokenDecision(account, token.accessToken, keep ? "kept" : "revoked", keep ? "RETAINED_BY_CURRENT" : "NO_LIVE_HOLDER"));
    }
  }
  return decisions;
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
/** What the `identity.revocation.logout` line says about a run of `endSessions`. */
interface LogoutLog { reason: "LOGOUT" | "PHONE_CHANGED" | "KEYCLOAK_LOGOUT"; scope?: string; initiator?: string; trigger?: { eventId: string; eventType: string } }

async function endSessions(lease: PersonLease, ends: (item: { sessionId: string; session: IdentitySession }) => boolean,
  options: { keycloak: boolean; bump?: boolean; retained?: RetainedSessionTokens; log: LogoutLog }): Promise<string[]> {
  const report = newReport();
  const started = Date.now();
  const { reason, scope, initiator, trigger } = options.log;
  const fields = { reason, subject: lease.subject, ...(scope && { scope }), trigger: triggerOf(trigger?.eventId, trigger?.eventType) };
  try {
    const sessions = await sessionsRaw(lease.subject);
    const ended = sessions.filter(ends);
    for (const { sessionId } of sessions) if (!ended.some(item => item.sessionId === sessionId))
      report.kept.push({ ref: sessionRef(sessionId), reason: sessionId === initiator ? "INITIATOR" : "NOT_TARGETED" });
    const retainedKcSessions = new Set(sessions.filter(item => !ended.includes(item)).map(item => item.session.kcSessionId));
    const kcSessions = new Set<string>();
    for (const { sessionId, session } of ended) {
      await lease.assertHeld();
      if (options.keycloak && session.kcSessionId && !retainedKcSessions.has(session.kcSessionId)) {
        await queueKeycloakLogout(session.kcSessionId, session.sessionExpiresAt);
        kcSessions.add(session.kcSessionId);
      }
      await deleteIdentitySession(sessionId);
      report.ended.push(sessionRef(sessionId));
    }
    if (options.bump) await bumpGeneration(lease);
    report.tokens.push(...await releaseSessionTokens(lease, ended.map(item => item.sessionId), options.retained));
    logRevocation("identity.revocation.logout", fields, report, started);
    return [...kcSessions];
  } catch (error) {
    logRevocation("identity.revocation.logout", fields, report, started, { outcome: "failed", error });
    throw error;
  }
}

export async function logoutSessions(subject: string, scope: "current" | "others" | "all", currentSessionId: string): Promise<void> {
  const kcSessions = await withPersonLease(subject, async lease => {
    const retained = scope === "others" ? await retainedSessionTokens(lease, currentSessionId) : undefined;
    return endSessions(lease, item => scope === "all" || (scope === "current" ? item.sessionId === currentSessionId : item.sessionId !== currentSessionId),
      { keycloak: true, bump: scope === "all", retained, log: { reason: "LOGOUT", scope, initiator: currentSessionId } });
  });
  await endKeycloakSessionsBestEffort(kcSessions);
}
export async function endPhoneSessions(subject: string, oldPhoneRef: string, keepSessionId?: string): Promise<void> {
  const kcSessions = await withPersonLease(subject, lease => endSessions(lease,
    item => item.sessionId !== keepSessionId && item.session.phoneRef === oldPhoneRef,
    { keycloak: true, log: { reason: "PHONE_CHANGED", initiator: keepSessionId } }));
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
export async function endKeycloakSessions(kcSessionId: string, clientId?: string, subject?: string,
  trigger?: { eventId: string; eventType: string }): Promise<void> {
  const matches = ({ session }: { session: IdentitySession }) =>
    session.kcSessionId === kcSessionId && (!clientId || session.oidcClientId === clientId);
  const log: LogoutLog = { reason: "KEYCLOAK_LOGOUT", ...(trigger && { trigger }) };
  const end = (sub: string, waitMs?: number) => withPersonLease(sub, async lease => { await endSessions(lease, matches, { keycloak: false, log }); }, { waitMs });
  if (subject) return end(subject);
  for (const user of await listRevocationUsers()) {
    const held = (await sessionsRaw(user.id)).filter(matches);
    if (!held.length) continue;
    try { await end(user.id, SCAN_LEASE_WAIT_MS); }
    catch (error) {
      if (!(error instanceof LeaseBusyError)) throw error;
      const report = newReport(); const started = Date.now();
      for (const { sessionId } of held) { await deleteIdentitySession(sessionId); report.ended.push(sessionRef(sessionId)); }
      // Token claims are left for the person's next logout to prune (above).
      logRevocation("identity.revocation.logout", { reason: "KEYCLOAK_LOGOUT", subject: user.id, leaseBusy: true,
        trigger: triggerOf(trigger?.eventId, trigger?.eventType) }, report, started);
    }
  }
}

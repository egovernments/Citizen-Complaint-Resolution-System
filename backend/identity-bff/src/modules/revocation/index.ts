import { randomUUID } from "node:crypto";
import { getRedis } from "../../infrastructure/redis.js";
import { currentPersonLease, LeaseLostError, personLeaseKey, withPersonLease, type PersonLease } from "../accounts/person-lease.js";
import { privateRef } from "../citizen-otp/otp-store.js";
import { deleteIdentitySession, getIdentitySession, getSelectedIdentityContext, listPersonSessions, personSessionsKey, revocationGenerationKey, sessionKey } from "../sessions/session-store.js";
import type { IdentitySession } from "../sessions/types.js";
import { accountId, forgetToken, key, parseAccountId, personTokensKey, readToken, revokeInventoriedToken, tokenHoldersKey, type AccountRef, type TokenRecord } from "./inventory.js";
import { accountsFromUser, revocationPorts, type AccountEntry } from "./ports.js";
export { cachedToken, recordToken, holdToken, drainTokenRetries } from "./inventory.js";

export type RevocationReason =
  | "KEYCLOAK_DISABLED" | "KEYCLOAK_DELETED" | "LOGOUT_ALL" | "CREDENTIAL_CHANGED"
  | "MEMBERSHIP_REMOVED" | "BINDING_REMOVED" | "DIGIT_INACTIVE" | "ROLE_CHANGED"
  | "ORGANIZATION_DISABLED" | "TENANT_INACTIVE" | "DIGIT_ACCOUNT_MISSING" | "LOGOUT";

interface JobOptions { account?: AccountRef; tenantId?: string; keepSessionId?: string; eventId?: string }
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

/** Increment and rewrite the exemption under one fence, so it can never revive a removed session. */
async function bumpGeneration(lease: PersonLease, keepSessionId?: string): Promise<void> {
  const result = await getRedis().eval(`
    if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end
    local previous = tonumber(redis.call('get', KEYS[2]) or '0')
    local generation = redis.call('incr', KEYS[2])
    if ARGV[2] ~= '' then
      local raw = redis.call('get', KEYS[3])
      if raw then
        local session = cjson.decode(raw)
        if session.claims.sub == ARGV[3] and tonumber(session.revocationGeneration or 0) == previous then
          session.revocationGeneration = generation
          redis.call('set', KEYS[3], cjson.encode(session), 'XX', 'KEEPTTL')
        end
      end
    end
    return generation`, 3, personLeaseKey(lease.subject), revocationGenerationKey(lease.subject),
      sessionKey(keepSessionId || ""), lease.token, keepSessionId || "", lease.subject);
  if (result === -1) throw new LeaseLostError();
}

async function revokeOne(lease: PersonLease, account: AccountRef, entry: AccountEntry | undefined, reason: RevocationReason, keepSessionId?: string): Promise<void> {
  const token = await readToken(account);
  if (token && token.subject !== lease.subject) return;
  if (keepSessionId && await getRedis().sismember(tokenHoldersKey(account), privateRef("session", keepSessionId))) return;
  if (token) {
    await lease.assertHeld();
    await revokeInventoriedToken(account, token, reason);
    await forgetToken(lease, account, token.accessToken);
    return;
  }
  if (entry?.kind !== "staff" || !entry.userName) return;
  await lease.assertHeld();
  const live = await revocationPorts.findLiveStaffToken({ tenantId: account.tenantId, uuid: account.uuid, userName: entry.userName, keyVersion: entry.credential?.keyVersion });
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
    const endAllSessions = !scopedTenant || job.reason === "BINDING_REMOVED";
    if (endAllSessions) await bumpGeneration(lease, keepSessionId);
    for (const { sessionId, session } of sessions) {
      if (sessionId === keepSessionId) continue;
      if (!endAllSessions && scopedTenant) {
        const context = await getSelectedIdentityContext(sessionId);
        if (session.boundTenant?.tenantId !== scopedTenant && context?.tenantId !== scopedTenant) continue;
      }
      await lease.assertHeld();
      await deleteIdentitySession(sessionId);
    }
    const entries = job.reason === "KEYCLOAK_DELETED" ? [] : accountsFromUser(await revocationPorts.user(job.subject));
    const accounts = new Map<string, AccountRef>();
    for (const id of await getRedis().smembers(personTokensKey(job.subject))) accounts.set(id, parseAccountId(id));
    for (const entry of entries) accounts.set(accountId(entry), entry);
    if (account) accounts.set(accountId(account), account);
    for (const ref of accounts.values()) {
      if (account && accountId(account) !== accountId(ref)) continue;
      if (scopedTenant && ref.tenantId !== scopedTenant) continue;
      await revokeOne(lease, ref, entries.find(entry => accountId(entry) === accountId(ref)), job.reason, keepSessionId);
    }
  });
}
async function runJob(id: string): Promise<void> {
  await perform(decodeJob(id));
  await getRedis().zrem(key("revoke-jobs"), id);
}
export async function revokePerson(subject: string, reason: RevocationReason, options: { keepSessionId?: string } = {}): Promise<void> {
  const id = await enqueueRevocation(subject, reason, options);
  await runJob(id);
}
export async function revokeAccount(subject: string, account: AccountRef, reason: RevocationReason): Promise<void> {
  const id = await enqueueRevocation(subject, reason, { account });
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
  const organization = await revocationPorts.readOrganizationByTenant(tenantId);
  const members = organization ? await revocationPorts.members(organization.id) : [];
  const bindings = await revocationPorts.bindingsFor(tenantId);
  const subjects = new Set([...members.map(member => member.id), ...bindings.map(binding => binding.subject)]);
  for (const subject of subjects) await enqueueRevocation(subject, reason, { tenantId, eventId: `tenant:${tenantId}` });
  await drainRevocationJobs();
}

/** Drop only the holders being logged out. Shared DIGIT tokens survive while another live session holds them. */
async function releaseSessionTokens(lease: PersonLease, ended: string[]): Promise<void> {
  const liveRefs = new Set((await listPersonSessions(lease.subject)).map(item => privateRef("session", item.sessionId)));
  for (const id of await getRedis().smembers(personTokensKey(lease.subject))) {
    const account = parseAccountId(id);
    await lease.assertHeld();
    const holders = await getRedis().smembers(tokenHoldersKey(account));
    const stale = holders.filter(ref => !liveRefs.has(ref));
    const remove = [...new Set([...stale, ...ended.map(sid => privateRef("session", sid))])];
    if (remove.length) await getRedis().srem(tokenHoldersKey(account), ...remove);
    if (await getRedis().scard(tokenHoldersKey(account))) continue;
    const token = await readToken(account);
    if (token?.subject === lease.subject) {
      await revokeInventoriedToken(account, token, "LOGOUT");
      await forgetToken(lease, account, token.accessToken);
    }
  }
}

export async function logoutSessions(subject: string, scope: "current" | "others" | "all", currentSessionId: string): Promise<void> {
  await withPersonLease(subject, async lease => {
    const sessions = await sessionsRaw(subject);
    const ended = sessions.filter(item => scope === "all" || (scope === "current" ? item.sessionId === currentSessionId : item.sessionId !== currentSessionId));
    const retainedKcSessions = new Set(sessions.filter(item => !ended.includes(item)).map(item => item.session.kcSessionId));
    for (const { sessionId, session } of ended) {
      await lease.assertHeld();
      // End at Keycloak first; if it fails the caller can retry the still-indexed session.
      if (session.kcSessionId && !retainedKcSessions.has(session.kcSessionId)) await revocationPorts.endKeycloakSession(session.kcSessionId);
      await deleteIdentitySession(sessionId);
    }
    if (scope === "all") await bumpGeneration(lease);
    await releaseSessionTokens(lease, ended.map(item => item.sessionId));
  });
}
export async function endPhoneSessions(subject: string, oldPhoneRef: string, keepSessionId?: string): Promise<void> {
  await withPersonLease(subject, async lease => {
    const ended: string[] = [];
    const sessions = await sessionsRaw(subject);
    const retainedKcSessions = new Set(sessions.filter(item => item.sessionId === keepSessionId || item.session.phoneRef !== oldPhoneRef).map(item => item.session.kcSessionId));
    for (const { sessionId, session } of sessions) {
      if (sessionId === keepSessionId || session.phoneRef !== oldPhoneRef) continue;
      await lease.assertHeld();
      if (session.kcSessionId && !retainedKcSessions.has(session.kcSessionId)) await revocationPorts.endKeycloakSession(session.kcSessionId);
      await deleteIdentitySession(sessionId);
      ended.push(sessionId);
    }
    await releaseSessionTokens(lease, ended);
  });
}

/** Event already ended Keycloak's session; do not call back to Keycloak again. */
export async function endKeycloakSessions(kcSessionId: string, clientId?: string, subject?: string): Promise<void> {
  const subjects = subject ? [subject] : (await revocationPorts.users()).map(user => user.id);
  for (const sub of subjects) await withPersonLease(sub, async lease => {
    const ended: string[] = [];
    for (const { sessionId, session } of await sessionsRaw(sub)) {
      if (session.kcSessionId !== kcSessionId || (clientId && session.oidcClientId !== clientId)) continue;
      await lease.assertHeld();
      await deleteIdentitySession(sessionId);
      ended.push(sessionId);
    }
    await releaseSessionTokens(lease, ended);
  });
}

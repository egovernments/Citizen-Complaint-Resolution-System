import { config } from "../../infrastructure/config.js";
import { acquireRedisLease, getRedis } from "../../infrastructure/redis.js";
import { withPersonLease, LeaseLostError } from "../accounts/person-lease.js";
import { indexBindingTenants, readBindings } from "../bindings/store.js";
import { revokeAccount, revokePerson, revokeTenantMembers } from "../revocation/index.js";
import { readOrganizationByTenant, listOrganizationTenants } from "../onboarding/organization-reader.js";
import { request, isOrganizationMember, IdentityAdminError } from "../organizations/organization-service.js";
import { digitTenantName, isActiveDigitTenant } from "../access-context/tenant-directory.js";
import { applyMirrorSnapshot, readMirrorSnapshot } from "./mirror.js";
import { propagateIdentifiers } from "./identifiers.js";
import { canonical } from "./state.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";

export interface ReconcileResult {
  acquired: boolean;
  subjects: number;
  mirrored: number;
  revoked: number;
  propagated: number;
  unchanged: number;
  failures: Array<{ subject: string; code: string }>;
  lagSeconds: number | null;
}
export interface ReconcileReadiness {
  status: "ok" | "down" | "disabled";
  intervalSeconds: number;
  lagSeconds: number | null;
}
export const reconcileStatsKey = () => `${config.cachePrefix}:identity:reconcile:stats`;
export const reconcileLeaseKey = () => `${config.cachePrefix}:identity-reconciliation-lease`;
const PAGE_SIZE = 100;
const CONCURRENCY = 4;
let kick: (() => void) | undefined;

export async function getReconcileReadiness(): Promise<ReconcileReadiness> {
  const intervalSeconds = config.identityReconciliationIntervalSeconds;
  if (intervalSeconds <= 0) return { status: "disabled", intervalSeconds, lagSeconds: null };
  try {
    const last = Number(await getRedis().hget(reconcileStatsKey(), "lastCompleteAt"));
    const lagSeconds = last > 0 ? Math.max(0, (Date.now() - last) / 1000) : null;
    return { status: lagSeconds !== null && lagSeconds <= intervalSeconds * 2 ? "ok" : "down",
      intervalSeconds, lagSeconds };
  } catch { return { status: "down", intervalSeconds, lagSeconds: null }; }
}

/** Durable generation; an in-flight pass can complete only its observed request. */
export async function requestReconcileNow(reason: string): Promise<void> {
  await getRedis().eval([
    "redis.call('hincrby', KEYS[1], 'requestGeneration', 1)",
    "redis.call('hset', KEYS[1], 'requestReason', ARGV[1], 'requestedAt', ARGV[2])",
    "return 1",
  ].join("\n"), 1, reconcileStatsKey(), reason, Date.now());
  kick?.();
}

const codeOf = (error: unknown) => {
  if (error instanceof DigitUnavailableError) return "DIGIT_UNAVAILABLE";
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : "IDENTITY_UNAVAILABLE";
};

/**
 * Reconcile never grants membership, restores a binding, or writes DIGIT active.
 * Fingerprints skip only mirror PUTs: access and identifier checks always run.
 * DIGIT transitions use credential fallback; unchanged denial and Keycloak
 * disable/membership checks revoke inventory and sessions only. The event poller
 * owns Keycloak transition fallback. Tenant fan-out runs only when the observed
 * tenant state changes, outside person leases; each provider takes one person at
 * a time. A failed pass retains its durable forced request for the next run.
 */
export async function runReconcile(): Promise<ReconcileResult> {
  const redis = getRedis();
  const ttl = Math.max(1000, config.identityReconciliationLeaseSeconds * 1000);
  const lease = await acquireRedisLease(reconcileLeaseKey(), { ttlMs: ttl, renewMs: Math.max(100, Math.floor(ttl / 3)) });
  const acquired = lease !== null;
  const result: ReconcileResult = { acquired, subjects: 0, mirrored: 0, revoked: 0, propagated: 0,
    unchanged: 0, failures: [], lagSeconds: (await getReconcileReadiness()).lagSeconds };
  if (!lease) return result;
  const token = lease.token;
  const assertHeld = async () => {
    if (!await lease.held()) throw new LeaseLostError("Reconcile lease lost");
  };
  try {
    const stats = await redis.hgetall(reconcileStatsKey());
    const observedGeneration = Number(stats.requestGeneration || 0);
    const force = observedGeneration > Number(stats.completedGeneration || 0);
    const tenants = new Map<string, Promise<Awaited<ReturnType<typeof readOrganizationByTenant>>>>();
    const tenantActivity = new Map<string, boolean>();
    const tenantStates = new Map<string, "active" | "ORGANIZATION_DISABLED" | "TENANT_INACTIVE">();
    const inspectTenant = (tenantId: string) => {
      if (!tenants.has(tenantId)) tenants.set(tenantId, (async () => {
        await assertHeld();
        const organization = await readOrganizationByTenant(tenantId);
        if (!organization) return null;
        const active = await isActiveDigitTenant(tenantId, { fresh: true });
        tenantActivity.set(tenantId, active);
        if (!organization.enabled || organization.lifecycle === "FAILED") {
          tenantStates.set(tenantId, "ORGANIZATION_DISABLED");
        } else if (!active) {
          tenantStates.set(tenantId, "TENANT_INACTIVE");
        } else tenantStates.set(tenantId, "active");
        return organization;
      })());
      return tenants.get(tenantId)!;
    };
    // Include tenants without bindings, and disabled Organizations hidden by routing.
    for (const tenantId of await listOrganizationTenants()) {
      try {
        const organization = await inspectTenant(tenantId);
        const name = organization && await digitTenantName(tenantId);
        if (organization && name && name !== organization.name) {
          await assertHeld();
          const path = `/organizations/${encodeURIComponent(organization.id)}`;
          // Stock Keycloak requires the complete representation. Read immediately
          // before PUT so unrelated fields survive; never perform this under a person lease.
          const fresh = await (await request(path)).json() as Record<string, unknown>;
          await assertHeld();
          await request(path, { method: "PUT", body: JSON.stringify({ ...fresh, name }) });
        }
      }
      catch (error) { result.failures.push({ subject: `tenant:${tenantId}`, code: codeOf(error) }); }
    }
    for (let first = 0; ; first += PAGE_SIZE) {
      await assertHeld();
      const page = await (await request(`/users?first=${first}&max=${PAGE_SIZE}&briefRepresentation=true`)).json() as Array<{ id?: string }>;
      if (!Array.isArray(page)) throw new Error("Invalid Keycloak user page");
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, page.length) }, async () => {
        while (index < page.length) {
          const subject = page[index++].id;
          if (!subject) { result.failures.push({ subject: "unknown", code: "IDENTITY_UNAVAILABLE" }); continue; }
          result.subjects++;
          try {
            await assertHeld();
            await withPersonLease(subject, async lease => {
              // The store persists pending expiry under the established lock order.
              const bindings = await readBindings(subject);
              const snapshot = await readMirrorSnapshot(subject);
              await indexBindingTenants(subject, snapshot.user);
              const revoke = async (account: { tenantId: string; uuid: string }, reason: Parameters<typeof revokeAccount>[2], fallback = false) => {
                await assertHeld();
                await lease.assertHeld();
                await revokeAccount(subject, account, reason, { fallback });
                result.revoked++;
              };
              if (snapshot.user.enabled === false) {
                await revokePerson(subject, "KEYCLOAK_DISABLED", { fallback: false });
                result.revoked++;
              }
              for (const prior of snapshot.previous.filter(entry => entry.kind === "staff")) {
                if (!bindings.some(binding => binding.state === "active" && binding.tenantId === prior.tenantId && binding.uuid === prior.uuid)) {
                  await revoke(prior, "BINDING_REMOVED", true);
                }
              }
              for (const entry of snapshot.entries) {
                const previous = snapshot.previous.find(prior => prior.uuid === entry.uuid && prior.tenantId === entry.tenantId);
                if (entry.missing) await revoke(entry, "DIGIT_ACCOUNT_MISSING", !!previous && !previous.missing);
                else if (!entry.active) await revoke(entry, "DIGIT_INACTIVE", previous?.active === true);
                else if (previous && canonical([...previous.roles].sort((a,b) => canonical(a).localeCompare(canonical(b)))) !==
                    canonical([...entry.roles].sort((a,b) => canonical(a).localeCompare(canonical(b))))) await revoke(entry, "ROLE_CHANGED", true);
                if (entry.kind !== "staff") continue;
                const organization = await inspectTenant(entry.tenantId);
                if (!organization || !await isOrganizationMember(organization.id, subject)) {
                  await revoke(entry, "MEMBERSHIP_REMOVED");
                } else if (!organization.enabled || (organization.lifecycle !== null && organization.lifecycle !== "ACTIVE")) {
                  await revoke(entry, "ORGANIZATION_DISABLED");
                } else if (tenantActivity.get(entry.tenantId) === false) await revoke(entry, "TENANT_INACTIVE");
              }
              await assertHeld();
              if (await applyMirrorSnapshot(subject, snapshot, lease, force)) result.mirrored++;
              else result.unchanged++;
              const propagation = await propagateIdentifiers(subject);
              result.propagated += propagation.written;
            });
          } catch (error) {
            if (error instanceof IdentityAdminError && error.status === 404) {
              try { await revokePerson(subject, "KEYCLOAK_DELETED"); result.revoked++; }
              catch (revocationError) { result.failures.push({ subject, code: codeOf(revocationError) }); }
            } else result.failures.push({ subject, code: codeOf(error) });
          }
        }
      }));
      if (page.length < PAGE_SIZE) break;
    }
    for (const [tenantId, state] of tenantStates) {
      const field = `tenant:${tenantId}`;
      if (stats[field] === state) continue;
      try {
        await assertHeld();
        if (state !== "active") await revokeTenantMembers(tenantId, state);
        // A failed fan-out must retain the old observation so the next pass retries.
        const recorded = await redis.eval([
          "if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end",
          "redis.call('hset',KEYS[2],ARGV[2],ARGV[3]); return 1",
        ].join("\n"), 2, reconcileLeaseKey(), reconcileStatsKey(), token, field, state);
        if (recorded !== 1) throw new LeaseLostError("Reconcile lease lost before tenant checkpoint");
      } catch (error) { result.failures.push({ subject: `tenant:${tenantId}`, code: codeOf(error) }); }
    }
    await assertHeld();
    const completed = await redis.eval([
      "if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end",
      "redis.call('hset',KEYS[2],'failures',ARGV[2])",
      "if ARGV[2] == '0' then redis.call('hset',KEYS[2],'lastCompleteAt',ARGV[3],'lagMs',0,'completedGeneration',ARGV[4]) end",
      "return 1",
    ].join("\n"), 2, reconcileLeaseKey(), reconcileStatsKey(), token, result.failures.length, Date.now(), observedGeneration);
    if (completed !== 1) throw new LeaseLostError("Reconcile lease lost before checkpoint");
    result.lagSeconds = (await getReconcileReadiness()).lagSeconds;
    return result;
  } finally {
    await lease.release();
  }
}

export function startReconcile(): () => void {
  let running = false;
  let stopped = false;
  let queued = false;
  const run = () => {
    if (stopped) return;
    if (running) { queued = true; return; }
    running = true;
    void runReconcile().catch(() => console.error("Identity reconciliation failed"))
      .finally(() => { running = false; if (queued) { queued = false; run(); } });
  };
  kick = run;
  const interval = config.identityReconciliationIntervalSeconds;
  const timer = interval > 0 ? setInterval(run, interval * 1000) : undefined;
  timer?.unref();
  if (config.identityReconcileOnStartup) run();
  return () => { stopped = true; if (timer) clearInterval(timer); if (kick === run) kick = undefined; };
}

/**
 * Complaint seeding, driven off the discovered seed plan.
 *
 * Replaces the per-spec pattern of "log ADMIN in and hope it can ASSIGN". Two
 * facts force the shape of this file:
 *
 *  - APPLY is [CITIZEN, CSR] on every deployment, so a complaint is ALWAYS
 *    seeded as a citizen. Seeding as an employee is not a shortcut, it is a
 *    different code path that no citizen ever walks.
 *  - The ASSIGN actor and the assignee need not be the same person (on bomet
 *    they cannot be — see personas.ts), so ASSIGN takes the actor's token and
 *    the assignee's uuid from the plan rather than assuming one employee does
 *    both.
 */
import { BASE_URL, TENANT } from './env';
import { getPersona, resolveSeedPlan } from './personas';
import { pgrCreate } from './launch-fixes/api';
import { provisionFreshCitizen, readProvisionedCitizen, type ProvisionedCitizen } from './citizen-provision';

interface CitizenIdentity {
  token: string;
  userInfo: Record<string, unknown>;
  name: string;
  mobile: string;
}

let citizenCache: CitizenIdentity | null = null;
/** srid -> the citizen that filed it; RATE is only open to the filer. */
const filedBy = new Map<string, CitizenIdentity>();

async function citizen(): Promise<CitizenIdentity> {
  if (citizenCache) return citizenCache;
  const fixture: ProvisionedCitizen = readProvisionedCitizen() ?? (await provisionFreshCitizen());
  citizenCache = {
    token: fixture.token,
    // pgr-services reads userInfo off RequestInfo, and citizen-fixture.json
    // stores only the identity — rebuild the minimum the persister needs.
    userInfo: { uuid: fixture.uuid, type: 'CITIZEN', tenantId: fixture.tenantId, userName: fixture.mobile, name: fixture.name, mobileNumber: fixture.mobile },
    name: fixture.name,
    mobile: fixture.mobile,
  };
  return citizenCache;
}

async function plan(): Promise<Exclude<Awaited<ReturnType<typeof resolveSeedPlan>>, { error: string }>> {
  const p = await resolveSeedPlan();
  if ('error' in p) throw new Error(`Cannot seed a complaint: ${p.error}`);
  return p;
}

async function fetchService(token: string, userInfo: Record<string, unknown>, srid: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&serviceRequestId=${encodeURIComponent(srid)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo } }),
  });
  const j = (await r.json()) as any;
  const service = j?.ServiceWrappers?.[0]?.service;
  if (!service) throw new Error(`seed: ${srid} not found on ${TENANT} (HTTP ${r.status})`);
  return service;
}

/** POST a workflow transition and assert the state it must land in. */
async function transition(
  srid: string,
  token: string,
  userInfo: Record<string, unknown>,
  workflow: Record<string, unknown>,
  expectStatus: string,
  actorLabel: string,
  mutate?: (service: Record<string, unknown>) => void,
): Promise<void> {
  const service = await fetchService(token, userInfo, srid);
  mutate?.(service);
  const r = await fetch(`${BASE_URL}/pgr-services/v2/request/_update?tenantId=${encodeURIComponent(TENANT)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: token, userInfo }, service, workflow }),
  });
  if (!r.ok) {
    throw new Error(`seed: ${String(workflow.action)} ${srid} as ${actorLabel} failed: HTTP ${r.status} ${(await r.text()).slice(0, 400)}`);
  }
  const status = ((await r.json()) as any)?.ServiceWrappers?.[0]?.service?.applicationStatus;
  if (status !== expectStatus) {
    throw new Error(`seed: ${String(workflow.action)} ${srid} as ${actorLabel} landed in ${status}, expected ${expectStatus}`);
  }
}

export async function seedComplaintAsCitizen(opts?: {
  serviceCode?: string;
  localityCode?: string;
  description?: string;
}): Promise<{ srid: string; status: string }> {
  const p = await plan();
  const who = await citizen();
  const result = await pgrCreate({
    baseUrl: BASE_URL,
    auth: { token: who.token, userInfo: who.userInfo },
    tenantId: TENANT,
    serviceCode: opts?.serviceCode ?? p.serviceCode,
    localityCode: opts?.localityCode ?? p.localityCode,
    description: opts?.description ?? `seed complaint — ${new Date().toISOString()}`,
    citizenName: who.name,
    citizenPhone: who.mobile,
  });
  filedBy.set(result.serviceRequestId, who);
  return { srid: result.serviceRequestId, status: result.applicationStatus };
}

export async function driveToPendingAtLme(srid: string, assigneeUuid?: string): Promise<void> {
  const p = await plan();
  const assignee = assigneeUuid ?? p.assigneeUuid;
  await transition(
    srid,
    p.actor.token,
    p.actor.userInfo,
    { action: 'ASSIGN', assignes: [assignee], comments: 'seed assign' },
    'PENDINGATLME',
    `${p.actor.username} -> assignee ${assigneeUuid ? assignee : p.assigneeCode}`,
  );
}

export async function driveToResolved(srid: string): Promise<void> {
  // RESOLVE is role-gated (PGR_LME), not assignee-gated, so any credentialed
  // LME can close it out — which matters where the assignee's password is
  // unknown and only its uuid was ever needed.
  const lme = await getPersona('lme');
  await transition(srid, lme.token, lme.userInfo, { action: 'RESOLVE', comments: 'seed resolve' }, 'RESOLVED', lme.username);
}

export async function driveToClosedRated(srid: string, rating: number): Promise<void> {
  const who = filedBy.get(srid) ?? (await citizen());
  await transition(
    srid,
    who.token,
    who.userInfo,
    { action: 'RATE', comments: 'seed rating' },
    'CLOSEDAFTERRESOLUTION',
    `citizen ${who.mobile}`,
    (service) => {
      service.rating = rating;
    },
  );
}

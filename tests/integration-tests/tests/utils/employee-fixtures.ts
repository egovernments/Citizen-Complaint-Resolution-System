/**
 * Employee-side complaint fixtures for deployments where lifecycle.setup.ts
 * could not seed any (no ASSIGN-capable persona, so lifecycle-fixtures.json is
 * a skip marker — bomet is the case in point).
 *
 * Two ways to get a complaint an employee persona can honestly open:
 *
 *  - findExistingComplaint(): READ-ONLY. Walk the personas profile discovery
 *    already resolved, search what each can see (pgr-services applies its ABAC
 *    scope, so a hit is by definition viewable by that persona), and pick one
 *    whose CURRENT workflow state gives that persona either no action at all or
 *    a real one. The state → action roles come from the deployment's own PGR
 *    businessService, the same data PGRDetails.js's shouldShowActionButton()
 *    reads, so nothing about the state machine is pinned here. Nothing is
 *    mutated; the caller only renders the complaint.
 *
 *  - seedComplaintVisibleTo(): files a NEW complaint as the suite's citizen,
 *    with a complaint type owned by one of the viewer's HRMS departments and a
 *    locality inside its jurisdiction, then proves the viewer can read it back
 *    through the API before the caller opens it in the UI.
 */
import { BASE_URL, TENANT } from './env';
import { getProfile } from './profile';
import { resolvePersona, type PersonaKey, type ResolvedPersona } from './personas';
import { seedComplaintAsCitizen } from './seed';

/** Order matters: the persona a spec was written for first, then the others. */
const VIEWER_KEYS: PersonaKey[] = ['inbox-viewer', 'gro-with-department', 'gro', 'lme', 'ward-scoped-csr', 'csr', 'employee'];

/**
 * Only keys profile discovery actually resolved. resolvePersona() on a key the
 * profile recorded as null re-sweeps every candidate credential, which is the
 * login storm personas.ts warns about.
 */
export async function resolvedViewers(): Promise<ResolvedPersona[]> {
  const recorded = getProfile().personas?.resolved ?? {};
  const out: ResolvedPersona[] = [];
  for (const key of VIEWER_KEYS) {
    if (!recorded[key]) continue;
    const p = await resolvePersona(key).catch(() => null);
    if (p && !out.some((o) => o.uuid === p.uuid)) out.push(p);
  }
  return out;
}

async function searchAs(p: ResolvedPersona, query: string): Promise<any[]> {
  const r = await fetch(`${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&${query}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: p.token, userInfo: p.userInfo } }),
  });
  const j = (await r.json().catch(() => ({}))) as any;
  return (j?.ServiceWrappers ?? []).map((w: any) => w?.service).filter(Boolean);
}

interface WfState {
  state: string;
  actions: { action: string; roles: string[] }[];
}

async function pgrStates(p: ResolvedPersona): Promise<{ states: WfState[]; initial: string }> {
  const r = await fetch(
    `${BASE_URL}/egov-workflow-v2/egov-wf/businessservice/_search?tenantId=${encodeURIComponent(TENANT)}&businessServices=PGR`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: p.token, userInfo: p.userInfo } }),
    },
  );
  const svc = ((await r.json().catch(() => ({}))) as any)?.BusinessServices?.[0];
  const raw: any[] = svc?.states ?? [];
  const byUuid = new Map(raw.map((s) => [s.uuid, s.state]));
  const states: WfState[] = raw
    .filter((s) => s.state)
    .map((s) => ({ state: s.state, actions: (s.actions ?? []).map((a: any) => ({ action: a.action, roles: a.roles ?? [] })) }));
  // The state a fresh complaint sits in: where the start state's APPLY lands.
  const start = raw.find((s) => !s.state);
  const apply = start?.actions?.find((a: any) => a.action === 'APPLY');
  return { states, initial: String(byUuid.get(apply?.nextState) ?? '') };
}

export interface ExistingComplaint {
  srid: string;
  status: string;
  persona: ResolvedPersona;
  /** Human-readable reason the pick qualifies, for annotations and messages. */
  why: string;
}

/**
 * kind 'no-action': a complaint past the initial state (so its timeline has at
 *   least APPLY + one transition) whose current state offers the viewer NO
 *   action — PGRDetails renders no Take Action button for it. Truly terminal
 *   states (no actions for anyone) are preferred over "terminal for this
 *   viewer" ones.
 * kind 'actionable': a complaint whose current state offers the viewer a
 *   non-ESCALATE action (ESCALATE is additionally gated on holding the
 *   complaint, #2129), so Take Action renders AND is enabled.
 */
export async function findExistingComplaint(kind: 'no-action' | 'actionable'): Promise<ExistingComplaint | { error: string }> {
  const viewers = await resolvedViewers();
  if (!viewers.length) return { error: 'profile discovery resolved no employee persona that can log in' };
  const tried: string[] = [];
  for (const persona of viewers) {
    const { states, initial } = await pgrStates(persona);
    if (!states.length) return { error: `no PGR businessService readable on ${TENANT}` };
    const byName = new Map(states.map((s) => [s.state, s]));
    const visible: any[] = [];
    for (let offset = 0; offset < 600; offset += 200) {
      const page = await searchAs(persona, `limit=200&offset=${offset}`);
      visible.push(...page);
      if (page.length < 200) break;
    }
    tried.push(`${persona.username}[roles=${persona.roles.join('|')}; sees ${visible.length}]`);
    const mine = (s: WfState) => s.actions.filter((a) => a.roles.some((r) => persona.roles.includes(r)));
    const scored = visible
      .map((svc) => ({ svc, st: byName.get(String(svc.applicationStatus)) }))
      .filter((x): x is { svc: any; st: WfState } => !!x.st)
      .flatMap(({ svc, st }) => {
        if (kind === 'no-action') {
          if (st.state === initial || mine(st).length > 0) return [];
          const terminal = st.actions.length === 0;
          return [{ svc, rank: terminal ? 0 : 1, why: terminal ? `${st.state} (no actions for any role)` : `${st.state} (no action for ${persona.roles.join('|')})` }];
        }
        const usable = mine(st).filter((a) => a.action !== 'ESCALATE');
        if (!usable.length) return [];
        return [{ svc, rank: 0, why: `${st.state} (offers ${usable.map((a) => a.action).join('/')} to ${persona.roles.join('|')})` }];
      })
      .sort((a, b) => a.rank - b.rank);
    if (scored.length) {
      const { svc, why } = scored[0];
      return { srid: String(svc.serviceRequestId), status: String(svc.applicationStatus), persona, why: `${persona.username}: ${why}` };
    }
  }
  return { error: `no complaint visible to any resolved persona is in a ${kind} state for it — ${tried.join(', ')}` };
}

/**
 * Pick a viewer that can see a complaint filed now, and file one for it.
 * Visibility under PGR ABAC needs the complaint type's department among the
 * viewer's HRMS departments and the locality inside its jurisdiction, so both
 * are chosen FROM the viewer. Proven by an API read-back as the viewer.
 */
export async function seedComplaintVisibleTo(opts: {
  description: string;
  geoLocation?: { latitude?: number; longitude?: number };
  viewer?: ResolvedPersona;
}): Promise<{ srid: string; persona: ResolvedPersona }> {
  const profile = getProfile();
  const locality = profile.pgr?.seedLocalityCode ?? profile.boundary.leafCode;
  const services = [...profile.complaintTypes.services].sort((a, b) => a.serviceCode.localeCompare(b.serviceCode));
  const viewers = opts.viewer ? [opts.viewer] : await resolvedViewers();
  const reasons: string[] = [];
  for (const persona of viewers) {
    const svc = services.find((s) => persona.departments.includes(s.department));
    if (!svc) {
      reasons.push(`${persona.username}: no complaint type in depts ${persona.departments.join('|') || 'none'}`);
      continue;
    }
    if (!locality || !(persona.jurisdictions.includes(locality) || persona.roles.includes('SUPERVISOR'))) {
      reasons.push(`${persona.username}: jurisdiction ${persona.jurisdictions.join('|') || 'none'} does not list ${locality}`);
      continue;
    }
    const { srid } = await seedComplaintAsCitizen({
      serviceCode: svc.serviceCode,
      localityCode: locality,
      description: opts.description,
      geoLocation: opts.geoLocation,
    });
    const seen = await searchAs(persona, `serviceRequestId=${encodeURIComponent(srid)}`);
    if (!seen.length) {
      throw new Error(
        `${srid} (${svc.serviceCode} → ${svc.department}, ${locality}) was filed but ${persona.username} cannot read it back ` +
          `(depts ${persona.departments.join('|')}, jurisdictions ${persona.jurisdictions.join('|')})`,
      );
    }
    return { srid, persona };
  }
  throw new Error(`no resolved persona can see a freshly filed complaint: ${reasons.join('; ')}`);
}

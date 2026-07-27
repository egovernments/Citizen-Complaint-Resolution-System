/**
 * Low-level deployment probes — the raw reads the discovery layer is built on.
 *
 * Each one replaces a value that used to be hand-pinned in a deploy/<tenant>.env
 * and could silently drift from the deployment. They are deliberately dumb: no
 * caching, no policy, no skip decisions — profile.ts composes them.
 *
 * Every probe here is verified against BOTH shipped deployment shapes:
 *   local  mz + mz.maputo, hierarchy MAPUTO_ADMIN (4 levels, accented)
 *   bomet  flat ke,        hierarchy ADMIN        (3 levels: County/SubCounty/Ward)
 */
import { BASE_URL } from './env';

/** RequestInfo good enough for the read-only searches below. */
function requestInfo(authToken?: string): Record<string, unknown> {
  return { apiId: 'Rainmaker', ver: '.01', ts: null, msgId: 'probe', authToken };
}

/**
 * Per-request ceiling. A probe that hangs must not hang the whole run: every
 * project depends on profile-setup, so one stuck socket stalls everything.
 */
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS) || 20_000;

/** A probe could not talk to the deployment (transport, timeout, bad body). */
export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeError';
  }
}

/** The deployment answered, but not with a 2xx. Carries the status for callers. */
export class ProbeHttpError extends ProbeError {
  constructor(
    readonly status: number,
    readonly body: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProbeHttpError';
  }
}

/**
 * THE RULE THIS FILE IS BUILT ON: only a 2xx body may say a thing is absent.
 *
 * Every failure below throws — transport, timeout, non-2xx, unparseable body.
 * It would be less code to collapse them into `null`, and that is exactly the
 * bug: profile.ts's attempt() retries a throw and, if it still fails, records a
 * probe FAILURE, whereas a `null` is indistinguishable from the deployment
 * calmly answering "not configured". Collapse them and a 502 or an expired
 * token reads as "this capability is absent" — a confident, wrong diagnosis
 * that sends a reader off to seed data that already exists.
 *
 * The distinction is cheap to keep because the deployments make it for us:
 * verified on BOTH, every search here answers a genuinely-missing master with
 * 200 + an empty array (MDMS with an unknown schemaCode, workflow with an
 * unknown businessService, localization with an unknown locale, HRMS with an
 * unknown tenant). So "absent" always arrives as a 2xx, and a non-2xx is always
 * a real failure. fetchBoundaryTree documents the one exception.
 */
async function probeFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new ProbeError(
      timedOut ? `${url} — no response within ${PROBE_TIMEOUT_MS}ms` : `${url} — request failed: ${msg}`,
    );
  }
}

/** Reads at most this much of an error body into the message — enough to name the cause. */
const ERROR_BODY_CHARS = 400;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await probeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new ProbeHttpError(r.status, text, `${url} — HTTP ${r.status}: ${text.slice(0, ERROR_BODY_CHARS)}`);
  }
  const text = await r.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProbeError(`${url} — HTTP 200 but body is not JSON: ${text.slice(0, ERROR_BODY_CHARS)}`);
  }
}

// ── globalConfigs ────────────────────────────────────────────────────────────

export interface GlobalConfigs {
  stateTenantId?: string;
  hierarchyType?: string;
  boundaryType?: string;
  pgrBoundaryHighestLevel?: string;
  pgrBoundaryLowestLevel?: string;
  localeRegion?: string;
  /** Language half of the SPA's default locale; joins localeRegion as `en_IN`. */
  localeDefault?: string;
  coreMobileConfigs?: { countryCode?: string; mobileNumberRegex?: string };
  corePostalConfigs?: { postalCodePattern?: string; postalCodeLength?: number };
}

/**
 * Read /digit-ui/globalConfigs.js — the file the deployed SPA itself boots from,
 * so it is the authority on hierarchy/postal/mobile, ahead of any env var or
 * ansible host_vars (which are only its *inputs* and can be out of sync).
 *
 * It is a plain script (`var hierarchyType = "ADMIN";`), not JSON, so the values
 * are lifted with a regex rather than parsed. Ansible emits non-ASCII as \uXXXX
 * escapes ("Município"), which JSON.parse decodes for us.
 *
 * A 404 is the one tolerated failure: a deployment that serves no globalConfigs
 * at all is a shape profile.ts explicitly floors for, so it yields {} rather
 * than a retry. Anything else (5xx, timeout, TLS) throws — an unreachable SPA
 * config must not silently hand discovery an empty deployment.
 */
export async function fetchGlobalConfigs(baseUrl = BASE_URL): Promise<GlobalConfigs> {
  const url = `${baseUrl}/digit-ui/globalConfigs.js`;
  const r = await probeFetch(url);
  if (r.status === 404) return {};
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new ProbeHttpError(r.status, text, `${url} — HTTP ${r.status}: ${text.slice(0, ERROR_BODY_CHARS)}`);
  }
  const src = await r.text();

  const read = (name: string): unknown => {
    // `var x = <value>;` — value is a JSON scalar or object literal.
    const m = src.match(new RegExp(`var\\s+${name}\\s*=\\s*([^;]+);`));
    if (!m) return undefined;
    try {
      return JSON.parse(m[1].trim());
    } catch {
      return undefined;
    }
  };

  return {
    stateTenantId: read('stateTenantId') as string | undefined,
    hierarchyType: read('hierarchyType') as string | undefined,
    boundaryType: read('boundaryType') as string | undefined,
    pgrBoundaryHighestLevel: read('pgrBoundaryHighestLevel') as string | undefined,
    pgrBoundaryLowestLevel: read('pgrBoundaryLowestLevel') as string | undefined,
    localeRegion: read('localeRegion') as string | undefined,
    localeDefault: read('localeDefault') as string | undefined,
    coreMobileConfigs: read('coreMobileConfigs') as GlobalConfigs['coreMobileConfigs'],
    corePostalConfigs: read('corePostalConfigs') as GlobalConfigs['corePostalConfigs'],
  };
}

// ── tenant display label ─────────────────────────────────────────────────────

/**
 * The label the employee login's City combobox renders for a tenant.
 *
 * MUST be an exact key lookup: `TENANT_TENANTS_` + tenant, uppercased with dots
 * as underscores. That namespace also holds configurator form-field labels
 * (TENANT_TENANTS_CITY -> "City", TENANT_TENANTS_CODE -> "Code"), so a prefix
 * scan silently returns the wrong string.
 *
 * Verified: mz.maputo -> "Maputo" (NOT the XLSX's "Município de Maputo", which
 * never applied because the tenant already existed); ke -> "Bomet County".
 */
export function tenantLabelKey(tenantId: string): string {
  return `TENANT_TENANTS_${tenantId.toUpperCase().replace(/\./g, '_')}`;
}

export async function fetchTenantLabel(
  tenantId: string,
  opts?: { rootTenant?: string; locale?: string; authToken?: string; baseUrl?: string },
): Promise<string | undefined> {
  const baseUrl = opts?.baseUrl ?? BASE_URL;
  const searchTenant = opts?.rootTenant ?? tenantId.split('.')[0];
  const locale = opts?.locale ?? 'en_IN';
  const data = await postJson<{ messages?: { code: string; message: string }[] }>(
    `${baseUrl}/localization/messages/v1/_search` +
      `?tenantId=${encodeURIComponent(searchTenant)}&locale=${locale}&module=rainmaker-common`,
    { RequestInfo: requestInfo(opts?.authToken) },
  );
  const want = tenantLabelKey(tenantId);
  return (data.messages || []).find((m) => m.code === want)?.message;
}

// ── boundary tree ────────────────────────────────────────────────────────────

export interface BoundaryShape {
  hierarchyType: string;
  /** Level names, root first, e.g. ['County','SubCounty','Ward']. */
  levels: string[];
  rootCode?: string;
  rootType?: string;
  /** A real leaf code, usable as a locality. */
  sampleLeafCode?: string;
}

/** One node of the boundary-relationships tree, as the service returns it. */
export interface BoundaryNode {
  code: string;
  boundaryType: string;
  children?: BoundaryNode[];
}

/**
 * Read the whole boundary tree for a hierarchy, root node first.
 *
 * Filters MUST go on the query string — boundary-service binds them with
 * @RequestParam and ignores a BoundaryRelationship body, silently returning some
 * other tenant's tree. /boundary/_search is useless for structure: it is a flat,
 * default-paginated list whose entities carry no boundaryType at all.
 *
 * The full tree (not just the shape below) is what lets a caller count nodes,
 * verify a configured locality actually exists, and take a leaf's ancestors —
 * things a spec must not hardcode per deployment.
 *
 * The lone exception to this file's 2xx rule: boundary-service answers a
 * hierarchy it has never heard of with 400 HIERARCHY_DEFINITION_DOES_NOT_EXIST_ERR
 * rather than an empty tree (verified on both deployments). That is a real "not
 * configured", so it returns null instead of throwing — retrying it twice would
 * only slow the run down to reach the same answer. Every other non-2xx still
 * throws.
 */
export async function fetchBoundaryTree(
  tenantId: string,
  hierarchyType: string,
  opts?: { authToken?: string; baseUrl?: string },
): Promise<BoundaryNode | null> {
  const baseUrl = opts?.baseUrl ?? BASE_URL;
  let data: { TenantBoundary?: any[] };
  try {
    data = await postJson<{ TenantBoundary?: any[] }>(
      `${baseUrl}/boundary-service/boundary-relationships/_search` +
        `?tenantId=${encodeURIComponent(tenantId)}&hierarchyType=${encodeURIComponent(hierarchyType)}` +
        `&includeChildren=true`,
      { RequestInfo: requestInfo(opts?.authToken) },
    );
  } catch (err) {
    if (err instanceof ProbeHttpError && err.status === 400 && err.body.includes('HIERARCHY_DEFINITION_DOES_NOT_EXIST_ERR')) {
      return null;
    }
    throw err;
  }
  const root = data.TenantBoundary?.[0]?.boundary?.[0];
  return root?.code ? (root as BoundaryNode) : null;
}

export async function fetchBoundaryShape(
  tenantId: string,
  hierarchyType: string,
  opts?: { authToken?: string; baseUrl?: string },
): Promise<BoundaryShape | null> {
  const root = await fetchBoundaryTree(tenantId, hierarchyType, opts);
  if (!root) return null;

  // Walk the first branch down to collect one level name per depth.
  const levels: string[] = [];
  let deepest: BoundaryNode = root;
  for (let node: BoundaryNode | undefined = root; node; node = node.children?.[0]) {
    if (node.boundaryType && !levels.includes(node.boundaryType)) levels.push(node.boundaryType);
    deepest = node;
  }

  return {
    hierarchyType,
    levels,
    rootCode: root.code,
    rootType: root.boundaryType,
    sampleLeafCode: deepest?.code,
  };
}

// ── workflow capabilities ────────────────────────────────────────────────────

export interface WorkflowShape {
  /** Every action the businessService defines, e.g. has('ESCALATE'). */
  actions: Set<string>;
  /** action -> roles allowed to invoke it. APPLY is [CITIZEN, CSR] everywhere. */
  rolesByAction: Map<string, string[]>;
  /** state name -> roles able to act on it; an assignee needs one of the NEXT state's. */
  rolesByState: Map<string, string[]>;
  /**
   * action -> the state it lands in, e.g. ASSIGN -> PENDINGATLME. The wire
   * carries nextState as a state *uuid*, which is meaningless to a caller;
   * resolved to the state name here. Needed to look up the assignee's required
   * roles in rolesByState without hardcoding the PGR state names.
   */
  nextStateByAction: Map<string, string>;
}

/**
 * Read the PGR state machine. This is what makes ESCALATE a *capability* rather
 * than a config knob: bomet's ke defines it, mz.maputo's pg-derived workflow
 * does not — so the same spec must run on one and skip on the other.
 */
export async function fetchWorkflowShape(
  tenantId: string,
  businessService = 'PGR',
  opts?: { authToken?: string; baseUrl?: string },
): Promise<WorkflowShape | null> {
  const baseUrl = opts?.baseUrl ?? BASE_URL;
  const data = await postJson<{ BusinessServices?: any[] }>(
    `${baseUrl}/egov-workflow-v2/egov-wf/businessservice/_search` +
      `?tenantId=${encodeURIComponent(tenantId)}&businessServices=${businessService}`,
    { RequestInfo: requestInfo(opts?.authToken) },
  );
  const svc = data.BusinessServices?.[0];
  if (!svc?.states?.length) return null;

  const actions = new Set<string>();
  const rolesByAction = new Map<string, string[]>();
  const rolesByState = new Map<string, string[]>();
  const nextStateByAction = new Map<string, string>();
  const stateNameByUuid = new Map<string, string>(
    (svc.states as any[]).filter((s) => s.uuid && s.state).map((s) => [s.uuid, s.state]),
  );

  for (const state of svc.states) {
    const stateRoles = new Set<string>();
    for (const a of state.actions || []) {
      actions.add(a.action);
      rolesByAction.set(a.action, [...new Set([...(rolesByAction.get(a.action) || []), ...(a.roles || [])])]);
      (a.roles || []).forEach((r: string) => stateRoles.add(r));
      // Some nextState uuids point at states the search didn't return (bomet's
      // FORWARD is one) — skip those rather than record an unusable uuid.
      const next = stateNameByUuid.get(a.nextState);
      if (next) nextStateByAction.set(a.action, next);
    }
    if (state.state) rolesByState.set(state.state, [...stateRoles]);
  }

  return { actions, rolesByAction, rolesByState, nextStateByAction };
}

// ── HRMS ─────────────────────────────────────────────────────────────────────

export interface EmployeeJurisdiction {
  hierarchy: string;
  boundary: string;
  boundaryType: string;
}

export interface DiscoveredEmployee {
  code: string;
  uuid: string;
  roles: string[];
  /** Every assignment row — pgr-services reads current AND historical. */
  departments: string[];
  /**
   * The boundaries this employee is scoped to. A row's `hierarchy` need not be
   * the PGR one (local ADMIN sits in hierarchy 'ADMIN' while complaints use
   * MAPUTO_ADMIN), so a caller filtering for ward-scoping must match on
   * hierarchy too — otherwise an unscoped admin reads as ward-scoped.
   */
  jurisdictions: EmployeeJurisdiction[];
}

/**
 * List employees at an EXACT tenant.
 *
 * Deliberately unfiltered: the `codes=`/`names=` filters are NOT tenant-scoped
 * (asking ke for codes=EMP001 returns an mz.maputo employee), whereas the
 * unfiltered search is. Exact-tenant matters because HRMS does not fall back to
 * a parent — BOMET_ADMIN exists only at ke.bomet, so it cannot serve a complaint
 * filed at ke no matter what an env var says.
 */
export async function fetchEmployees(
  tenantId: string,
  authToken: string,
  opts?: { baseUrl?: string },
): Promise<DiscoveredEmployee[]> {
  const baseUrl = opts?.baseUrl ?? BASE_URL;
  const data = await postJson<{ Employees?: any[] }>(
    `${baseUrl}/egov-hrms/employees/_search?tenantId=${encodeURIComponent(tenantId)}&isActive=true`,
    { RequestInfo: requestInfo(authToken) },
  );
  return (data.Employees || []).map((e) => ({
    code: e.code,
    uuid: e.uuid,
    roles: [...new Set(((e.user?.roles || []) as any[]).map((r) => r.code))] as string[],
    departments: [
      ...new Set(((e.assignments || []) as any[]).map((a) => a.department).filter(Boolean)),
    ] as string[],
    jurisdictions: ((e.jurisdictions || []) as any[])
      .filter((j) => j.isActive !== false && j.boundary)
      .map((j) => ({ hierarchy: j.hierarchy, boundary: j.boundary, boundaryType: j.boundaryType })),
  }));
}

// ── localization ─────────────────────────────────────────────────────────────

/**
 * How many messages a locale actually carries for a module.
 *
 * A locale existing in StateInfo proves nothing about it being usable: every
 * deployment inherits 205-row placeholder locales from the pg demo seed, and
 * the local stack's ka_IN has exactly 2 rainmaker-common rows. Counting is the
 * only way to tell a seeded locale from a stub.
 */
export async function fetchLocalizationCount(
  tenantId: string,
  locale: string,
  opts?: { module?: string; authToken?: string; baseUrl?: string },
): Promise<number> {
  const baseUrl = opts?.baseUrl ?? BASE_URL;
  const moduleParam = opts?.module ? `&module=${encodeURIComponent(opts.module)}` : '';
  const data = await postJson<{ messages?: unknown[] }>(
    `${baseUrl}/localization/messages/v1/_search` +
      `?tenantId=${encodeURIComponent(tenantId)}&locale=${encodeURIComponent(locale)}${moduleParam}`,
    { RequestInfo: requestInfo(opts?.authToken) },
  );
  return data.messages?.length ?? 0;
}

// ── MDMS ─────────────────────────────────────────────────────────────────────

/**
 * MDMS v2 search. The schemaCode goes in the CRITERIA, not the path —
 * POST /mdms-v2/v2/_search/<schema> 404s ("No static resource").
 */
export async function fetchMdms(
  tenantId: string,
  schemaCode: string,
  authToken?: string,
  opts?: { baseUrl?: string; limit?: number },
): Promise<any[]> {
  const baseUrl = opts?.baseUrl ?? BASE_URL;
  const data = await postJson<{ mdms?: any[] }>(`${baseUrl}/mdms-v2/v2/_search`, {
    RequestInfo: requestInfo(authToken),
    MdmsCriteria: { tenantId, schemaCode, limit: opts?.limit ?? 500 },
  });
  return data.mdms || [];
}

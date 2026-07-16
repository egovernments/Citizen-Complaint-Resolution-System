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

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => null)) as T | null;
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
 */
export async function fetchGlobalConfigs(baseUrl = BASE_URL): Promise<GlobalConfigs> {
  const r = await fetch(`${baseUrl}/digit-ui/globalConfigs.js`).catch(() => null);
  if (!r || !r.ok) return {};
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
  return (data?.messages || []).find((m) => m.code === want)?.message;
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
 */
export async function fetchBoundaryTree(
  tenantId: string,
  hierarchyType: string,
  opts?: { authToken?: string; baseUrl?: string },
): Promise<BoundaryNode | null> {
  const baseUrl = opts?.baseUrl ?? BASE_URL;
  const data = await postJson<{ TenantBoundary?: any[] }>(
    `${baseUrl}/boundary-service/boundary-relationships/_search` +
      `?tenantId=${encodeURIComponent(tenantId)}&hierarchyType=${encodeURIComponent(hierarchyType)}` +
      `&includeChildren=true`,
    { RequestInfo: requestInfo(opts?.authToken) },
  );
  const root = data?.TenantBoundary?.[0]?.boundary?.[0];
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
  const svc = data?.BusinessServices?.[0];
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
  return (data?.Employees || []).map((e) => ({
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
  return data?.messages?.length ?? 0;
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
  return data?.mdms || [];
}

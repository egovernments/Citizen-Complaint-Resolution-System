/**
 * ours (#1550, option B, owner 2026-10-12): COUNTY-SCOPED masters. A tenant below the state never inherits these from
 * the state itself, only from its own subtree; shared masters keep inheriting. The state's own county (stateCounty:
 * the county whose config lives AT the state, today Bomet at ke) and its subtree are the exception and keep the
 * state's rows. Mirrors ccrs-compat's rule (src/compat/core/countyScoped.js, county-scoped.json), so a backend that
 * still answers nearest-ancestor rows shows the same as one that applies it.
 */
import type { MdmsRecord } from '../client/types.js';
import type { DigitApiClient } from '../client/DigitApiClient.js';

export const COUNTY_SCOPED_SCHEMAS: readonly string[] = [
  'common-masters.Department',
  'common-masters.Designation',
  'RAINMAKER-PGR.ComplaintHierarchy',
  'RAINMAKER-PGR.ServiceDefs',
  'RAINMAKER-PGR.EscalationConfig',
  'RAINMAKER-PGR.UIConstants',
];

/** state -> the county whose county-scoped config lives at the state (county-scoped.json stateCounty). */
let stateCounties: Record<string, string> = { ke: 'ke.bomet' };

/** Set the stateCounty map (e.g. {} on a stack where every county holds its own config). */
export function setStateCounties(map: Record<string, string>): void {
  stateCounties = { ...map };
}

const within = (t: string, node: string) => t === node || t.startsWith(`${node}.`);

/** True when `tenant` must not read the state's rows of `schema`: a county-scoped master, below the state, outside stateCounty. */
export function skipsState(tenant: string, schema: string): boolean {
  if (!COUNTY_SCOPED_SCHEMAS.includes(schema) || !tenant.includes('.')) return false;
  const county = stateCounties[tenant.split('.')[0]];
  return !(county && within(tenant, county));
}

/** The rows `tenant` may show: the state's rows of a county-scoped master are dropped below the state (option B). */
export function withoutStateRows(tenant: string, schema: string, rows: MdmsRecord[]): MdmsRecord[] {
  if (!skipsState(tenant, schema)) return rows;
  const state = tenant.split('.')[0];
  return rows.filter((r) => r.tenantId !== state);
}

/** Each county-scoped master's unique key (county-scoped.json `keys`: the schema's x-unique, joined with a dot). */
export const COUNTY_SCOPED_KEYS: Readonly<Record<string, readonly string[]>> = {
  'common-masters.Department': ['code'],
  'common-masters.Designation': ['code'],
  'RAINMAKER-PGR.ComplaintHierarchy': ['hierarchyType', 'code'],
  'RAINMAKER-PGR.ServiceDefs': ['serviceCode'],
  'RAINMAKER-PGR.EscalationConfig': ['code'],
  'RAINMAKER-PGR.UIConstants': ['code'],
};

export function isCountyScoped(schema: string | undefined): boolean {
  return !!schema && COUNTY_SCOPED_SCHEMAS.includes(schema);
}

/** A record's unique key for a county-scoped master: its `keys` values joined with a dot, else its uniqueIdentifier. */
export function countyScopedKey(schema: string, record: { uniqueIdentifier?: unknown; data?: Record<string, unknown> }): string {
  const keys = COUNTY_SCOPED_KEYS[schema];
  const data = record.data ?? {};
  if (keys && keys.every((k) => data[k] != null && data[k] !== '')) return keys.map((k) => String(data[k])).join('.');
  return String(record.uniqueIdentifier ?? '');
}

/** A tenant below the state that holds its own row (or boundary tree) and so overrides the state's for its subtree. */
export interface CountyOverride {
  tenantId: string;
  name: string;
  /** The overriding row's uniqueIdentifier at that tenant (absent for a boundary tree). */
  uniqueIdentifier?: string;
}

type OverrideClient = Pick<DigitApiClient, 'mdmsSearch'>;

/** The counties of `root`: every active tenant ONE level below it (tenant.tenants at the root), with its name. Deeper
 *  tenants inherit from their county, which is the level that keeps its own copies. */
async function tenantsBelow(client: OverrideClient, root: string): Promise<{ code: string; name: string }[]> {
  const out: { code: string; name: string }[] = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 20_000; offset += 500) {
    const page = await client.mdmsSearch(root, 'tenant.tenants', { limit: 500, offset, isActive: true });
    for (const r of page) {
      const d = (r.data ?? {}) as Record<string, unknown>;
      const code = String(d.code ?? '').trim();
      if (!code.startsWith(`${root}.`) || code.split('.').length !== root.split('.').length + 1 || seen.has(code)) continue;
      seen.add(code);
      const name = typeof d.name === 'string' && d.name.trim() ? d.name.trim() : code;
      out.push({ code, name });
    }
    if (page.length < 500) break;
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** ours (#1954): the counties of a state root (one level below it), with their names, in code order. */
export async function countiesOf(client: OverrideClient, root: string): Promise<{ code: string; name: string }[]> {
  if (!root || root.includes('.')) return [];
  return tenantsBelow(client, root);
}

/** A tenant's OWN active rows of a schema (a read may also answer an ancestor's rows: those are not its own). */
async function ownActiveRows(client: OverrideClient, tenant: string, schema: string): Promise<MdmsRecord[]> {
  const out: MdmsRecord[] = [];
  for (let offset = 0; offset < 20_000; offset += 500) {
    const page = await client.mdmsSearch(tenant, schema, { limit: 500, offset, isActive: true });
    out.push(...page.filter((r) => (r.tenantId ?? tenant) === tenant && r.isActive !== false));
    if (page.length < 500) break;
  }
  return out;
}

/**
 * ours (#1945): at a STATE ROOT, which tenants below it hold their own active row of a county-scoped master, by the
 * record's unique key (county-scoped.json `keys`). Reads resolve nearest-wins, so a state row with an entry here is not
 * what those tenants (and their subtrees) see: an edit at the state does not reach them. Empty for a tenant below the
 * state, a shared (not county-scoped) master, or a state with no tenants below it.
 */
export async function countyOverrides(client: OverrideClient, tenant: string, schema: string): Promise<Map<string, CountyOverride[]>> {
  const out = new Map<string, CountyOverride[]>();
  if (!tenant || tenant.includes('.') || !isCountyScoped(schema)) return out;
  const counties = await tenantsBelow(client, tenant);
  // an unreadable county overrides nothing we can show
  const read = await Promise.all(counties.map((t) => ownActiveRows(client, t.code, schema).catch(() => [] as MdmsRecord[])));
  counties.forEach((t, i) => {
    for (const r of read[i]) {
      const key = countyScopedKey(schema, r);
      if (!key) continue;
      const list = out.get(key) ?? [];
      if (!list.some((o) => o.tenantId === t.code)) list.push({ tenantId: t.code, name: t.name, uniqueIdentifier: r.uniqueIdentifier });
      out.set(key, list);
    }
  });
  return out;
}

/**
 * ours (#1945): at a STATE ROOT, the tenants below it with their own boundary hierarchy of `hierarchyType`: their own
 * tree is the one their apps use, so a boundary edit at the state does not reach them. Empty below the state.
 */
export async function boundaryTreeOverrides(
  client: OverrideClient & Pick<DigitApiClient, 'boundaryHierarchySearch'>,
  tenant: string,
  hierarchyType: string,
): Promise<CountyOverride[]> {
  if (!tenant || tenant.includes('.') || !hierarchyType) return [];
  const counties = await tenantsBelow(client, tenant);
  const own = await Promise.all(counties.map(async (t) => {
    try {
      const defs = await client.boundaryHierarchySearch(t.code, hierarchyType);
      return defs.some((d) => String((d as Record<string, unknown>).tenantId ?? t.code) === t.code);
    } catch { return false; /* no readable definition there: nothing overridden that we can show */ }
  }));
  return counties.filter((_, i) => own[i]).map((t) => ({ tenantId: t.code, name: t.name }));
}

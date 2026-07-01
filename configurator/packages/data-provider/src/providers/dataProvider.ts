import type { DataProvider, RaRecord, GetListResult, GetOneResult, GetManyResult, GetManyReferenceResult, CreateResult, UpdateResult, DeleteResult, Identifier } from 'ra-core';
import type { DigitApiClient } from '../client/DigitApiClient.js';
import type { MdmsRecord } from '../client/types.js';
import { getResourceConfig, type ResourceConfig } from './resourceRegistry.js';
import { migrateThemeConfigToV3 } from './themeConfigMigration.js';

/** Extended data provider type with DIGIT-specific custom methods */
export type DigitDataProvider = DataProvider & {
  /** Generate a formatted ID via the DIGIT idgen service */
  idgenGenerate: (idName: string, format?: string) => Promise<string>;
};

// --- Helpers ---

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function extractId(record: Record<string, unknown>, config: ResourceConfig): string {
  const value = getNestedValue(record, config.idField);
  return value == null ? '' : String(value);
}

function normalizeRecord(raw: Record<string, unknown>, config: ResourceConfig): RaRecord {
  return { ...raw, id: extractId(raw, config) } as RaRecord;
}

function normalizeMdmsRecord(mdms: MdmsRecord, config: ResourceConfig): RaRecord {
  let data = mdms.data || {};
  // Legacy ThemeConfig records (v1 nested / v2 semantic shapes) don't carry the
  // flat v3 keys the Theme editor binds to, so the form would load blank. Project
  // them into the v3 shape on read so the editor shows the live colors and saves
  // a clean record. Idempotent for records already in v3. See themeConfigMigration.
  if (config.schema === 'common-masters.ThemeConfig') {
    data = migrateThemeConfigToV3(data as Record<string, unknown>);
  }
  return {
    ...data,
    // Key by the MDMS uniqueIdentifier (genuinely unique per record) rather
    // than data[idField]. When two records share the idField value, data[idField]
    // collapses them to the same react-admin id, so every row opens the first record.
    // uniqueIdentifier is always distinct; fall back to data[idField] only
    // for legacy records that lack it.
    id: mdms.uniqueIdentifier || extractId(data, config),
    _uniqueIdentifier: mdms.uniqueIdentifier,
    _isActive: mdms.isActive,
    _auditDetails: mdms.auditDetails,
    _schemaCode: mdms.schemaCode,
    _mdmsId: mdms.id,
  } as RaRecord;
}

// --- Complaint-hierarchy leaf adapter -------------------------------------
//
// The 2-master complaint hierarchy stores BOTH interior classification nodes
// and leaf complaint types in one adjacency-list master
// (RAINMAKER-PGR.ComplaintHierarchy). A row is a LEAF iff it carries
// `department` or `slaHours` (interior nodes omit them). The dedicated
// complaint-type UI (List/Show/Edit/Create) and the complaint pickers still
// speak the legacy ServiceDefs vocabulary, so for the `leafServiceDefAdapter`
// resource we keep only the leaves and project each onto that shape here, at
// the data-access layer — downstream components stay unchanged.

function isLeafHierarchyRow(data: Record<string, unknown>): boolean {
  return data.department != null || data.slaHours != null;
}

/** Map one ComplaintHierarchy leaf row onto the legacy ServiceDefs shape.
 *  `parentNameByCode` resolves the parent node's display name for menuPathName;
 *  the leaf's own `code` IS the serviceCode stored verbatim on a complaint. */
function mapLeafToServiceDef(
  data: Record<string, unknown>,
  parentNameByCode: Map<string, string>,
): Record<string, unknown> {
  const parentCode = data.parentCode == null ? '' : String(data.parentCode);
  return {
    ...data,
    serviceCode: data.code,
    name: data.name,
    department: data.department,
    departments: data.departments,
    slaHours: data.slaHours,
    keywords: data.keywords,
    order: data.order,
    active: data.active,
    parentCode,
    // menuPath is NO LONGER a master field — it's derived from the tree:
    // group key = leaf.parentCode, group label = parent node's name.
    menuPath: parentCode,
    menuPathName: parentNameByCode.get(parentCode) ?? parentCode,
  };
}

/** Translate an inbound complaint-type form payload (legacy ServiceDefs
 *  vocabulary) into a ComplaintHierarchy LEAF row for writing. `serviceCode`
 *  becomes the row `code`; the adapter-only synthetic fields (menuPath /
 *  menuPathName / serviceCode) are dropped — grouping derives from parentCode.
 *  The metadata strip (id / `_*`) is left to the caller. */
function serviceDefToLeafWrite(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  // serviceCode -> code (the leaf's code IS the serviceCode stored on a complaint)
  if (out.serviceCode != null && out.code == null) out.code = out.serviceCode;
  delete out.serviceCode;
  // menuPath / menuPathName are adapter projections, never master fields.
  delete out.menuPath;
  delete out.menuPathName;
  return out;
}

/** Reduce a full ComplaintHierarchy record set to ServiceDefs-shaped leaf
 *  RaRecords (keyed by uniqueIdentifier == leaf code). */
function adaptHierarchyLeaves(records: MdmsRecord[], config: ResourceConfig): RaRecord[] {
  const parentNameByCode = new Map<string, string>();
  const hasChildren = new Set<string>();
  for (const r of records) {
    const d = (r.data || {}) as Record<string, unknown>;
    if (d.code != null && d.name != null) parentNameByCode.set(String(d.code), String(d.name));
    if (r.isActive && d.parentCode != null) hasChildren.add(String(d.parentCode));
  }
  // A row is a FILEABLE complaint type if it is a LEAF (carries department/SLA)
  // OR it is a TERMINAL node — nothing lists it as a parent. The terminal case
  // covers a branch that stops before the declared leaf level (e.g. 3 levels
  // declared but this SECTOR has no SUB_TYPE): its own `code` is a valid
  // serviceCode the backend accepts, so it must be pickable here too — matching
  // the citizen/employee create flows (which now submit the deepest node).
  const isFileableType = (d: Record<string, unknown>): boolean =>
    isLeafHierarchyRow(d) || !hasChildren.has(String(d.code));
  return records
    .filter((r) => r.isActive && isFileableType((r.data || {}) as Record<string, unknown>))
    .map((r) => {
      const adapted: MdmsRecord = {
        ...r,
        data: mapLeafToServiceDef((r.data || {}) as Record<string, unknown>, parentNameByCode),
      };
      return normalizeMdmsRecord(adapted, config);
    });
}

function clientSort(records: RaRecord[], field: string, order: string): RaRecord[] {
  return [...records].sort((a, b) => {
    const aVal = getNestedValue(a as unknown as Record<string, unknown>, field);
    const bVal = getNestedValue(b as unknown as Record<string, unknown>, field);
    const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''));
    return order === 'DESC' ? -cmp : cmp;
  });
}

// Internal filter key allowing a caller to pin a single getList to a tenant
// other than the session tenant (e.g. EmployeeCreate's dept/desig pickers,
// where the form lets the operator pick a target tenant that differs from
// the session ADMIN tenant).
const TENANT_OVERRIDE_KEY = '__tenantId';

function pickTenant(tenantId: string, filter?: Record<string, unknown>): string {
  const override = filter?.[TENANT_OVERRIDE_KEY];
  return typeof override === 'string' && override.trim() ? override.trim() : tenantId;
}

function clientFilter(records: RaRecord[], filter: Record<string, unknown>): RaRecord[] {
  if (!filter || Object.keys(filter).length === 0) return records;
  return records.filter((record) =>
    Object.entries(filter).every(([key, value]) => {
      // Internal control keys never participate in record-level filtering;
      // they're consumed by fetchers (e.g. mdmsGetList honours __tenantId).
      if (key === TENANT_OVERRIDE_KEY) return true;
      if (key === 'q' && typeof value === 'string') {
        const q = value.toLowerCase();
        return JSON.stringify(record).toLowerCase().includes(q);
      }
      const fieldVal = getNestedValue(record as unknown as Record<string, unknown>, key);
      return String(fieldVal ?? '').toLowerCase().includes(String(value).toLowerCase());
    }),
  );
}

function clientPaginate(records: RaRecord[], page: number, perPage: number): RaRecord[] {
  const start = (page - 1) * perPage;
  return records.slice(start, start + perPage);
}

// --- Service-specific fetchers ---

async function mdmsGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const tenant = pickTenant(tenantId, filter);
  const records = await client.mdmsSearch(tenant, config.schema!, { limit: 500 });
  if (config.leafServiceDefAdapter) return adaptHierarchyLeaves(records, config);
  return records.filter((r) => r.isActive).map((r) => normalizeMdmsRecord(r, config));
}

async function hrmsGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  // First try searching the given tenant
  const employees = await client.employeeSearch(tenantId, { limit: 500 });
  if (employees.length > 0) return employees.map((e) => normalizeRecord(e, config));

  // If root tenant returned 0 results, search all city-level sub-tenants
  if (!tenantId.includes('.')) {
    const tenantRecords = await client.mdmsSearch(tenantId, 'tenant.tenants', { limit: 200 });
    const cityTenants = tenantRecords
      .filter((r) => r.isActive && r.data?.code && String(r.data.code).startsWith(`${tenantId}.`))
      .map((r) => String(r.data.code));

    if (cityTenants.length > 0) {
      const results = await Promise.all(
        cityTenants.map((ct) => client.employeeSearch(ct, { limit: 500 }).catch(() => []))
      );
      const allEmployees = results.flat();
      return allEmployees.map((e) => normalizeRecord(e, config));
    }
  }

  return [];
}

// Fetch ONE employee with the same child-tenant fallback hrmsGetList uses.
// When logged in at the state tenant (e.g. `ke`), employees live under city
// tenants (`ke.ige`); searching only the session tenant misses them, so the
// Show/Edit pages couldn't load the employee or its jurisdictions.
async function hrmsFindOne(
  client: DigitApiClient,
  tenantId: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const searchAt = async (t: string) => {
    let r = await client.employeeSearch(t, { uuids: [id] });
    if (!r.length) r = await client.employeeSearch(t, { codes: [id] });
    return r[0];
  };
  const direct = await searchAt(tenantId);
  if (direct) return direct;
  if (!tenantId.includes('.')) {
    const tenantRecords = await client.mdmsSearch(tenantId, 'tenant.tenants', { limit: 200 });
    const cityTenants = tenantRecords
      .filter((r) => r.isActive && r.data?.code && String(r.data.code).startsWith(`${tenantId}.`))
      .map((r) => String(r.data.code));
    for (const ct of cityTenants) {
      const hit = await searchAt(ct).catch(() => undefined);
      if (hit) return hit;
    }
  }
  return undefined;
}

async function boundaryGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  // The boundary-relationships endpoint repeats each child node under its
  // parent in the payload, so a naive flatten emits the same code many times
  // (a 22-boundary tree rendered as 300+ duplicate rows). Dedup by code as we
  // walk — same fix boundary.ts's searchBoundaries already applies. The set is
  // shared across every hierarchy/tenant tree so a code seeded under two
  // hierarchies still shows once.
  function flattenTrees(trees: Record<string, unknown>[], seen: Set<string>): RaRecord[] {
    const flat: RaRecord[] = [];
    function flatten(
      nodes: unknown[],
      parentCode: string | undefined,
      treeTenantId: string | undefined,
      treeHierarchyType: string | undefined,
    ) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes as Record<string, unknown>[]) {
        const code = typeof node.code === 'string' ? node.code : undefined;
        if (code && !seen.has(code)) {
          seen.add(code);
          // Stamp tenantId + hierarchyType on every flattened node from its
          // enclosing tree wrapper. Downstream editors (JurisdictionEditor)
          // use these to scope jurisdiction rows to the boundary's home
          // tenant, not the session tenant.
          flat.push(
            normalizeRecord(
              {
                ...node,
                parentCode,
                tenantId: (node.tenantId as string | undefined) ?? treeTenantId,
                hierarchyType: (node.hierarchyType as string | undefined) ?? treeHierarchyType,
              },
              config,
            ),
          );
        }
        if (Array.isArray(node.children)) {
          flatten(node.children as unknown[], code, treeTenantId, treeHierarchyType);
        }
      }
    }
    for (const tree of trees) {
      const treeTenant = typeof tree.tenantId === 'string' ? tree.tenantId : undefined;
      const treeHierarchy = typeof tree.hierarchyType === 'string' ? tree.hierarchyType : undefined;
      flatten((tree.boundary || []) as unknown[], undefined, treeTenant, treeHierarchy);
    }
    return flat;
  }

  // Fetch the boundary tree for EVERY hierarchy type defined on the tenant —
  // not just "ADMIN". Boundaries can be seeded under any hierarchy (e.g. Maputo
  // uses "Divisão Administrativa", so an "ADMIN"-only query returned an empty
  // tree and left the Boundary picker blank). Falls back to "ADMIN" when no
  // hierarchy definitions are found.
  async function flatForTenant(t: string): Promise<RaRecord[]> {
    const hierarchies = await client.boundaryHierarchySearch(t).catch(() => []);
    const hierarchyTypes = (hierarchies as Record<string, unknown>[])
      .map((h) => (typeof h.hierarchyType === 'string' ? h.hierarchyType : ''))
      .filter(Boolean);
    const types = hierarchyTypes.length > 0 ? hierarchyTypes : ['ADMIN'];
    const treeLists = await Promise.all(
      types.map((ht) => client.boundaryRelationshipSearch(t, ht).catch(() => [])),
    );
    const seen = new Set<string>();
    return treeLists.flatMap((trees) => flattenTrees(trees as Record<string, unknown>[], seen));
  }

  // Always fetch the session tenant's tree(s) first.
  const rootFlat = await flatForTenant(tenantId);

  // When the session is at state level, aggregate city sub-tenants too — a
  // seeded BOMET tree at `ke` would otherwise hide NAIROBI_CITY at
  // `ke.nairobi` (and peers). Each tenant's tree is concatenated; duplicates
  // are avoided because tenants own disjoint boundary code-spaces.
  if (!tenantId.includes('.')) {
    const tenantRecords = await client.mdmsSearch(tenantId, 'tenant.tenants', { limit: 200 });
    const cityTenants = tenantRecords
      .filter((r) => r.isActive && r.data?.code && String(r.data.code).startsWith(`${tenantId}.`))
      .map((r) => String(r.data.code));

    if (cityTenants.length > 0) {
      const cityFlatLists = await Promise.all(cityTenants.map((ct) => flatForTenant(ct)));
      const cityFlat = cityFlatLists.flat();
      if (cityFlat.length > 0) return [...rootFlat, ...cityFlat];
    }
  }

  return rootFlat;
}

async function pgrGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const options: { status?: string; limit?: number } = { limit: 100 };
  if (filter?.status) options.status = String(filter.status);
  const wrappers = await client.pgrSearch(tenantId, options);
  return wrappers.map((w) => {
    const service = (w.service || w) as Record<string, unknown>;
    return normalizeRecord(service, config);
  });
}

async function localizationGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  // Side-by-side pivot of two locales. The list view picks the locales via
  // dropdowns and passes them as `locale` (left column) and `locale2` (right
  // column). localeB is empty until the user explicitly picks a second locale
  // so the right column starts as all-missing rather than defaulting to a
  // hardcoded locale that may not exist on the tenant.
  const module = filter?.module ? String(filter.module) : undefined;
  const localeA = filter?.locale ? String(filter.locale) : 'en_IN';
  const localeB = filter?.locale2 ? String(filter.locale2) : '';
  const [aMsgs, bMsgs] = await Promise.all([
    client.localizationSearch(tenantId, localeA, module),
    localeB && localeB !== localeA ? client.localizationSearch(tenantId, localeB, module) : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  // Pivot keyed by `${code}__${module}` so a code that appears under
  // multiple modules doesn't get collapsed (real DIGIT data does this).
  const pivot = new Map<string, Record<string, unknown>>();
  const upsert = (m: Record<string, unknown>, side: 'A' | 'B') => {
    const code = String(m.code ?? '');
    const mod = String(m.module ?? '');
    const key = `${code}__${mod}`;
    let row = pivot.get(key);
    if (!row) {
      row = { id: key, code, module: mod, message: '', message2: '', locale: localeA, locale2: localeB };
      pivot.set(key, row);
    }
    if (side === 'A') row.message = String(m.message ?? '');
    else row.message2 = String(m.message ?? '');
  };
  for (const m of aMsgs) upsert(m as Record<string, unknown>, 'A');
  for (const m of bMsgs) upsert(m as Record<string, unknown>, 'B');
  return Array.from(pivot.values()).map((r) => normalizeRecord(r, config));
}

async function userGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const opts: { userName?: string; mobileNumber?: string; uuid?: string[]; roleCodes?: string[]; userType?: string; limit: number } = { limit: 100 };
  // `q` is a single-input "quick search". Digits (optionally +/0-prefixed, with spaces or
  // dashes) route to mobileNumber; anything else routes to userName. Explicit field
  // filters below can still override if both are present.
  const q = typeof filter?.q === 'string' ? filter.q.trim() : '';
  if (q) {
    if (/^[+\d][\d\s-]*$/.test(q)) opts.mobileNumber = q.replace(/[\s-]/g, '');
    else opts.userName = q;
  }
  if (!opts.userName && filter?.userName) opts.userName = String(filter.userName);
  if (!opts.mobileNumber && filter?.mobileNumber) opts.mobileNumber = String(filter.mobileNumber);
  if (filter?.userType) opts.userType = String(filter.userType);
  if (filter?.roleCodes) opts.roleCodes = filter.roleCodes as string[];
  if (filter?.uuid) opts.uuid = Array.isArray(filter.uuid) ? filter.uuid as string[] : [String(filter.uuid)];
  // DIGIT user search requires at least one filter; default to CITIZEN role
  if (!opts.userName && !opts.mobileNumber && !opts.userType && !opts.roleCodes && !opts.uuid) {
    opts.roleCodes = ['CITIZEN'];
  }
  const users = await client.userSearch(tenantId, opts);
  return users.map((u) => normalizeRecord(u, config));
}

async function workflowBsGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const codes = filter?.businessServices ? filter.businessServices as string[] : ['PGR'];
  const services = await client.workflowBusinessServiceSearch(tenantId, codes);
  return services.map((s) => normalizeRecord(s, config));
}

async function workflowProcessGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const businessIds = filter?.businessId ? [String(filter.businessId)] : undefined;
  if (businessIds) {
    const processes = await client.workflowProcessSearch(tenantId, businessIds, { limit: 100 });
    return processes.map((p) => normalizeRecord(p, config));
  }
  // No filter — fetch recent PGR complaints and search workflow at each city tenant
  try {
    const wrappers = await client.pgrSearch(tenantId, { limit: 50 });
    if (wrappers.length === 0) return [];

    // Group complaint IDs by their tenant
    const byTenant = new Map<string, string[]>();
    for (const w of wrappers) {
      const svc = (w.service || w) as Record<string, unknown>;
      const id = svc.serviceRequestId as string;
      const t = (svc.tenantId as string) || tenantId;
      if (!id) continue;
      const arr = byTenant.get(t) || [];
      arr.push(id);
      byTenant.set(t, arr);
    }

    // Search workflow processes at each city tenant in parallel
    const results = await Promise.all(
      Array.from(byTenant.entries()).map(([t, ids]) =>
        client.workflowProcessSearch(t, ids, { limit: 200 }).catch(() => [])
      )
    );
    return results.flat().map((p) => normalizeRecord(p, config));
  } catch {
    return [];
  }
}

async function accessRoleGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const roles = await client.accessRolesSearch(tenantId);
  return roles.map((r) => normalizeRecord(r, config));
}

async function accessActionGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const roleCodes = filter?.roleCodes
    ? (filter.roleCodes as string[])
    : ['CITIZEN', 'EMPLOYEE', 'GRO', 'CSR'];
  const actions = await client.accessActionsSearch(tenantId, roleCodes);
  return actions.map((a) => normalizeRecord(a, config));
}

async function mdmsSchemaGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const schemas = await client.mdmsSchemaSearch(tenantId);
  return schemas.map((s) => normalizeRecord(s, config));
}

async function boundaryHierarchyGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  // Fetch the session tenant's hierarchies first. When at state level,
  // aggregate city-tenant hierarchies too — the boundary service stores each
  // tenant's definition separately (no cross-tenant inheritance) so a
  // ke.nairobi ADMIN hierarchy is invisible from a ke session otherwise.
  const rootHierarchies = await client.boundaryHierarchySearch(tenantId).catch(() => []);
  let all = rootHierarchies;
  if (!tenantId.includes('.')) {
    const tenantRecords = await client.mdmsSearch(tenantId, 'tenant.tenants', { limit: 200 });
    const cityTenants = tenantRecords
      .filter((r) => r.isActive && r.data?.code && String(r.data.code).startsWith(`${tenantId}.`))
      .map((r) => String(r.data.code));
    if (cityTenants.length > 0) {
      const cityResults = await Promise.all(
        cityTenants.map((ct) => client.boundaryHierarchySearch(ct).catch(() => [])),
      );
      all = [...rootHierarchies, ...cityResults.flat()];
    }
  }
  return all.map((h) => normalizeRecord(h, config));
}

// --- Factory ---

export function createDigitDataProvider(client: DigitApiClient, tenantId: string): DigitDataProvider {
  function resolveConfig(resource: string): ResourceConfig {
    const config = getResourceConfig(resource);
    if (!config) throw new Error(`Unknown resource: ${resource}`);
    return config;
  }

  async function fetchAll(resource: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
    const config = resolveConfig(resource);
    switch (config.type) {
      case 'mdms': return mdmsGetList(client, config, tenantId, filter);
      case 'hrms': return hrmsGetList(client, config, tenantId);
      case 'boundary': return boundaryGetList(client, config, tenantId);
      case 'pgr': return pgrGetList(client, config, tenantId, filter);
      case 'localization': return localizationGetList(client, config, tenantId, filter);
      case 'user': return userGetList(client, config, tenantId, filter);
      case 'workflow-bs': return workflowBsGetList(client, config, tenantId, filter);
      case 'workflow-process': return workflowProcessGetList(client, config, tenantId, filter);
      case 'access-role': return accessRoleGetList(client, config, tenantId);
      case 'access-action': return accessActionGetList(client, config, tenantId, filter);
      case 'mdms-schema': return mdmsSchemaGetList(client, config, tenantId);
      case 'boundary-hierarchy': return boundaryHierarchyGetList(client, config, tenantId);
      default: throw new Error(`Unsupported resource type: ${config.type}`);
    }
  }

  const provider: DigitDataProvider = {
    async getList(resource, params): Promise<GetListResult> {
      const { page = 1, perPage = 25 } = params.pagination ?? {};
      const { field = 'id', order = 'ASC' } = params.sort ?? {};

      // PGR complaints: push pagination + server-supported filters to the
      // API. The old behavior pulled the first 100 records and paginated
      // client-side, which silently truncated larger tenants. `_count`
      // returns the real total so react-admin's paginator stays honest.
      const config = resolveConfig(resource);
      if (config.type === 'pgr') {
        const filter = (params.filter ?? {}) as Record<string, unknown>;
        const status = filter.applicationStatus ?? filter.status;
        const fromDate = typeof filter.fromDate === 'number' ? filter.fromDate : undefined;
        const toDate = typeof filter.toDate === 'number' ? filter.toDate : undefined;
        const department =
          typeof filter['additionalDetail.department'] === 'string'
            ? filter['additionalDetail.department']
            : typeof filter.department === 'string'
            ? filter.department
            : undefined;
        const q = typeof filter.q === 'string' ? filter.q.trim() : undefined;

        // PGR's RequestSearchCriteria.SortBy is a restricted Java enum
        // (locality | applicationStatus | serviceRequestId). Anything else
        // fails Jackson deserialization with a 500. Map our column sources
        // onto the enum and drop sortBy otherwise — the server's default
        // ORDER BY ser_createdtime kicks in, which is what the "Created"
        // column wants anyway.
        const pgrSortByMap: Record<string, string> = {
          serviceRequestId: 'serviceRequestId',
          applicationStatus: 'applicationStatus',
          'address.locality.code': 'locality',
          locality: 'locality',
        };
        const pgrSortBy = pgrSortByMap[field];

        const searchOpts = {
          status: typeof status === 'string' ? status : undefined,
          fromDate,
          toDate,
          ...(pgrSortBy ? { sortBy: pgrSortBy, sortOrder: order } : { sortOrder: order }),
          limit: perPage,
          offset: (page - 1) * perPage,
        };
        const [wrappers, total] = await Promise.all([
          client.pgrSearch(tenantId, searchOpts),
          client.pgrCount(tenantId, { status: searchOpts.status, fromDate, toDate }),
        ]);
        let records = wrappers.map((w) => {
          const service = (w.service || w) as Record<string, unknown>;
          return normalizeRecord(service, config);
        });
        // Client-side filters for fields the server's criteria don't cover.
        if (department) {
          records = records.filter((r) => {
            const d = (r as Record<string, unknown>).additionalDetail as
              | Record<string, unknown>
              | undefined;
            return d?.department === department;
          });
        }
        if (q) {
          const needle = q.toLowerCase();
          records = records.filter((r) => {
            const rec = r as Record<string, unknown>;
            return (
              String(rec.serviceRequestId ?? '').toLowerCase().includes(needle) ||
              String(rec.description ?? '').toLowerCase().includes(needle)
            );
          });
        }
        return { data: records, total };
      }

      // MDMS resources without the leaf-adapter (all schemas except
      // complaint-hierarchy): push limit/offset to the server when no
      // client-side filter is active so the API is called with the actual
      // page size instead of a fixed 500. MDMS v2 does not return a total
      // count, so we use a heuristic: a full page means "there may be more"
      // (next button enabled), a partial page means "last page".
      if (config.type === 'mdms' && !config.leafServiceDefAdapter) {
        const filter = (params.filter ?? {}) as Record<string, unknown>;
        const hasClientFilter = Object.keys(filter).some((k) => k !== TENANT_OVERRIDE_KEY);
        if (!hasClientFilter) {
          const tenant = pickTenant(tenantId, filter);
          const offset = (page - 1) * perPage;
          const raw = await client.mdmsSearch(tenant, config.schema!, { limit: perPage, offset });
          const data = raw.filter((r) => r.isActive).map((r) => normalizeMdmsRecord(r, config));
          const sorted = clientSort(data, field, order);
          const total = raw.length >= perPage ? offset + perPage + 1 : offset + data.length;
          return { data: sorted, total };
        }
      }

      const all = await fetchAll(resource, params.filter);
      const filtered = clientFilter(all, params.filter);
      const sorted = clientSort(filtered, field, order);
      const data = clientPaginate(sorted, page, perPage);
      return { data, total: filtered.length };
    },

    async getOne(resource, params): Promise<GetOneResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        // Leaf-adapter resources need the full record set to resolve a leaf's
        // menuPathName (its parent node's name), so always go through the
        // adapted list path rather than the single-uid fast path.
        if (config.leafServiceDefAdapter) {
          const all = await mdmsGetList(client, config, tenantId);
          const found = all.find((r) => String(r.id) === String(params.id));
          if (!found) throw new Error(`Record not found: ${params.id}`);
          return { data: found };
        }
        // Try uniqueIdentifier lookup first (fast path for records we created)
        const records = await client.mdmsSearch(tenantId, config.schema!, { uniqueIdentifiers: [String(params.id)] });
        const active = records.filter((r) => r.isActive);
        if (active.length) return { data: normalizeMdmsRecord(active[0], config) };
        // Fall back to fetching all and matching by id field (handles hash-based UIDs)
        const all = await mdmsGetList(client, config, tenantId);
        const found = all.find((r) => String(r.id) === String(params.id));
        if (!found) throw new Error(`Record not found: ${params.id}`);
        return { data: found };
      }
      if (config.type === 'hrms') {
        // Search the session tenant, then fall back to child tenants (mirrors
        // hrmsGetList) so a state-tenant admin can open a city-tenant employee
        // with its full record — assignments + jurisdictions included.
        const found = await hrmsFindOne(client, tenantId, String(params.id));
        if (!found) throw new Error(`Employee not found: ${params.id}`);
        return { data: normalizeRecord(found, config) };
      }
      if (config.type === 'pgr') {
        const wrappers = await client.pgrSearch(tenantId, { serviceRequestId: String(params.id) });
        if (!wrappers.length) throw new Error(`Complaint not found: ${params.id}`);
        const service = (wrappers[0].service || wrappers[0]) as Record<string, unknown>;
        return { data: normalizeRecord(service, config) };
      }
      if (config.type === 'user') {
        const users = await client.userSearch(tenantId, { uuid: [String(params.id)] });
        if (!users.length) throw new Error(`User not found: ${params.id}`);
        return { data: normalizeRecord(users[0], config) };
      }
      if (config.type === 'workflow-bs') {
        const services = await client.workflowBusinessServiceSearch(tenantId, [String(params.id)]);
        if (!services.length) throw new Error(`Workflow business service not found: ${params.id}`);
        return { data: normalizeRecord(services[0], config) };
      }
      if (config.type === 'boundary') {
        // Search entity table directly to get full data (additionalDetails, geometry, auditDetails)
        const entities = await client.boundarySearch(tenantId, [String(params.id)]);
        if (entities.length) {
          // Return entity data directly — avoids expensive fetchAll sub-tenant scan
          return { data: normalizeRecord(entities[0] as Record<string, unknown>, config) };
        }
        // Fall back to tree-only data (triggers sub-tenant aggregation)
        const all = await fetchAll(resource);
        const found = all.find((r) => String(r.id) === String(params.id));
        if (!found) throw new Error(`Record not found: ${params.id}`);
        return { data: found };
      }
      const all = await fetchAll(resource);
      const found = all.find((r) => String(r.id) === String(params.id));
      if (!found) throw new Error(`Record not found: ${params.id}`);
      return { data: found };
    },

    async getMany(resource, params): Promise<GetManyResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        // Leaf-adapter resources must be filtered/mapped from the full set
        // (menuPathName needs sibling parent nodes), so skip the uid fast path.
        if (!config.leafServiceDefAdapter) {
          // Try uniqueIdentifier lookup first (fast path)
          const records = await client.mdmsSearch(tenantId, config.schema!, {
            uniqueIdentifiers: params.ids.map(String),
          });
          const found = records.filter((r) => r.isActive).map((r) => normalizeMdmsRecord(r, config));
          if (found.length === params.ids.length) return { data: found };
        }
        // Fall back to fetching all and matching by id field (handles hash-based UIDs)
        const all = await mdmsGetList(client, config, tenantId);
        const ids = new Set(params.ids.map(String));
        return { data: all.filter((r) => ids.has(String(r.id))) };
      }
      const all = await fetchAll(resource);
      const ids = new Set(params.ids.map(String));
      return { data: all.filter((r) => ids.has(String(r.id))) };
    },

    async getManyReference(resource, params): Promise<GetManyReferenceResult> {
      // Pass reference target as filter (needed for resources like workflow-processes that require server-side filtering)
      const refFilter = { ...params.filter, [params.target]: params.id };
      const all = await fetchAll(resource, refFilter);
      const filtered = all.filter((r) => {
        const val = getNestedValue(r as unknown as Record<string, unknown>, params.target);
        return String(val) === String(params.id);
      });
      const sorted = clientSort(filtered, params.sort.field, params.sort.order);
      const { page, perPage } = params.pagination;
      const data = clientPaginate(sorted, page, perPage);
      return { data, total: filtered.length };
    },

    async create(resource, params): Promise<CreateResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        const incoming = config.leafServiceDefAdapter
          ? serviceDefToLeafWrite(params.data as Record<string, unknown>)
          : (params.data as Record<string, unknown>);
        // Same metadata-strip the update path applies (PR #40). The
        // create path didn't have it, so any defaultRecord that included
        // `id` (some forms set id == code on create) or any normalised
        // `_*` field would pass straight through to mdmsCreate and
        // get rejected by additionalProperties:false schemas.
        const data: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(incoming)) {
          if (key === 'id') continue;
          if (key.startsWith('_')) continue;
          data[key] = value;
        }
        if (config.schema === 'tenant.citymodule' && !Array.isArray(data.tenants)) {
          data.tenants = [{ code: tenantId }];
        }
        const uid = String(incoming[config.idField] || data.code || '');
        const record = await client.mdmsCreate(tenantId, config.schema!, uid, data);
        return { data: config.leafServiceDefAdapter
          ? (await mdmsGetList(client, config, tenantId)).find((r) => String(r.id) === uid)
            ?? normalizeMdmsRecord(record, config)
          : normalizeMdmsRecord(record, config) };
      }
      if (config.type === 'hrms') {
        const data = params.data as Record<string, unknown>;
        // Prefer the form-selected tenantId over the session tenant so a
        // root-`ke` admin can create an employee directly at `ke.nairobi`
        // (closes egovernments/CCRS#416). Falls back to the session tenant
        // when the form omits it — non-root logins keep today's behavior.
        const targetTenantId =
          typeof data.tenantId === 'string' && data.tenantId.trim()
            ? data.tenantId.trim()
            : tenantId;
        const [employee] = await client.employeeCreate(targetTenantId, [data]);
        return { data: normalizeRecord(employee, config) };
      }
      if (config.type === 'pgr') {
        const data = params.data as Record<string, unknown>;
        // Stamp address.tenantId from the session tenant. Live PGR records
        // always carry address.tenantId (never address.city, which is nullable
        // and unused downstream). Operators don't fill this manually.
        const formAddress = (data.address as Record<string, unknown> | undefined) ?? {};
        const address: Record<string, unknown> = { ...formAddress, tenantId };
        if (!address.locality && typeof data['address.locality.code'] === 'string') {
          address.locality = { code: data['address.locality.code'] };
        }
        const wrapper = await client.pgrCreate(
          tenantId,
          String(data.serviceCode),
          String(data.description || ''),
          address,
          data.citizen as Record<string, unknown> | undefined,
        );
        const service = ((wrapper as Record<string, unknown>).service || wrapper) as Record<string, unknown>;
        return { data: normalizeRecord(service, config) };
      }
      if (config.type === 'localization') {
        const data = params.data as Record<string, unknown>;
        const messages = await client.localizationUpsert(tenantId, String(data.locale || 'en_IN'), [
          { code: String(data.code), message: String(data.message), module: String(data.module) },
        ]);
        if (messages.length) return { data: normalizeRecord(messages[0], config) };
        return { data: { ...data, id: String(data.code) } as RaRecord };
      }
      if (config.type === 'boundary') {
        const data = params.data as Record<string, unknown>;
        const code = String(data.code);
        const boundaryType = String(data.boundaryType || 'Locality');
        const hierarchyType = String(data.hierarchyType || 'ADMIN');
        const parent = data.parent ? String(data.parent) : null;
        // Create the boundary entity (publishes to Kafka for async persistence)
        await client.boundaryCreate(tenantId, [{ code }]);
        // Retry relationship create — entity may not be persisted yet (Kafka async)
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await client.boundaryRelationshipCreate(tenantId, code, hierarchyType, boundaryType, parent);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err as Error;
            if (lastErr.message?.includes('does not exist') && attempt < 4) {
              await new Promise((r) => setTimeout(r, 500));
              continue;
            }
            throw err;
          }
        }
        if (lastErr) throw lastErr;
        return { data: { ...data, id: code, code, boundaryType } as RaRecord };
      }
      if (config.type === 'user') {
        const data = params.data as Record<string, unknown>;
        const user = await client.userCreate(data, tenantId);
        return { data: normalizeRecord(user, config) };
      }
      if (config.type === 'boundary-hierarchy') {
        const data = params.data as Record<string, unknown>;
        const hierarchyType = String(data.hierarchyType ?? '').trim();
        if (!hierarchyType) throw new Error('hierarchyType is required');
        const targetTenantId =
          typeof data.tenantId === 'string' && data.tenantId.trim()
            ? data.tenantId.trim()
            : tenantId;
        const levelsInput = Array.isArray(data.boundaryHierarchy) ? data.boundaryHierarchy : [];
        const levels = levelsInput
          .map((lvl) => lvl as Record<string, unknown>)
          .filter((lvl) => typeof lvl?.boundaryType === 'string' && (lvl.boundaryType as string).trim())
          .map((lvl) => ({
            boundaryType: String(lvl.boundaryType).trim(),
            parentBoundaryType:
              typeof lvl.parentBoundaryType === 'string' && lvl.parentBoundaryType.trim()
                ? lvl.parentBoundaryType.trim()
                : null,
          }));
        if (levels.length === 0) throw new Error('At least one hierarchy level is required');
        const created = await client.boundaryHierarchyCreate(
          targetTenantId,
          hierarchyType,
          levels,
        );
        return { data: normalizeRecord(created, config) };
      }
      throw new Error(`Create not supported for resource type: ${config.type}`);
    },

    async update(resource, params): Promise<UpdateResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        const records = await client.mdmsSearch(tenantId, config.schema!, { uniqueIdentifiers: [String(params.id)] });
        const existing = records.find((r) => r.isActive);
        if (!existing) throw new Error(`Record not found: ${params.id}`);
        // Strip the metadata that normalizeMdmsRecord glued onto the
        // record for react-admin's benefit (id, _isActive, _mdmsId,
        // _uniqueIdentifier, _auditDetails, _schemaCode, anything starting
        // with _). MDMS schemas declare additionalProperties:false, so
        // any of these fields makes the _update payload fail with
        // INVALID_REQUEST_ADDITIONALPROPERTIES* (closes
        // egovernments/CCRS#472 — Department update).
        const incoming = config.leafServiceDefAdapter
          ? serviceDefToLeafWrite(params.data as Record<string, unknown>)
          : (params.data as Record<string, unknown>);
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(incoming)) {
          if (key === 'id') continue;
          if (key.startsWith('_')) continue;
          sanitized[key] = value;
        }
        existing.data = { ...existing.data, ...sanitized };
        const updated = await client.mdmsUpdate(existing, true);
        if (config.leafServiceDefAdapter) {
          const all = await mdmsGetList(client, config, tenantId);
          const found = all.find((r) => String(r.id) === String(params.id));
          if (found) return { data: found };
        }
        return { data: normalizeMdmsRecord(updated, config) };
      }
      if (config.type === 'hrms') {
        // normalizeRecord overwrote the native numeric `id` with the
        // uuid string (idField: 'uuid') so react-admin can route by it,
        // but HRMS's Employee POJO has `id: Long` — sending a string
        // back makes Jackson throw JsonMappingException (closes #439).
        // Re-fetch the server record, strip the react-admin `id`, and
        // merge the form payload onto it so the native Long id (plus
        // any nested arrays the form never rendered) round-trip intact.
        const data = params.data as Record<string, unknown>;
        const uuid = typeof data.uuid === 'string' && data.uuid
          ? data.uuid
          : String(params.id);
        // Prefer the record's tenantId over the session tenant — lets a
        // root-`ke` admin edit an employee that actually lives at
        // `ke.nairobi` (closes egovernments/CCRS#416). Falls back to the
        // session tenant when the record omits it.
        const targetTenantId =
          typeof data.tenantId === 'string' && data.tenantId.trim()
            ? data.tenantId.trim()
            : tenantId;
        const fetched = await client.employeeSearch(targetTenantId, { uuids: [uuid] });
        if (!fetched.length) throw new Error(`Employee not found: ${uuid}`);
        const base = fetched[0] as Record<string, unknown>;
        const { id: _stringId, ...rest } = data;
        void _stringId;
        const merged: Record<string, unknown> = { ...base, ...rest };
        const [employee] = await client.employeeUpdate(targetTenantId, [merged]);
        return { data: normalizeRecord(employee, config) };
      }
      if (config.type === 'pgr') {
        const data = params.data as Record<string, unknown>;
        const action = String(data.action || data._action || 'ASSIGN');
        // Fetch current service state — PGR update needs the full object
        // (auditDetails round-trip, internal UUID, etc.).
        const wrappers = await client.pgrSearch(tenantId, { serviceRequestId: String(params.id) });
        if (!wrappers.length) throw new Error(`Complaint not found: ${params.id}`);
        const service = ((wrappers[0] as Record<string, unknown>).service || wrappers[0]) as Record<string, unknown>;

        // Merge form edits onto the fetched service so description / serviceCode
        // / source / address changes actually persist. Previously these were
        // silently dropped — the update path sent the fetched service verbatim
        // and only the workflow action, comment, assignees, and rating survived.
        const editableTop = ['serviceCode', 'description', 'source', 'additionalDetail'];
        for (const key of editableTop) {
          if (key in data) service[key] = data[key];
        }
        if (data.address && typeof data.address === 'object') {
          service.address = {
            ...(service.address as Record<string, unknown> | undefined ?? {}),
            ...(data.address as Record<string, unknown>),
          };
        }

        // Normalize assignees: accept a single string (from form select) or an array
        let assignees: string[] | undefined;
        if (data.assignee) {
          assignees = [String(data.assignee)];
        } else if (Array.isArray(data.assignees)) {
          assignees = data.assignees as string[];
        }
        const updated = await client.pgrUpdate(service, action, {
          comment: data.comment as string | undefined,
          assignees,
          rating: data.rating != null ? Number(data.rating) : undefined,
        });
        const updatedService = ((updated as Record<string, unknown>).service || updated) as Record<string, unknown>;
        return { data: normalizeRecord(updatedService, config) };
      }
      if (config.type === 'localization') {
        // Inline-edit on the pivoted list emits a single row with both
        // `message` (locale A) and `message2` (locale B). Diff against
        // previousData to know which side actually changed and upsert only
        // that locale — saves a round-trip and avoids accidentally clobbering
        // the other side with a stale value.
        const data = params.data as Record<string, unknown>;
        const prev = (params.previousData ?? {}) as Record<string, unknown>;
        const code = String(data.code || params.id);
        const mod = String(data.module ?? '');
        const localeA = String(data.locale ?? 'en_IN');
        const localeB = String(data.locale2 ?? '');
        const writes: Promise<unknown>[] = [];
        if (data.message !== undefined && data.message !== prev.message) {
          writes.push(client.localizationUpsert(tenantId, localeA, [
            { code, message: String(data.message ?? ''), module: mod },
          ]));
        }
        if (localeB && data.message2 !== undefined && data.message2 !== prev.message2) {
          writes.push(client.localizationUpsert(tenantId, localeB, [
            { code, message: String(data.message2 ?? ''), module: mod },
          ]));
        }
        // Legacy non-pivot callers (Show/Edit individual record pages) only
        // send `message` + `locale` — the first branch handles them.
        if (writes.length === 0 && data.message !== undefined) {
          writes.push(client.localizationUpsert(tenantId, localeA, [
            { code, message: String(data.message), module: mod },
          ]));
        }
        await Promise.all(writes);
        return { data: { ...data, id: String(data.id ?? `${code}__${mod}`) } as RaRecord };
      }
      if (config.type === 'boundary') {
        const data = params.data as Record<string, unknown>;
        const code = String(data.code || params.id);
        // Fetch existing boundary to get auditDetails (required by _update)
        const existing = await client.boundarySearch(tenantId, [code]);
        const current = existing.length ? existing[0] as Record<string, unknown> : {};
        const merged: Record<string, unknown> = { ...current, code };
        if (data.additionalDetails !== undefined) merged.additionalDetails = data.additionalDetails;
        if (data.geometry !== undefined) merged.geometry = data.geometry;
        const updated = await client.boundaryUpdate(tenantId, [merged]);
        if (updated.length) return { data: normalizeRecord(updated[0], config) };
        return { data: { ...data, id: code } as RaRecord };
      }
      throw new Error(`Update not supported for resource type: ${config.type}`);
    },

    async updateMany(resource, params): Promise<{ data: Identifier[] }> {
      const results: Identifier[] = [];
      for (const id of params.ids) {
        await provider.update(resource, { id, data: params.data, previousData: {} as RaRecord });
        results.push(id);
      }
      return { data: results };
    },

    async delete(resource, params): Promise<DeleteResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        const records = await client.mdmsSearch(tenantId, config.schema!, { uniqueIdentifiers: [String(params.id)] });
        const existing = records.find((r) => r.isActive);
        if (!existing) throw new Error(`Record not found: ${params.id}`);
        await client.mdmsUpdate(existing, false);
        return { data: normalizeMdmsRecord(existing, config) };
      }
      if (config.type === 'hrms') {
        // Prefer the record's tenantId over the session tenant so a
        // root-`ke` admin can deactivate an employee that lives at
        // `ke.nairobi` (closes egovernments/CCRS#416). Pulled off
        // previousData because react-admin's delete payload is just
        // the id; falls back to the session tenant otherwise.
        const prev = (params as { previousData?: Record<string, unknown> }).previousData ?? {};
        const targetTenantId =
          typeof prev.tenantId === 'string' && prev.tenantId.trim()
            ? prev.tenantId.trim()
            : tenantId;
        // Search by UUID first (idField is 'uuid'), fall back to codes
        let results = await client.employeeSearch(targetTenantId, { uuids: [String(params.id)] });
        if (!results.length) results = await client.employeeSearch(targetTenantId, { codes: [String(params.id)] });
        if (!results.length) throw new Error(`Employee not found: ${params.id}`);
        let emp = results[0] as Record<string, unknown>;
        // If user is null (UUID search may omit user), re-fetch by code to get full object
        if (!emp.user && emp.code) {
          const byCode = await client.employeeSearch(targetTenantId, { codes: [emp.code as string] });
          if (byCode.length) emp = byCode[0] as Record<string, unknown>;
        }
        emp.isActive = false;
        emp.deactivationDetails = [{ reasonForDeactivation: 'OTHERS', effectiveFrom: Date.now() }];
        const [updated] = await client.employeeUpdate(targetTenantId, [emp]);
        return { data: normalizeRecord(updated, config) };
      }
      if (config.type === 'pgr') {
        // "Delete" a complaint by rejecting it via workflow
        const wrappers = await client.pgrSearch(tenantId, { serviceRequestId: String(params.id) });
        if (!wrappers.length) throw new Error(`Complaint not found: ${params.id}`);
        const service = ((wrappers[0] as Record<string, unknown>).service || wrappers[0]) as Record<string, unknown>;
        const appStatus = String(service.applicationStatus || '');
        // If already in a terminal state, return as-is
        if (['REJECTED', 'CLOSEDAFTERRESOLUTION'].includes(appStatus)) {
          return { data: normalizeRecord(service, config) };
        }
        // Reject the complaint (GRO action, works from PENDINGFORASSIGNMENT)
        const updated = await client.pgrUpdate(service, 'REJECT', { comment: 'Deleted via DataProvider' });
        const updatedService = ((updated as Record<string, unknown>).service || updated) as Record<string, unknown>;
        return { data: normalizeRecord(updatedService, config) };
      }
      if (config.type === 'localization') {
        const all = await fetchAll('localization');
        const record = all.find((r) => String(r.id) === String(params.id));
        if (!record) throw new Error(`Localization message not found: ${params.id}`);
        const loc = record as unknown as Record<string, unknown>;
        await client.localizationDelete(tenantId, String(loc.locale || 'en_IN'), [
          { code: String(loc.code), module: String(loc.module) },
        ]);
        return { data: record };
      }
      if (config.type === 'boundary') {
        const all = await fetchAll('boundaries');
        const record = all.find((r) => String(r.id) === String(params.id));
        if (!record) throw new Error(`Boundary not found: ${params.id}`);
        const code = String(params.id);
        try {
          await client.boundaryRelationshipDelete(tenantId, code, 'ADMIN');
        } catch { /* relationship may not exist */ }
        await client.boundaryDelete(tenantId, [code]);
        return { data: record };
      }
      throw new Error(`Delete not supported for resource type: ${config.type}`);
    },

    async deleteMany(resource, params): Promise<{ data: Identifier[] }> {
      const results: Identifier[] = [];
      for (const id of params.ids) {
        await provider.delete(resource, { id, previousData: {} as RaRecord });
        results.push(id);
      }
      return { data: results };
    },

    async idgenGenerate(idName: string, format?: string): Promise<string> {
      const results = await client.idgenGenerate(tenantId, [{ idName, format }]);
      return results[0]?.id ?? '';
    },
  };

  return provider;
}

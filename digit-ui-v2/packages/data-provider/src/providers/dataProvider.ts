import type { DataProvider, RaRecord, GetListResult, GetOneResult, GetManyResult, GetManyReferenceResult, CreateResult, UpdateResult, DeleteResult, Identifier } from 'ra-core';
import type { DigitApiClient } from '../client/DigitApiClient.js';
import type { MdmsRecord } from '../client/types.js';
import { getResourceConfig, type ResourceConfig } from './resourceRegistry.js';

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
  const data = mdms.data || {};
  return {
    ...data,
    id: extractId(data, config),
    _uniqueIdentifier: mdms.uniqueIdentifier,
    _isActive: mdms.isActive,
    _auditDetails: mdms.auditDetails,
    _schemaCode: mdms.schemaCode,
    _mdmsId: mdms.id,
  } as RaRecord;
}

function clientSort(records: RaRecord[], field: string, order: string): RaRecord[] {
  return [...records].sort((a, b) => {
    const aVal = getNestedValue(a as unknown as Record<string, unknown>, field);
    const bVal = getNestedValue(b as unknown as Record<string, unknown>, field);
    const cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''));
    return order === 'DESC' ? -cmp : cmp;
  });
}

function clientFilter(records: RaRecord[], filter: Record<string, unknown>): RaRecord[] {
  if (!filter || Object.keys(filter).length === 0) return records;
  return records.filter((record) =>
    Object.entries(filter).every(([key, value]) => {
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

async function mdmsGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const records = await client.mdmsSearch(tenantId, config.schema!, { limit: 500 });
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

async function boundaryGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  function flattenTrees(trees: Record<string, unknown>[]): RaRecord[] {
    const flat: RaRecord[] = [];
    function flatten(
      nodes: unknown[],
      parentCode: string | undefined,
      treeTenantId: string | undefined,
      treeHierarchyType: string | undefined,
    ) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes as Record<string, unknown>[]) {
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
        if (Array.isArray(node.children)) {
          flatten(node.children as unknown[], node.code as string, treeTenantId, treeHierarchyType);
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

  // Always fetch the session tenant's tree first.
  const rootTrees = await client.boundaryRelationshipSearch(tenantId, 'ADMIN').catch(() => []);
  const rootFlat = flattenTrees(rootTrees as Record<string, unknown>[]);

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
      const hierarchyChecks = await Promise.allSettled(
        cityTenants.map((ct) => client.boundaryHierarchySearch(ct)),
      );
      const tenantsWithHierarchies = cityTenants.filter((_, i) => {
        const result = hierarchyChecks[i];
        return result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0;
      });

      if (tenantsWithHierarchies.length > 0) {
        const cityResults = await Promise.all(
          tenantsWithHierarchies.map((ct) =>
            client.boundaryRelationshipSearch(ct, 'ADMIN').catch(() => []),
          ),
        );
        const cityFlat = cityResults.flatMap((trees) =>
          flattenTrees(trees as Record<string, unknown>[]),
        );
        return [...rootFlat, ...cityFlat];
      }
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
  // column). Defaults preserve the previous en_IN-only behavior on the left
  // and surface sw_KE on the right so Nairobi pilot translators see both
  // out of the box.
  const module = filter?.module ? String(filter.module) : undefined;
  const localeA = filter?.locale ? String(filter.locale) : 'en_IN';
  const localeB = filter?.locale2 ? String(filter.locale2) : 'sw_KE';
  const [aMsgs, bMsgs] = await Promise.all([
    client.localizationSearch(tenantId, localeA, module),
    localeA === localeB ? Promise.resolve([] as Record<string, unknown>[]) : client.localizationSearch(tenantId, localeB, module),
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
      case 'mdms': return mdmsGetList(client, config, tenantId);
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

      const all = await fetchAll(resource, params.filter);
      const filtered = clientFilter(all, params.filter);
      const sorted = clientSort(filtered, field, order);
      const data = clientPaginate(sorted, page, perPage);
      return { data, total: filtered.length };
    },

    async getOne(resource, params): Promise<GetOneResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
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
        // idField is 'uuid', so search by uuids first; fall back to codes for backward compat
        const byUuid = await client.employeeSearch(tenantId, { uuids: [String(params.id)] });
        if (byUuid.length) return { data: normalizeRecord(byUuid[0], config) };
        const byCodes = await client.employeeSearch(tenantId, { codes: [String(params.id)] });
        if (byCodes.length) return { data: normalizeRecord(byCodes[0], config) };
        throw new Error(`Employee not found: ${params.id}`);
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
        // Try uniqueIdentifier lookup first (fast path)
        const records = await client.mdmsSearch(tenantId, config.schema!, {
          uniqueIdentifiers: params.ids.map(String),
        });
        const found = records.filter((r) => r.isActive).map((r) => normalizeMdmsRecord(r, config));
        if (found.length === params.ids.length) return { data: found };
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
        const incoming = params.data as Record<string, unknown>;
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
        const uid = String(incoming[config.idField] || data.code || '');
        const record = await client.mdmsCreate(tenantId, config.schema!, uid, data);
        return { data: normalizeMdmsRecord(record, config) };
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
        const incoming = params.data as Record<string, unknown>;
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(incoming)) {
          if (key === 'id') continue;
          if (key.startsWith('_')) continue;
          sanitized[key] = value;
        }
        existing.data = { ...existing.data, ...sanitized };
        const updated = await client.mdmsUpdate(existing, true);
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
        const localeB = String(data.locale2 ?? 'sw_KE');
        const writes: Promise<unknown>[] = [];
        if (data.message !== undefined && data.message !== prev.message) {
          writes.push(client.localizationUpsert(tenantId, localeA, [
            { code, message: String(data.message ?? ''), module: mod },
          ]));
        }
        if (data.message2 !== undefined && data.message2 !== prev.message2) {
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

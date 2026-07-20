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
    function flatten(nodes: unknown[], parentCode?: string) {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes as Record<string, unknown>[]) {
        flat.push(normalizeRecord({ ...node, parentCode }, config));
        if (Array.isArray(node.children)) flatten(node.children as unknown[], node.code as string);
      }
    }
    for (const tree of trees) {
      flatten((tree.boundary || []) as unknown[]);
    }
    return flat;
  }

  const trees = await client.boundaryRelationshipSearch(tenantId, 'ADMIN');
  const flat = flattenTrees(trees);
  if (flat.length > 0) return flat;

  // If root tenant returned 0, search city-level sub-tenants that have boundary hierarchies
  if (!tenantId.includes('.')) {
    const tenantRecords = await client.mdmsSearch(tenantId, 'tenant.tenants', { limit: 200 });
    const cityTenants = tenantRecords
      .filter((r) => r.isActive && r.data?.code && String(r.data.code).startsWith(`${tenantId}.`))
      .map((r) => String(r.data.code));

    if (cityTenants.length > 0) {
      // Pre-filter: only query tenants that have a boundary hierarchy defined (avoids 400 errors)
      const hierarchyChecks = await Promise.allSettled(
        cityTenants.map((ct) => client.boundaryHierarchySearch(ct))
      );
      const tenantsWithHierarchies = cityTenants.filter((_, i) => {
        const result = hierarchyChecks[i];
        return result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0;
      });

      if (tenantsWithHierarchies.length > 0) {
        const results = await Promise.all(
          tenantsWithHierarchies.map((ct) => client.boundaryRelationshipSearch(ct, 'ADMIN').catch(() => []))
        );
        return results.flatMap((trees) => flattenTrees(trees as Record<string, unknown>[]));
      }
    }
  }

  return [];
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
  const module = filter?.module ? String(filter.module) : undefined;
  const messages = await client.localizationSearch(tenantId, 'en_IN', module);
  return messages.map((m) => normalizeRecord(m, config));
}

async function userGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const opts: { userName?: string; mobileNumber?: string; uuid?: string[]; roleCodes?: string[]; userType?: string; limit: number } = { limit: 100 };
  if (filter?.userName) opts.userName = String(filter.userName);
  if (filter?.mobileNumber) opts.mobileNumber = String(filter.mobileNumber);
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
  const hierarchies = await client.boundaryHierarchySearch(tenantId);
  return hierarchies.map((h) => normalizeRecord(h, config));
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
        const data = params.data as Record<string, unknown>;
        const uid = String(data[config.idField] || data.code || '');
        const record = await client.mdmsCreate(tenantId, config.schema!, uid, data);
        return { data: normalizeMdmsRecord(record, config) };
      }
      if (config.type === 'hrms') {
        const [employee] = await client.employeeCreate(tenantId, [params.data as Record<string, unknown>]);
        return { data: normalizeRecord(employee, config) };
      }
      if (config.type === 'pgr') {
        const data = params.data as Record<string, unknown>;
        const wrapper = await client.pgrCreate(
          tenantId,
          String(data.serviceCode),
          String(data.description || ''),
          (data.address || { locality: { code: '' } }) as Record<string, unknown>,
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
      throw new Error(`Create not supported for resource type: ${config.type}`);
    },

    async update(resource, params): Promise<UpdateResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        const records = await client.mdmsSearch(tenantId, config.schema!, { uniqueIdentifiers: [String(params.id)] });
        const existing = records.find((r) => r.isActive);
        if (!existing) throw new Error(`Record not found: ${params.id}`);
        existing.data = { ...existing.data, ...(params.data as Record<string, unknown>) };
        const updated = await client.mdmsUpdate(existing, true);
        return { data: normalizeMdmsRecord(updated, config) };
      }
      if (config.type === 'hrms') {
        const [employee] = await client.employeeUpdate(tenantId, [params.data as Record<string, unknown>]);
        return { data: normalizeRecord(employee, config) };
      }
      if (config.type === 'pgr') {
        const data = params.data as Record<string, unknown>;
        const action = String(data.action || data._action || 'ASSIGN');
        // Fetch current service state
        const wrappers = await client.pgrSearch(tenantId, { serviceRequestId: String(params.id) });
        if (!wrappers.length) throw new Error(`Complaint not found: ${params.id}`);
        const service = ((wrappers[0] as Record<string, unknown>).service || wrappers[0]) as Record<string, unknown>;
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
        const data = params.data as Record<string, unknown>;
        const messages = await client.localizationUpsert(tenantId, String(data.locale || 'en_IN'), [
          { code: String(data.code || params.id), message: String(data.message), module: String(data.module) },
        ]);
        if (messages.length) return { data: normalizeRecord(messages[0], config) };
        return { data: { ...data, id: String(data.code || params.id) } as RaRecord };
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
        // Search by UUID first (idField is 'uuid'), fall back to codes
        let results = await client.employeeSearch(tenantId, { uuids: [String(params.id)] });
        if (!results.length) results = await client.employeeSearch(tenantId, { codes: [String(params.id)] });
        if (!results.length) throw new Error(`Employee not found: ${params.id}`);
        let emp = results[0] as Record<string, unknown>;
        // If user is null (UUID search may omit user), re-fetch by code to get full object
        if (!emp.user && emp.code) {
          const byCode = await client.employeeSearch(tenantId, { codes: [emp.code as string] });
          if (byCode.length) emp = byCode[0] as Record<string, unknown>;
        }
        emp.isActive = false;
        emp.deactivationDetails = [{ reasonForDeactivation: 'OTHERS', effectiveFrom: Date.now() }];
        const [updated] = await client.employeeUpdate(tenantId, [emp]);
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

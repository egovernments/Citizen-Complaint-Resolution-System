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

/**
 * Re-project nested filter values onto their dotted paths.
 *
 * react-admin's `<FilterLiveForm>` drives react-hook-form, and RHF treats a
 * dotted input name as a PATH: a filter declared `source="additionalDetail.department"`
 * reaches the data provider as `{ additionalDetail: { department: 'x' } }`, never
 * as `{ 'additionalDetail.department': 'x' }`. Every branch in this provider reads
 * filters by their flat, declared key, so any dotted-source filter silently
 * evaporated (verified at runtime on /manage/complaints, 2026-07-27).
 *
 * This normalises generically rather than special-casing one field: every leaf of
 * every nested filter object is also published under its full dotted path, while
 * the original nested shape is left intact so fetchers that read nested objects
 * (and `clientFilter`, which compares them stringified) keep behaving as before.
 * Existing flat keys always win — a caller that passed `'a.b'` explicitly is not
 * overwritten by the walk.
 */
function flattenFilterSources(filter?: Record<string, unknown>): Record<string, unknown> {
  if (!filter) return {};
  const out: Record<string, unknown> = { ...filter };
  const walk = (value: unknown, path: string): void => {
    if (
      value == null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      value instanceof Date
    ) {
      if (!(path in out)) out[path] = value;
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };
  for (const [key, value] of Object.entries(filter)) walk(value, key);
  return out;
}

/**
 * Coerce a filter date into the epoch-ms that DIGIT services expect.
 *
 * pgr-services types `RequestSearchCriteria.fromDate/toDate` as `Long` and runs
 * `ser.createdtime BETWEEN ? AND ?` (PGRQueryBuilder), and the rest of the estate
 * (digit-ui inbox, the v2 dashboard) sends epoch-ms too. But `<input type="date">`
 * hands react-hook-form a date-ONLY string ("2026-07-20"), which the provider used
 * to drop on a `typeof === 'number'` guard.
 *
 * The Y-M-D parts are parsed explicitly in LOCAL time: `new Date('2026-07-20')`
 * is specified as UTC midnight, which is the wrong day for any tenant east of UTC.
 * `edge` widens a bare day to the boundary the caller means — 'start' takes local
 * 00:00:00.000, 'end' takes local 23:59:59.999 so an inclusive "To 20 Jul" still
 * matches complaints filed on 20 Jul.
 */
function toEpochMs(value: unknown, edge: 'start' | 'end'): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  // Already an epoch-ms value round-tripped through the URL query string.
  if (/^\d{10,}$/.test(raw)) return Number(raw);
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) {
    const [, y, m, d] = ymd;
    return edge === 'end'
      ? new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59, 999).getTime()
      : new Date(Number(y), Number(m) - 1, Number(d), 0, 0, 0, 0).getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function extractId(record: Record<string, unknown>, config: ResourceConfig): string {
  const value = getNestedValue(record, config.idField);
  return value == null ? '' : String(value);
}

function normalizeRecord(raw: Record<string, unknown>, config: ResourceConfig): RaRecord {
  return { ...raw, id: extractId(raw, config) } as RaRecord;
}

/**
 * Collapse records that share a react-admin `id`, keeping the first occurrence.
 *
 * react-admin's contract is one record per id: its query cache, Datagrid row
 * keys and every `<SelectItem value={id}>` built from a list all key on it. Two
 * records with the same id therefore render as N visually identical rows/options
 * that ALL resolve to the same record — and in a Radix `Select`, N items sharing
 * a `value` all show as checked while `<SelectValue>` concatenates every one of
 * their labels ("ADMINADMINADMIN…"). That is CCRS #1923.
 *
 * Duplicates are not hypothetical: the aggregating fetchers below concatenate
 * results across the state tenant and its city tenants, and DIGIT does NOT
 * enforce uniqueness of a `hierarchyType` or a boundary `code` across tenants.
 * On bomet (`ke`) that yields 7 hierarchies called ADMIN, 3 called KE-ADMIN, and
 * `CITY_001`/`WARD_001` defined under two different city tenants.
 *
 * Keep-first is deliberate: every aggregating fetcher lists the SESSION tenant's
 * records before the sub-tenants', so the survivor is the definition the
 * operator is actually working in.
 *
 * Blank ids are a different failure and get a different remedy. A record whose
 * `idField` was missing normalizes to `id: ''`, and N such records are exactly
 * as broken as N sharing a real id. Dropping all but the first would hide rows
 * that are genuinely distinct — they collide only because id extraction failed,
 * not because they are the same record. So each repeat is given its own
 * synthetic id instead, which satisfies react-admin's one-record-per-id
 * contract without losing anything. This mirrors what the custom-rows fetcher
 * already does when two Novu integrations synthesize the same id.
 */
function dedupeById(records: RaRecord[]): RaRecord[] {
  const seen = new Set<string>();
  const out: RaRecord[] = [];
  // Every id in the input, checked up front so a synthetic id can never collide
  // with a real one that appears LATER in the list — which would otherwise make
  // that real record look like a duplicate and drop it.
  const taken = new Set(records.map((record) => String(record.id ?? '')));
  let blanks = 0;
  for (const record of records) {
    const id = String(record.id ?? '');
    if (!seen.has(id)) {
      seen.add(id);
      out.push(record);
      continue;
    }
    // A repeated real id is a genuine cross-tenant duplicate: keep the first.
    if (id !== '') continue;
    // A repeated blank id is a distinct record that lost its id — keep it, under
    // an id nothing else is using.
    let synthetic: string;
    do {
      blanks += 1;
      synthetic = `#blank-${blanks}`;
    } while (taken.has(synthetic) || seen.has(synthetic));
    seen.add(synthetic);
    out.push({ ...record, id: synthetic } as RaRecord);
  }
  return out;
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

interface BoundaryTreeNode extends Record<string, unknown> {
  code?: string;
  boundaryType?: string;
  parent?: string | null;
  children?: BoundaryTreeNode[];
}

interface FoundBoundaryRelationship {
  node: BoundaryTreeNode;
  parentCode: string | null;
}

function findBoundaryRelationship(
  trees: Record<string, unknown>[],
  code: string,
): FoundBoundaryRelationship | undefined {
  const visit = (
    nodes: BoundaryTreeNode[],
    inheritedParent: string | null,
  ): FoundBoundaryRelationship | undefined => {
    for (const node of nodes) {
      const parentCode =
        typeof node.parent === 'string' && node.parent.trim()
          ? node.parent.trim()
          : inheritedParent;
      if (node.code === code) return { node, parentCode };
      const found = visit(Array.isArray(node.children) ? node.children : [], node.code ?? null);
      if (found) return found;
    }
    return undefined;
  };

  for (const tree of trees) {
    const raw = tree.boundary;
    const roots = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
    const found = visit(roots as BoundaryTreeNode[], null);
    if (found) return found;
  }
  return undefined;
}

function isDuplicateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('duplicate') || normalized.includes('already exists');
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

// Used only when a tenant has no ComplaintHierarchyDefinition yet — a fresh
// tenant bootstrapping its first leaf row before ever visiting "Complaint
// Hierarchies" to declare one. Every real tenant's definition overrides these.
const FALLBACK_HIERARCHY_TYPE = 'PGR';
const FALLBACK_LEAF_LEVEL_CODE = 'SUB_TYPE';

interface HierarchyDefinitionLevel {
  levelCode?: string;
  isLeafServiceCode?: boolean;
}

/** Resolve {hierarchyType, levelCode} for a NEW leaf row from the tenant's
 *  actual RAINMAKER-PGR.ComplaintHierarchyDefinition, rather than a hardcoded
 *  literal — both are tenant-configurable (levelCode especially: a tenant can
 *  name its leaf level anything, not always "SUB_TYPE"; see review on
 *  CCRS#1719). Picks the first active definition and the level it marks
 *  isLeafServiceCode. Falls back to the FALLBACK_* constants only when no
 *  definition exists at all, or the lookup fails. */
async function resolveNewLeafDefaults(
  client: DigitApiClient,
  tenantId: string,
): Promise<{ hierarchyType: string; levelCode: string }> {
  try {
    const definitions = await client.mdmsSearch(tenantId, 'RAINMAKER-PGR.ComplaintHierarchyDefinition', { isActive: true });
    const def = definitions.find((d) => d.isActive);
    const data = def?.data as { hierarchyType?: unknown; levels?: unknown } | undefined;
    const hierarchyType = typeof data?.hierarchyType === 'string' ? data.hierarchyType : undefined;
    const levels = Array.isArray(data?.levels) ? (data.levels as HierarchyDefinitionLevel[]) : [];
    const leafLevel = levels.find((l) => l.isLeafServiceCode);
    if (hierarchyType && leafLevel?.levelCode) {
      return { hierarchyType, levelCode: leafLevel.levelCode };
    }
  } catch {
    // fall through to the bootstrap default below
  }
  return { hierarchyType: FALLBACK_HIERARCHY_TYPE, levelCode: FALLBACK_LEAF_LEVEL_CODE };
}

/** Translate an inbound complaint-type form payload (legacy ServiceDefs
 *  vocabulary) into a ComplaintHierarchy LEAF row for writing. `serviceCode`
 *  becomes the row `code`; the adapter-only synthetic fields (menuPath /
 *  menuPathName / serviceCode) are dropped — grouping derives from parentCode.
 *  The metadata strip (id / `_*`) is left to the caller.
 *
 *  `newLeafDefaults`, when passed, stamps hierarchyType/levelCode for a brand
 *  new row that doesn't have them yet (CREATE — see resolveNewLeafDefaults).
 *  Omit it on UPDATE: dataProvider.update() merges this output onto the
 *  freshly-fetched existing record, so an edit that never touches these
 *  fields correctly keeps whatever the record already has, rather than this
 *  function silently overwriting them with a default (CCRS#1719 review). */
function serviceDefToLeafWrite(
  data: Record<string, unknown>,
  newLeafDefaults?: { hierarchyType: string; levelCode: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  if (newLeafDefaults) {
    if (!out.hierarchyType) out.hierarchyType = newLeafDefaults.hierarchyType;
    if (!out.levelCode) out.levelCode = newLeafDefaults.levelCode;
  }
  // serviceCode -> code (the leaf's code IS the serviceCode stored on a
  // complaint). Populate `code` from a filled Service Code whenever `code` is
  // absent OR blank — the create form carries `code: ""` (empty string, not
  // null), so the old `code == null` guard left the uniqueIdentifier empty and
  // MDMS rejected the write with UNIQUE_IDENTIFIER_EMPTY_ERR.
  const serviceCodeStr = out.serviceCode == null ? '' : String(out.serviceCode).trim();
  const codeStr = out.code == null ? '' : String(out.code).trim();
  if (serviceCodeStr !== '' && codeStr === '') out.code = out.serviceCode;
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
      // Localization fetcher control keys — consumed by localizationGetList to
      // choose which locales to pivot; they are not record fields, so they must
      // not participate in record-level filtering (else every pivoted row, which
      // has msg__<locale> fields but no `locales`/`locale` field, gets dropped).
      // `locales.0` etc. appear when an array filter is objectified by ra-core
      // / flattenFilterSources; those must be skipped too.
      if (key === 'locale' || key === 'locale2' || key === 'locales') return true;
      if (key.startsWith('locale.') || key.startsWith('locale2.') || key.startsWith('locales.')) return true;
      // Sentinel from LocalizationList's "All modules" Select — never a real module.
      if (key === 'module' && (value === '__all__' || value === '')) return true;
      // Arrays/objects are fetcher control data (e.g. locales: ['en_IN', …]).
      // Matching them against a missing record field stringifies to
      // "en_in,hi_in,…" / "[object Object]" and drops every row — that's how
      // /manage/localization showed 0 against a dashboard count of thousands.
      if (value !== null && typeof value === 'object') return true;
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

// Internal paging batch size for mdmsSearchAll — NOT a result cap. A tenant with more rows
// than this just costs more round trips; nothing is ever truncated at this number.
const DEFAULT_MDMS_SEARCH_ALL_BATCH_SIZE = 1000;
// Safety ceiling in case mdms-v2 ever returns pages forever (bad offset handling, a
// criterion mdms-v2 silently ignores, etc.) — far beyond any real DIGIT master data today.
const DEFAULT_MDMS_SEARCH_ALL_MAX_BATCHES = 200;
let mdmsSearchAllBatchSize = DEFAULT_MDMS_SEARCH_ALL_BATCH_SIZE;
let mdmsSearchAllMaxBatches = DEFAULT_MDMS_SEARCH_ALL_MAX_BATCHES;

/**
 * Test-only hook so unit tests can exercise mdmsSearchAll's multi-batch and
 * safety-ceiling logic with small fixtures instead of hundreds of thousands of
 * allocated records. Never called from a production code path.
 */
export function __setMdmsSearchAllLimitsForTesting(batchSize = DEFAULT_MDMS_SEARCH_ALL_BATCH_SIZE, maxBatches = DEFAULT_MDMS_SEARCH_ALL_MAX_BATCHES): void {
  mdmsSearchAllBatchSize = batchSize;
  mdmsSearchAllMaxBatches = maxBatches;
}

/**
 * Fetches every record for a schema, paging through mdms-v2 (which has no way to return
 * "everything" in one call) instead of truncating at a single hardcoded limit. Issue #953:
 * a tenant with 630 ComplaintHierarchy rows was silently capped at the old `{ limit: 500 }`
 * single-shot fetch, before the leaf-adapter even got a chance to filter them.
 *
 * Bounded by `mdmsCount` (same criteria) rather than "did the last page come back short":
 * a short/empty page is not a trustworthy end-of-data signal on its own — an environment
 * that enforces a server-side max-limit below our batch size would return a short page
 * while rows remain, silently reintroducing #953. `criteria` (e.g. isActive) is passed to
 * both calls so the count and the fetched rows agree on what's being counted/paged, and
 * `offset` advances by the page's actual length (not the requested batch size) with a
 * uniqueIdentifier dedupe, so a server that ever returns more or fewer rows than asked
 * can't produce gaps or duplicates.
 */
async function mdmsSearchAll(client: DigitApiClient, tenant: string, schema: string, criteria?: { isActive?: boolean }): Promise<MdmsRecord[]> {
  const expectedTotal = await client.mdmsCount(tenant, schema, criteria);
  const all: MdmsRecord[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let batches = 0;
  while (all.length < expectedTotal && batches < mdmsSearchAllMaxBatches) {
    batches += 1;
    const page = await client.mdmsSearch(tenant, schema, { limit: mdmsSearchAllBatchSize, offset, ...criteria });
    if (page.length === 0) break;
    for (const record of page) {
      if (seen.has(record.uniqueIdentifier)) continue;
      seen.add(record.uniqueIdentifier);
      all.push(record);
    }
    offset += page.length;
  }
  if (all.length < expectedTotal) {
    // Either the safety ceiling was hit while mdms-v2 kept returning rows, or paging
    // stopped short of mdmsCount's own total — returning `all` here would silently hand
    // getList/getOne/getMany fewer records than mdms-v2 itself says exist. Fail loudly.
    throw new Error(
      `mdmsSearchAll: schema "${schema}" on tenant "${tenant}" retrieved ${all.length} of ` +
        `${expectedTotal} records reported by mdmsCount; refusing to return a partial result.`,
    );
  }
  return all;
}

async function mdmsGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const tenant = pickTenant(tenantId, filter);
  // No isActive push-down here: the leaf-adapter (adaptHierarchyLeaves) needs inactive
  // rows too, to resolve a leaf's parent name even when that parent has since been
  // deactivated. Non-leaf-adapter callers filter isActive themselves below.
  const records = await mdmsSearchAll(client, tenant, config.schema!);
  if (config.leafServiceDefAdapter) return adaptHierarchyLeaves(records, config);
  return records.filter((r) => r.isActive).map((r) => normalizeMdmsRecord(r, config));
}

async function hrmsGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  // Honor a __tenantId override (e.g. the assignee picker on a city complaint
  // must list the CITY's employees, not the root/session tenant's).
  const tenant = pickTenant(tenantId, filter);
  // First try searching the resolved tenant
  const employees = await client.employeeSearch(tenant, { limit: 500 });
  if (employees.length > 0) return employees.map((e) => normalizeRecord(e, config));

  // If root tenant returned 0 results, search all city-level sub-tenants
  if (!tenant.includes('.')) {
    const tenantRecords = await client.mdmsSearch(tenant, 'tenant.tenants', { limit: 200 });
    const cityTenants = tenantRecords
      .filter((r) => r.isActive && r.data?.code && String(r.data.code).startsWith(`${tenant}.`))
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
    // Playwright onboarding specs leave hundreds of PW_* hierarchy stubs on
    // live tenants (bomet ke has 214 types, 212 of them PW_*).
    // DigitApiClient.boundaryHierarchySearch paginates every page (not the
    // first 100); we still skip PW_* so we do not issue 200 empty tree
    // queries. Always include ADMIN.
    const hierarchies = await client.boundaryHierarchySearch(t).catch(() => []);
    const discovered = (hierarchies as Record<string, unknown>[])
      .map((h) => (typeof h.hierarchyType === 'string' ? h.hierarchyType : ''))
      .filter((ht) => ht && !/^PW_/i.test(ht));
    const types = Array.from(new Set(['ADMIN', ...discovered]));
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

/**
 * Drop UI-private sidecar keys from a PGR `address.locality`.
 *
 * A form control that keeps navigation state under a dotted source rooted at the
 * field it drives (`address.locality.code` → `address.locality.code__h`) has
 * react-hook-form build those keys INSIDE the locality object, so they ride out
 * on the wire as part of PGR's address contract. pgr-services tolerates them
 * (they vanish when the payload is bound to the Boundary POJO), but they are not
 * ours to send, and a stricter service would reject the whole write. `__` is the
 * codebase's synthetic-key marker (cf. the localization grid's `msg__<locale>`)
 * and no field of Boundary contains it.
 */
function stripLocalitySidecars(locality: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(locality)) {
    if (key.includes('__')) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Merge a complaint-edit form's `address` onto the address loaded from PGR.
 *
 * `eg_pgr_address_v2.locality` is NOT NULL, and egov-persister applies the
 * address and service UPDATEs in ONE transaction. So an address whose
 * `locality.code` is null does not merely lose the locality: pgr-services
 * returns 200 and advances the workflow, the persister then dies on
 * `null value in column "locality" of relation "eg_pgr_address_v2"`, and the
 * service UPDATE rolls back with it — nine retries, message dropped, the
 * complaint left untouched while its workflow state says otherwise. A write the
 * persister cannot apply must never be sent, whatever the form hands us: an
 * empty incoming code is always restored from the record that was just loaded.
 * (Clearing a complaint's locality is not a supported edit — the column forbids
 * it — so there is no legitimate intent to preserve here.)
 *
 * Every other address field merges as before: nulling a landmark or a pincode is
 * a real edit the schema allows.
 */
function mergePgrAddress(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current, ...incoming };
  const currentLocality = current.locality as Record<string, unknown> | undefined;
  const incomingLocality = incoming.locality as Record<string, unknown> | undefined;
  if (currentLocality || incomingLocality) {
    const locality = stripLocalitySidecars({ ...(currentLocality ?? {}), ...(incomingLocality ?? {}) });
    const loadedCode = currentLocality?.code;
    if ((locality.code == null || locality.code === '') && loadedCode != null && loadedCode !== '') {
      locality.code = loadedCode;
    }
    merged.locality = locality;
  }
  return merged;
}

/** Resolve the tenant that a complaint's `address.tenantId` must carry.
 *  Complaint boundaries live under a CITY sub-tenant, so a complaint filed
 *  from a root/state session (e.g. `mz`) must still stamp the boundary's city
 *  tenant (`mz.maputo`) on the address — that's the live PGR contract.
 *  (citizen.tenantId stays at the state/root tenant; that is handled upstream.)
 *  A city-level session already owns the boundary tree, so its own tenant is
 *  the answer. */
async function resolveComplaintAddressTenant(
  client: DigitApiClient,
  sessionTenant: string,
  localityCode: string | undefined,
): Promise<string> {
  if (sessionTenant.includes('.')) return sessionTenant;
  const tenantRecords = await client
    .mdmsSearch(sessionTenant, 'tenant.tenants', { limit: 200 })
    .catch(() => [] as MdmsRecord[]);
  const cityTenants = tenantRecords
    .filter((r) => r.isActive && r.data?.code && String(r.data.code).startsWith(`${sessionTenant}.`))
    .map((r) => String(r.data.code));
  if (cityTenants.length === 0) return sessionTenant;
  if (cityTenants.length === 1) {
    const city = cityTenants[0];
    // Even with a single city under this root, a root-seeded boundary tree can
    // place the locality directly under the root (the explicitly-supported
    // "tree at the root tenant" case, e.g. a Bomet tree seeded at `ke`), where
    // stamping the city would misroute the complaint. Verify the locality
    // actually lives under the city before returning it; otherwise keep the
    // root/session tenant — mirrors the multi-city path below.
    if (localityCode) {
      const found = await client.boundarySearch(city, [localityCode]).catch(() => []);
      if (found.length > 0) return city;
    }
    return sessionTenant;
  }
  // Multiple cities under this root: pick the one whose boundary space
  // actually contains the picked locality code.
  if (localityCode) {
    for (const ct of cityTenants) {
      const found = await client.boundarySearch(ct, [localityCode]).catch(() => []);
      if (found.length > 0) return ct;
    }
  }
  return sessionTenant;
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

/** Parse the localization list's `locales` control value into locale codes. */
function parseLocalesFilter(raw: unknown): string[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) return raw.map((l) => String(l).trim()).filter(Boolean);
  // ra-core / flattenFilterSources may objectify an array into {0: 'en_IN', …}.
  if (typeof raw === 'object') {
    return Object.values(raw as Record<string, unknown>).map((l) => String(l).trim()).filter(Boolean);
  }
  return String(raw).split(',').map((l) => l.trim()).filter(Boolean);
}

async function localizationGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  // Side-by-side pivot of two locales. The list view picks the locales via
  // dropdowns and passes them as `locale` (left column) and `locale2` (right
  // column). localeB is empty until the user explicitly picks a second locale
  // so the right column starts as all-missing rather than defaulting to a
  // hardcoded locale that may not exist on the tenant.
  const module = filter?.module && filter.module !== '__all__' ? String(filter.module) : undefined;
  // Multi-locale pivot: when the caller passes `locales` (array or CSV) the
  // grid wants one editable column per locale (msg__<locale>) instead of the
  // 2-way message/message2 compare — so every language can be edited side by
  // side. Rows are keyed by code+module; a code present in one locale but not
  // another still appears (its missing columns stay empty).
  const locales = parseLocalesFilter(filter?.locales);
  if (locales.length > 0) {
    const perLocale = await Promise.all(locales.map((l) => client.localizationSearch(tenantId, l, module)));
    const pivotN = new Map<string, Record<string, unknown>>();
    locales.forEach((loc, i) => {
      for (const m of perLocale[i] as Record<string, unknown>[]) {
        const code = String(m.code ?? '');
        const mod = String(m.module ?? '');
        const key = `${code}__${mod}`;
        let row = pivotN.get(key);
        if (!row) {
          row = { id: key, code, module: mod };
          for (const L of locales) row[`msg__${L}`] = '';
          pivotN.set(key, row);
        }
        row[`msg__${loc}`] = String(m.message ?? '');
      }
    });
    return Array.from(pivotN.values()).map((r) => normalizeRecord(r, config));
  }

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

// --- Custom (non-MDMS, read-only) fetchers ---------------------------------
//
// `custom` resources are served by an out-of-band DIGIT service, not egov-mdms.
// Today that's the novu-bridge read proxy (Notification Logs + Providers). We
// hit its origin-relative `customPath` with a plain GET, attach the same DIGIT
// bearer token the rest of the provider uses (pulled from the client's auth
// info — no new auth plumbing), map react-admin filters onto query params, and
// return the service's `{data,total}` envelope. Read-only: create/update/delete
// are intentionally unsupported for this type.

/** Origin the SPA is served from; the novu-bridge route is same-origin
 *  (`${origin}/novu-bridge/...`) behind Kong/nginx. Falls back to empty in
 *  non-browser contexts (tests), yielding a relative URL. */
function customOrigin(): string {
  return typeof window !== 'undefined' && window.location ? window.location.origin : '';
}

async function customFetchList(
  client: DigitApiClient,
  config: ResourceConfig,
  tenantId: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<{ records: RaRecord[]; total: number }> {
  if (!config.customPath) throw new Error(`custom resource missing customPath: ${config.label}`);
  const params = new URLSearchParams();
  if (config.customTenantScoped) params.set('tenantId', tenantId);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  const url = `${customOrigin()}${config.customPath}${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = client.getAuthInfo().token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${config.label} request failed (${response.status}): ${text}`);
  }
  const body = (await response.json().catch(() => ({}))) as { data?: unknown[]; total?: number };
  const rows = Array.isArray(body.data) ? (body.data as Record<string, unknown>[]) : [];
  // De-dupe synthesized ids within the batch: two Novu integrations that share
  // providerId+channel (e.g. Twilio SMS + Twilio WhatsApp-as-sms) must never
  // collapse onto one react-admin id — duplicate ids make the datagrid drop or
  // mispaint one of the rows on the next re-render.
  const seenIds = new Set<string>();
  const records = rows.map((r) => {
    let withId = ensureId(r, config);
    let id = String(getNestedValue(withId, config.idField));
    if (seenIds.has(id)) {
      let n = 2;
      while (seenIds.has(`${id}#${n}`)) n += 1;
      id = `${id}#${n}`;
      withId = { ...withId, [config.idField]: id };
    }
    seenIds.add(id);
    return normalizeRecord(withId, config);
  });
  const total = typeof body.total === 'number' ? body.total : records.length;
  return { records, total };
}

/** Custom rows may lack the configured idField (e.g. a Novu integration keyed
 *  by `_id` that some deployments omit). Synthesise a stable id so react-admin
 *  never collapses distinct rows onto an empty id. Includes identifier/name so
 *  two integrations on the same provider+channel stay distinct. */
function ensureId(raw: Record<string, unknown>, config: ResourceConfig): Record<string, unknown> {
  const existing = getNestedValue(raw, config.idField);
  if (existing != null && String(existing) !== '') return raw;
  // Deterministic fallback: providerId+channel+identifier/name for providers,
  // txn/ref for logs.
  const fallback =
    [raw.providerId, raw.channel, raw.identifier, raw.name, raw.transactionId, raw.referenceNumber, raw.recipientValue]
      .filter((v) => v != null && v !== '')
      .join(':') || JSON.stringify(raw);
  return { ...raw, [config.idField]: fallback };
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

  // Every list-shaped read funnels through here (getList's generic path,
  // getMany, getManyReference), so this is the one place that can guarantee the
  // "unique id per record" invariant react-admin depends on — see dedupeById.
  async function fetchAll(resource: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
    return dedupeById(await fetchAllRaw(resource, filter));
  }

  async function fetchAllRaw(resource: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
    const config = resolveConfig(resource);
    switch (config.type) {
      case 'mdms': return mdmsGetList(client, config, tenantId, filter);
      case 'hrms': return hrmsGetList(client, config, tenantId, filter);
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
      // Custom resources normally go through the dedicated getList/getOne
      // branches; this keeps getMany/getManyReference from throwing by falling
      // back to a full unfiltered fetch.
      case 'custom': return (await customFetchList(client, config, tenantId, { limit: 500 })).records;
      default: throw new Error(`Unsupported resource type: ${config.type}`);
    }
  }

  const provider: DigitDataProvider = {
    async getList(resource, params): Promise<GetListResult> {
      const { page = 1, perPage = 25 } = params.pagination ?? {};
      const { field = 'id', order = 'ASC' } = params.sort ?? {};
      // Filters declared with a dotted source arrive nested from react-hook-form;
      // normalise once here so every branch below can read them by their declared
      // key. See flattenFilterSources.
      const filterValues = flattenFilterSources(params.filter as Record<string, unknown> | undefined);

      // PGR complaints: push pagination + server-supported filters to the
      // API. The old behavior pulled the first 100 records and paginated
      // client-side, which silently truncated larger tenants. `_count`
      // returns the real total so react-admin's paginator stays honest.
      const config = resolveConfig(resource);
      if (config.type === 'pgr') {
        const filter = filterValues;
        const status = filter.applicationStatus ?? filter.status;
        // <input type="date"> yields a "YYYY-MM-DD" string; pgr-services wants epoch-ms.
        let fromDate = toEpochMs(filter.fromDate, 'start');
        const toDate = toEpochMs(filter.toDate, 'end');
        // PGRQueryBuilder throws INVALID_SEARCH ("Cannot specify to-Date without a
        // from-Date") when only toDate is given, so anchor an open-ended "To" at the epoch.
        if (toDate !== undefined && fromDate === undefined) fromDate = 0;
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

      // Custom (non-MDMS) read-only resources served by an out-of-band service.
      // notification-log pushes pagination + filters to the novu-bridge /logs
      // proxy (which returns the real total); notification-provider returns the
      // full integration list, so we paginate/filter/sort it client-side.
      if (config.type === 'custom') {
        const filter = filterValues;
        if (resource === 'notification-log') {
          const { records, total } = await customFetchList(client, config, tenantId, {
            referenceNumber: typeof filter.referenceNumber === 'string' ? filter.referenceNumber : undefined,
            // Substring-style search on the complaint number → prefix match server-side.
            referenceNumberPrefix: typeof filter.referenceNumber === 'string' && filter.referenceNumber ? true : undefined,
            transactionId: typeof filter.transactionId === 'string' ? filter.transactionId : undefined,
            channel: typeof filter.channel === 'string' ? filter.channel : undefined,
            status: typeof filter.status === 'string' ? filter.status : undefined,
            limit: perPage,
            offset: (page - 1) * perPage,
          });
          return { data: records, total };
        }
        // Generic custom list (e.g. notification-provider): fetch-all then
        // filter/sort/paginate in memory.
        const { records } = await customFetchList(client, config, tenantId, {});
        const filtered = clientFilter(records, filterValues);
        const sorted = clientSort(filtered, field, order);
        const data = clientPaginate(sorted, page, perPage);
        return { data, total: filtered.length };
      }

      // MDMS resources without the leaf-adapter (all schemas except
      // complaint-hierarchy), with no client-side filter active. mdms-v2's
      // MdmsCriteria has no sort parameter, so a single server-paginated page
      // can't represent the globally-sorted order — sorting just that page
      // (as a single `{ limit: perPage, offset }` fetch used to) reshuffles
      // each page independently instead of the full set. Page through every
      // active record (mdmsSearchAll, with isActive pushed to the server so
      // we don't also pay for every soft-deleted row), sort in memory, then
      // slice the requested page. mdmsSearchAll bounds itself on mdmsCount
      // with the SAME isActive criteria, so the total it hands back always
      // agrees with what was actually paged through.
      if (config.type === 'mdms' && !config.leafServiceDefAdapter) {
        const filter = filterValues;
        const hasClientFilter = Object.keys(filter).some((k) => k !== TENANT_OVERRIDE_KEY);
        if (!hasClientFilter) {
          const tenant = pickTenant(tenantId, filter);
          const all = await mdmsSearchAll(client, tenant, config.schema!, { isActive: true });
          // Defensive fallback for any MDMS build that ignores the isActive criterion —
          // degrades to filtering client-side, never worse than the pre-push-down behavior.
          // dedupeById mirrors what fetchAll does for the filtered path below, so
          // both routes into an MDMS list obey the same one-record-per-id rule.
          // A no-op for records carrying an MDMS uniqueIdentifier (always unique);
          // it only bites on legacy rows that fall back to data[idField], which
          // normalizeMdmsRecord already notes collapse onto one record anyway.
          const active = dedupeById(
            all.filter((r) => r.isActive).map((r) => normalizeMdmsRecord(r, config)),
          );
          const sorted = clientSort(active, field, order);
          const data = clientPaginate(sorted, page, perPage);
          return { data, total: active.length };
        }
      }

      const all = await fetchAll(resource, filterValues);
      const filtered = clientFilter(all, filterValues);
      const sorted = clientSort(filtered, field, order);
      const data = clientPaginate(sorted, page, perPage);
      return { data, total: filtered.length };
    },

    async getOne(resource, params): Promise<GetOneResult> {
      const config = resolveConfig(resource);
      if (config.type === 'custom') {
        // No single-item endpoint on the proxy; fetch the list and match by id.
        // Logs are tenant-scoped + transactionId-filterable, so pass it through
        // when the id looks like a transactionId; otherwise scan the page.
        const query: Record<string, string | number | boolean | undefined> = { limit: 500 };
        if (resource === 'notification-log' && config.idField === 'transactionId') {
          query.transactionId = String(params.id);
        }
        const { records } = await customFetchList(client, config, tenantId, query);
        const found = records.find((r) => String(r.id) === String(params.id));
        if (!found) throw new Error(`Record not found: ${params.id}`);
        return { data: found };
      }
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
        // Honor a meta.tenantId override — a complaint's PGR workflow (actions
        // like ESCALATE) lives at the CITY tenant; the root/session tenant's PGR
        // config differs, so reading it there hides city-only actions.
        const wfTenant = (params.meta as Record<string, unknown> | undefined)?.tenantId as string | undefined;
        const services = await client.workflowBusinessServiceSearch(wfTenant || tenantId, [String(params.id)]);
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
          ? serviceDefToLeafWrite(
              params.data as Record<string, unknown>,
              await resolveNewLeafDefaults(client, tenantId),
            )
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
        // Live PGR records always carry address.tenantId (never address.city,
        // which is nullable and unused downstream). Operators don't fill this
        // manually.
        const formAddress = (data.address as Record<string, unknown> | undefined) ?? {};
        const address: Record<string, unknown> = { ...formAddress };
        if (!address.locality && typeof data['address.locality.code'] === 'string') {
          address.locality = { code: data['address.locality.code'] };
        }
        // Never ship the picker's private navigation state as part of the
        // address — see stripLocalitySidecars.
        if (address.locality && typeof address.locality === 'object') {
          address.locality = stripLocalitySidecars(address.locality as Record<string, unknown>);
        }
        // address.tenantId must be the boundary's CITY tenant (e.g.
        // `mz.maputo`), NOT the session tenant. A root-`mz` admin session
        // previously stamped `mz`, violating the PGR address contract and
        // filing the complaint outside the city it belongs to.
        const localityCode = (address.locality as Record<string, unknown> | undefined)?.code;
        address.tenantId = await resolveComplaintAddressTenant(
          client,
          tenantId,
          typeof localityCode === 'string' ? localityCode : undefined,
        );
        // The complaint's service.tenantId must be the boundary's CITY tenant
        // (same as address.tenantId, resolved above), NOT the session/root tenant:
        // pgr-services validates the picked locality against service.tenantId, and
        // root has no boundaries → INVALID_BOUNDARY_CODE. A root-`mz` admin session
        // previously passed `mz` here and every create 400'd.
        const wrapper = await client.pgrCreate(
          String(address.tenantId || tenantId),
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
        // Tenant ownership is deliberately taken only from the authenticated
        // data-provider context. BoundaryCreate does not render a tenant field,
        // and a caller-supplied data.tenantId must never retarget the write.
        const code = String(data.code ?? '').trim();
        const boundaryType = String(data.boundaryType ?? '').trim();
        const hierarchyType = String(data.hierarchyType ?? '').trim();
        const parent = typeof data.parent === 'string' && data.parent.trim()
          ? data.parent.trim()
          : null;

        if (!code) throw new Error('Boundary code is required');
        if (!hierarchyType) throw new Error('Boundary hierarchy is required');
        if (!boundaryType) throw new Error('Boundary type is required');

        // Resolve and validate the relationship before creating the entity.
        // Without this preflight, a deterministic HIERARCHY_ERROR arrives only
        // after boundary/_create has already published an orphan entity.
        const hierarchyDefinitions = await client.boundaryHierarchySearch(tenantId, hierarchyType);
        const hierarchy = hierarchyDefinitions.find(
          (item) => String(item.hierarchyType ?? '') === hierarchyType,
        );
        if (!hierarchy) {
          throw new Error(`Boundary hierarchy ${hierarchyType} is not defined for tenant ${tenantId}`);
        }
        const levels = Array.isArray(hierarchy.boundaryHierarchy)
          ? (hierarchy.boundaryHierarchy as Record<string, unknown>[]).filter((level) => level.active !== false)
          : [];
        const selectedLevel = levels.find(
          (level) => String(level.boundaryType ?? '') === boundaryType,
        );
        if (!selectedLevel) {
          throw new Error(
            `Boundary type ${boundaryType} is not part of hierarchy ${hierarchyType} for tenant ${tenantId}`,
          );
        }
        const expectedParentType =
          typeof selectedLevel.parentBoundaryType === 'string' && selectedLevel.parentBoundaryType.trim()
            ? selectedLevel.parentBoundaryType.trim()
            : null;

        if (expectedParentType && !parent) {
          throw new Error(`Parent boundary of type ${expectedParentType} is required for ${boundaryType}`);
        }
        if (!expectedParentType && parent) {
          throw new Error(`Root boundary type ${boundaryType} must not define a parent`);
        }

        if (parent && expectedParentType) {
          const trees = await client.boundaryRelationshipSearch(tenantId, hierarchyType);
          const parentRelationship = findBoundaryRelationship(trees, parent);
          if (!parentRelationship) {
            throw new Error(
              `Parent boundary ${parent} does not exist in hierarchy ${hierarchyType} for tenant ${tenantId}`,
            );
          }
          if (String(parentRelationship.node.boundaryType ?? '') !== expectedParentType) {
            throw new Error(
              `Parent boundary ${parent} must have boundary type ${expectedParentType}`,
            );
          }
        }

        // Create the boundary entity (publishes to Kafka for async persistence)
        // and tolerate a verified pre-existing entity so a previous partial
        // create can be resumed by attaching its missing relationship.
        try {
          await client.boundaryCreate(tenantId, [{ code }]);
        } catch (error) {
          if (!isDuplicateError(error)) throw error;
          const existing = await client.boundarySearch(tenantId, [code]);
          if (!existing.some((item) => String(item.code ?? '') === code)) throw error;
        }
        // Retry relationship create — entity may not be persisted yet (Kafka async)
        let lastErr: Error | null = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await client.boundaryRelationshipCreate(tenantId, code, hierarchyType, boundaryType, parent);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err as Error;
            if (isDuplicateError(lastErr)) {
              const trees = await client.boundaryRelationshipSearch(tenantId, hierarchyType);
              const existing = findBoundaryRelationship(trees, code);
              const existingType = String(existing?.node.boundaryType ?? '');
              if (existing && existingType === boundaryType && existing.parentCode === parent) {
                lastErr = null;
                break;
              }
            }
            if (lastErr.message?.toLowerCase().includes('does not exist') && attempt < 4) {
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
        // Opt-in reactivation: when meta.includeInactive is set, fall back to a
        // soft-deleted (inactive) row so Remove -> re-Add can resurrect the uid
        // that delete() left occupied (mdmsUpdate below forces isActive: true).
        const includeInactive = Boolean((params.meta as { includeInactive?: boolean } | undefined)?.includeInactive);
        const existing = records.find((r) => r.isActive) ?? (includeInactive ? records[0] : undefined);
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
        // No form input ever edits reActivateEmployee (EmployeeEdit.tsx has no
        // field for it), so any value present in `rest` is a stale artifact of
        // the form's initial defaultValues (e.g. a create-response cache that
        // never set it) rather than an intentional edit. egov-hrms/employees/
        // _update NPEs on Employee.getReActivateEmployee().booleanValue() when
        // this is null, so `rest`'s value silently overriding the freshly
        // re-fetched `base` — the same failure mode `id` is guarded against
        // above — breaks editing (closes #813). Always trust the fresh fetch.
        merged.reActivateEmployee = base.reActivateEmployee ?? false;
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
          // Only overwrite when the form actually carries a value. A complaint
          // edit that only changes the description leaves serviceCode null on the
          // form (the hierarchy cascade doesn't repopulate it), and blindly
          // merging that null clobbers the real serviceCode → pgr-services NPEs on
          // ASSIGN (it needs the type to validate the assignee's department).
          const val = data[key];
          if (key in data && val != null && val !== '') service[key] = val;
        }
        if (data.address && typeof data.address === 'object') {
          service.address = mergePgrAddress(
            (service.address as Record<string, unknown> | undefined) ?? {},
            data.address as Record<string, unknown>,
          );
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

        // Multi-locale grid: an inline edit emits msg__<locale> fields. Upsert
        // only the locales whose value actually changed.
        const msgKeys = Object.keys(data).filter((k) => k.startsWith('msg__'));
        if (msgKeys.length) {
          const localeWrites: Promise<unknown>[] = [];
          for (const k of msgKeys) {
            if (data[k] === prev[k]) continue;
            const loc = k.slice('msg__'.length);
            localeWrites.push(client.localizationUpsert(tenantId, loc, [
              { code, message: String(data[k] ?? ''), module: mod },
            ]));
          }
          await Promise.all(localeWrites);
          return { data: { ...data, id: String(data.id ?? `${code}__${mod}`) } as RaRecord };
        }

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
      if (config.type === 'user') {
        // egov-user's _updatenovalidate needs the FULL user object (native
        // numeric `id`, auditDetails, roles, etc.). normalizeRecord set the
        // react-admin `id` to the uuid string (idField: 'uuid'), so re-fetch
        // the server record and merge only the form-editable fields onto it —
        // userName and type are disabled in the UI and must round-trip
        // unchanged. Without this branch the update path threw
        // "Update not supported for resource type: user" and Save was a no-op.
        const data = params.data as Record<string, unknown>;
        const uuid = typeof data.uuid === 'string' && data.uuid ? data.uuid : String(params.id);
        const existing = await client.userSearch(tenantId, { uuid: [uuid] });
        if (!existing.length) throw new Error(`User not found: ${uuid}`);
        const base = existing[0] as Record<string, unknown>;
        const editable = ['name', 'mobileNumber', 'emailId', 'gender'];
        const merged: Record<string, unknown> = { ...base };
        for (const key of editable) {
          if (key in data) merged[key] = data[key];
        }
        const updated = await client.userUpdate(merged);
        return { data: normalizeRecord(updated, config) };
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

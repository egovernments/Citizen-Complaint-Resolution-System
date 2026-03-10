# React-Admin DIGIT Management Studio — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the management mode with a react-admin-powered admin studio using ra-core headless + DIGIT UI components.

**Architecture:** Three layers — (1) providers (digitDataProvider, digitAuthProvider, resourceRegistry), (2) DIGIT Admin Kit adapter components wrapping ra-core hooks in DIGIT/Tailwind/Radix UI, (3) thin per-resource page files composing the kit components. Onboarding mode stays untouched.

**Tech Stack:** ra-core, react-hook-form, @tanstack/react-query, existing Tailwind + Radix + TanStack Table

**Design doc:** `docs/plans/2026-03-06-react-admin-digit-studio-design.md`

---

## Task 1: Install ra-core and Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install ra-core and its peer dependencies**

```bash
cd /root/code/ccrs-ui-mockup/utilities/crs_dataloader/ui-mockup
npm install ra-core react-hook-form @tanstack/react-query
```

ra-core requires react-router-dom (already installed), react-hook-form (for forms), and @tanstack/react-query (for data caching).

**Step 2: Verify the app still builds**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install ra-core, react-hook-form, react-query"
```

---

## Task 2: Create Resource Registry

Evolves `entityRegistry.ts` into a react-admin-aware registry that maps resource names to DIGIT API configuration.

**Files:**
- Create: `src/providers/resourceRegistry.ts`

**Step 1: Write test**

Create `src/providers/resourceRegistry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getResourceConfig,
  getAllResources,
  getMdmsResources,
  getResourceIdField,
} from './resourceRegistry';

describe('resourceRegistry', () => {
  it('returns config for known MDMS resource', () => {
    const config = getResourceConfig('departments');
    expect(config).toBeDefined();
    expect(config!.type).toBe('mdms');
    expect(config!.schema).toBe('common-masters.Department');
    expect(config!.idField).toBe('code');
  });

  it('returns config for HRMS resource', () => {
    const config = getResourceConfig('employees');
    expect(config).toBeDefined();
    expect(config!.type).toBe('hrms');
    expect(config!.idField).toBe('uuid');
  });

  it('returns config for boundary resource', () => {
    const config = getResourceConfig('boundaries');
    expect(config).toBeDefined();
    expect(config!.type).toBe('boundary');
  });

  it('returns undefined for unknown resource', () => {
    expect(getResourceConfig('nonexistent')).toBeUndefined();
  });

  it('getAllResources returns all resource names', () => {
    const all = getAllResources();
    expect(all).toContain('departments');
    expect(all).toContain('employees');
    expect(all).toContain('tenants');
    expect(all).toContain('boundaries');
  });

  it('getMdmsResources returns only MDMS resources', () => {
    const mdms = getMdmsResources();
    expect(mdms).toContain('departments');
    expect(mdms).not.toContain('employees');
    expect(mdms).not.toContain('boundaries');
  });

  it('getResourceIdField returns the id field for a resource', () => {
    expect(getResourceIdField('departments')).toBe('code');
    expect(getResourceIdField('employees')).toBe('uuid');
    expect(getResourceIdField('complaints')).toBe('serviceRequestId');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/providers/resourceRegistry.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the resource registry**

Create `src/providers/resourceRegistry.ts`:

```typescript
/**
 * Resource Registry — maps react-admin resource names to DIGIT API config.
 *
 * Three resource types:
 * - mdms: records stored in MDMS v2 (search/create via /mdms-v2/v2/_search, _create)
 * - hrms: employees via /egov-hrms/employees/_search, _create, _update
 * - boundary: boundaries via /boundary-service/boundary/_search, _create
 * - pgr: complaints via /pgr-services (future)
 * - localization: messages via /localization/messages (future)
 */

export interface ResourceConfig {
  /** Resource type determines which API pattern to use */
  type: 'mdms' | 'hrms' | 'boundary' | 'pgr' | 'localization';

  /** Human-readable label */
  label: string;

  /** MDMS schema code (only for type === 'mdms') */
  schema?: string;

  /** The field in each record that serves as the unique ID */
  idField: string;

  /** The field used for human-readable display */
  nameField: string;

  /** Optional description field */
  descriptionField?: string;

  /** API endpoint (for non-MDMS types) */
  endpoint?: string;

  /** Whether this resource has a dedicated list/edit page (vs generic MDMS page) */
  dedicated?: boolean;
}

const REGISTRY: Record<string, ResourceConfig> = {
  // ============================
  // Core resources (dedicated pages)
  // ============================

  tenants: {
    type: 'mdms',
    label: 'Tenants',
    schema: 'tenant.tenants',
    idField: 'code',
    nameField: 'name',
    descriptionField: 'description',
    dedicated: true,
  },

  departments: {
    type: 'mdms',
    label: 'Departments',
    schema: 'common-masters.Department',
    idField: 'code',
    nameField: 'name',
    dedicated: true,
  },

  designations: {
    type: 'mdms',
    label: 'Designations',
    schema: 'common-masters.Designation',
    idField: 'code',
    nameField: 'name',
    dedicated: true,
  },

  'complaint-types': {
    type: 'mdms',
    label: 'Complaint Types',
    schema: 'RAINMAKER-PGR.ServiceDefs',
    idField: 'serviceCode',
    nameField: 'serviceName',
    descriptionField: 'department',
    dedicated: true,
  },

  employees: {
    type: 'hrms',
    label: 'Employees',
    endpoint: '/egov-hrms/employees',
    idField: 'uuid',
    nameField: 'user.name',
    dedicated: true,
  },

  boundaries: {
    type: 'boundary',
    label: 'Boundaries',
    endpoint: '/boundary-service/boundary',
    idField: 'code',
    nameField: 'name',
    descriptionField: 'boundaryType',
    dedicated: true,
  },

  // ============================
  // PGR resources
  // ============================

  complaints: {
    type: 'pgr',
    label: 'Complaints',
    endpoint: '/pgr-services/v2/request',
    idField: 'serviceRequestId',
    nameField: 'serviceRequestId',
    descriptionField: 'description',
    dedicated: true,
  },

  // ============================
  // Localization
  // ============================

  localization: {
    type: 'localization',
    label: 'Localization Messages',
    endpoint: '/localization/messages/v1',
    idField: 'code',
    nameField: 'code',
    descriptionField: 'message',
    dedicated: true,
  },

  // ============================
  // Generic MDMS resources (advanced entities)
  // ============================

  'state-info': {
    type: 'mdms',
    label: 'State Info',
    schema: 'common-masters.StateInfo',
    idField: 'code',
    nameField: 'name',
  },

  branding: {
    type: 'mdms',
    label: 'Tenant Branding',
    schema: 'tenant.branding',
    idField: 'code',
    nameField: 'name',
  },

  'city-modules': {
    type: 'mdms',
    label: 'City Modules',
    schema: 'tenant.citymodule',
    idField: 'code',
    nameField: 'module',
  },

  'id-formats': {
    type: 'mdms',
    label: 'ID Formats',
    schema: 'common-masters.IdFormat',
    idField: 'idname',
    nameField: 'idname',
  },

  roles: {
    type: 'mdms',
    label: 'Roles',
    schema: 'ACCESSCONTROL-ROLES.roles',
    idField: 'code',
    nameField: 'name',
    descriptionField: 'description',
  },

  'role-actions': {
    type: 'mdms',
    label: 'Role Actions',
    schema: 'ACCESSCONTROL-ROLEACTIONS.roleactions',
    idField: 'id',
    nameField: 'rolecode',
  },

  'action-mappings': {
    type: 'mdms',
    label: 'Action Mappings',
    schema: 'ACCESSCONTROL-ACTIONS-TEST.actions-test',
    idField: 'id',
    nameField: 'displayName',
  },

  'gender-types': {
    type: 'mdms',
    label: 'Gender Types',
    schema: 'common-masters.GenderType',
    idField: 'code',
    nameField: 'code',
  },

  'employee-status': {
    type: 'mdms',
    label: 'Employee Status',
    schema: 'egov-hrms.EmployeeStatus',
    idField: 'code',
    nameField: 'code',
  },

  'employee-types': {
    type: 'mdms',
    label: 'Employee Types',
    schema: 'egov-hrms.EmployeeType',
    idField: 'code',
    nameField: 'code',
  },

  'deactivation-reasons': {
    type: 'mdms',
    label: 'Deactivation Reasons',
    schema: 'egov-hrms.DeactivationReason',
    idField: 'code',
    nameField: 'code',
  },

  degrees: {
    type: 'mdms',
    label: 'Degrees',
    schema: 'egov-hrms.Degree',
    idField: 'code',
    nameField: 'code',
  },

  'workflow-services': {
    type: 'mdms',
    label: 'Business Services',
    schema: 'Workflow.BusinessService',
    idField: 'businessService',
    nameField: 'business',
  },

  'workflow-config': {
    type: 'mdms',
    label: 'Workflow Config',
    schema: 'Workflow.BusinessServiceConfig',
    idField: 'businessService',
    nameField: 'businessService',
  },

  'sla-config': {
    type: 'mdms',
    label: 'SLA Config',
    schema: 'common-masters.wfSlaConfig',
    idField: 'businessService',
    nameField: 'businessService',
  },

  'encryption-policy': {
    type: 'mdms',
    label: 'Encryption Policy',
    schema: 'DataSecurity.EncryptionPolicy',
    idField: 'key',
    nameField: 'key',
  },

  'decryption-abac': {
    type: 'mdms',
    label: 'Decryption ABAC',
    schema: 'DataSecurity.DecryptionABAC',
    idField: 'model',
    nameField: 'model',
  },

  'masking-patterns': {
    type: 'mdms',
    label: 'Masking Patterns',
    schema: 'DataSecurity.MaskingPatterns',
    idField: 'patternId',
    nameField: 'patternId',
  },

  'security-policy': {
    type: 'mdms',
    label: 'Security Policy',
    schema: 'DataSecurity.SecurityPolicy',
    idField: 'model',
    nameField: 'model',
  },

  'inbox-config': {
    type: 'mdms',
    label: 'Inbox Config',
    schema: 'INBOX.InboxQueryConfiguration',
    idField: 'module',
    nameField: 'module',
  },

  'cron-jobs': {
    type: 'mdms',
    label: 'Cron Jobs',
    schema: 'common-masters.CronJobAPIConfig',
    idField: 'jobName',
    nameField: 'jobName',
  },

  'ui-homepage': {
    type: 'mdms',
    label: 'UI Homepage',
    schema: 'common-masters.uiHomePage',
    idField: 'name',
    nameField: 'name',
  },

  specializations: {
    type: 'mdms',
    label: 'Specializations',
    schema: 'egov-hrms.Specalization',
    idField: 'code',
    nameField: 'code',
  },

  'employment-tests': {
    type: 'mdms',
    label: 'Employment Tests',
    schema: 'egov-hrms.EmploymentTest',
    idField: 'code',
    nameField: 'code',
  },

  'auto-escalation': {
    type: 'mdms',
    label: 'Auto Escalation',
    schema: 'Workflow.AutoEscalation',
    idField: 'businessService',
    nameField: 'businessService',
  },
};

// ============================
// Accessors
// ============================

export function getResourceConfig(resource: string): ResourceConfig | undefined {
  return REGISTRY[resource];
}

export function getAllResources(): string[] {
  return Object.keys(REGISTRY);
}

export function getDedicatedResources(): string[] {
  return Object.entries(REGISTRY)
    .filter(([, cfg]) => cfg.dedicated)
    .map(([name]) => name);
}

export function getMdmsResources(): string[] {
  return Object.entries(REGISTRY)
    .filter(([, cfg]) => cfg.type === 'mdms')
    .map(([name]) => name);
}

export function getGenericMdmsResources(): string[] {
  return Object.entries(REGISTRY)
    .filter(([, cfg]) => cfg.type === 'mdms' && !cfg.dedicated)
    .map(([name]) => name);
}

export function getResourceIdField(resource: string): string {
  return REGISTRY[resource]?.idField ?? 'id';
}

export function getResourceLabel(resource: string): string {
  return REGISTRY[resource]?.label ?? resource;
}

export { REGISTRY };
```

**Step 4: Run test to verify it passes**

```bash
npx vitest run src/providers/resourceRegistry.test.ts
```

Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add src/providers/resourceRegistry.ts src/providers/resourceRegistry.test.ts
git commit -m "feat: add resource registry for react-admin integration"
```

---

## Task 3: Create the DIGIT Data Provider

The heart of the integration — maps ra-core's 9 methods to DIGIT API calls.

**Files:**
- Create: `src/providers/digitDataProvider.ts`
- Create: `src/providers/digitDataProvider.test.ts`

**Step 1: Write test**

Create `src/providers/digitDataProvider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiClient before importing
vi.mock('../api/client', () => ({
  apiClient: {
    post: vi.fn(),
    buildRequestInfo: vi.fn(() => ({ apiId: 'test', msgId: 'test', authToken: 'test' })),
    getAuth: vi.fn(() => ({ tenantId: 'pg' })),
  },
}));

import { digitDataProvider } from './digitDataProvider';
import { apiClient } from '../api/client';

const mockPost = vi.mocked(apiClient.post);

describe('digitDataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getList', () => {
    it('fetches MDMS list and normalizes records with id field', async () => {
      mockPost.mockResolvedValueOnce({
        mdms: [
          { id: '1', uniqueIdentifier: 'DEPT_1', data: { code: 'DEPT_1', name: 'Health', active: true }, isActive: true },
          { id: '2', uniqueIdentifier: 'DEPT_2', data: { code: 'DEPT_2', name: 'Revenue', active: true }, isActive: true },
        ],
      });

      const result = await digitDataProvider.getList('departments', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'code', order: 'ASC' },
        filter: {},
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toHaveProperty('id', 'DEPT_1');
      expect(result.data[0]).toHaveProperty('name', 'Health');
    });

    it('applies client-side sorting', async () => {
      mockPost.mockResolvedValueOnce({
        mdms: [
          { id: '1', uniqueIdentifier: 'B', data: { code: 'B', name: 'Bravo' }, isActive: true },
          { id: '2', uniqueIdentifier: 'A', data: { code: 'A', name: 'Alpha' }, isActive: true },
        ],
      });

      const result = await digitDataProvider.getList('departments', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'code', order: 'ASC' },
        filter: {},
      });

      expect(result.data[0].id).toBe('A');
      expect(result.data[1].id).toBe('B');
    });
  });

  describe('getOne', () => {
    it('fetches single MDMS record and normalizes', async () => {
      mockPost.mockResolvedValueOnce({
        mdms: [
          { id: '1', uniqueIdentifier: 'DEPT_1', data: { code: 'DEPT_1', name: 'Health' }, isActive: true },
        ],
      });

      const result = await digitDataProvider.getOne('departments', { id: 'DEPT_1' });

      expect(result.data).toHaveProperty('id', 'DEPT_1');
      expect(result.data).toHaveProperty('name', 'Health');
    });
  });

  describe('create', () => {
    it('creates MDMS record and returns normalized result', async () => {
      mockPost.mockResolvedValueOnce({
        Mdms: { id: '3', uniqueIdentifier: 'DEPT_3', data: { code: 'DEPT_3', name: 'New' }, isActive: true },
      });

      const result = await digitDataProvider.create('departments', {
        data: { code: 'DEPT_3', name: 'New', active: true },
      });

      expect(result.data).toHaveProperty('id', 'DEPT_3');
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/providers/digitDataProvider.test.ts
```

Expected: FAIL — module not found.

**Step 3: Write the data provider**

Create `src/providers/digitDataProvider.ts`:

```typescript
/**
 * DIGIT Data Provider for react-admin (ra-core).
 *
 * Implements the 9 DataProvider methods by delegating to the existing
 * DIGIT API services (mdmsService, hrmsService, boundaryService, localizationService).
 *
 * Key responsibilities:
 * - Normalize DIGIT records to have an `id` field (ra-core requires this)
 * - Translate ra-core pagination (page/perPage) to DIGIT (limit/offset)
 * - Apply client-side sorting (DIGIT APIs mostly don't sort server-side)
 * - Map resource names to API endpoints via resourceRegistry
 */

import type { DataProvider, GetListParams, GetListResult, GetOneParams, GetOneResult, GetManyParams, GetManyResult, GetManyReferenceParams, GetManyReferenceResult, CreateParams, CreateResult, UpdateParams, UpdateResult, UpdateManyParams, UpdateManyResult, DeleteParams, DeleteResult, DeleteManyParams, DeleteManyResult, RaRecord } from 'ra-core';
import { apiClient } from '@/api/client';
import { ENDPOINTS } from '@/api/config';
import { getResourceConfig } from './resourceRegistry';
import type { ResourceConfig } from './resourceRegistry';
import type { MdmsRecord, Employee } from '@/api/types';

// ============================
// Helpers
// ============================

/** Extract the id value from a record using the resource's idField */
function extractId(record: Record<string, unknown>, config: ResourceConfig): string {
  // For employees, id is nested: employee.uuid or employee.user.uuid
  if (config.type === 'hrms') {
    return String(record['uuid'] ?? record['code'] ?? record['id'] ?? '');
  }
  return String(record[config.idField] ?? record['id'] ?? '');
}

/** Normalize a DIGIT record to include an `id` field that ra-core expects */
function normalizeRecord(raw: Record<string, unknown>, config: ResourceConfig): RaRecord {
  const id = extractId(raw, config);
  return { ...raw, id };
}

/** Normalize an MDMS wrapper: unwrap .data and merge audit info */
function normalizeMdmsRecord(mdmsRecord: MdmsRecord, config: ResourceConfig): RaRecord {
  const data = mdmsRecord.data ?? {};
  const id = extractId(data, config);
  return {
    ...data,
    id,
    _mdmsId: mdmsRecord.id,
    _uniqueIdentifier: mdmsRecord.uniqueIdentifier,
    _isActive: mdmsRecord.isActive,
    _auditDetails: mdmsRecord.auditDetails,
  };
}

/** Get tenantId from apiClient */
function getTenantId(meta?: Record<string, unknown>): string {
  return (meta?.tenantId as string) ?? apiClient.getAuth().tenantId;
}

/** Client-side sort */
function sortRecords(records: RaRecord[], field: string, order: 'ASC' | 'DESC'): RaRecord[] {
  return [...records].sort((a, b) => {
    const aVal = getNestedValue(a, field);
    const bVal = getNestedValue(b, field);
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
    return order === 'ASC' ? cmp : -cmp;
  });
}

/** Get nested value from object (e.g. "user.name" → record.user.name) */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

/** Client-side filter: match all filter keys against record values */
function filterRecords(records: RaRecord[], filter: Record<string, unknown>): RaRecord[] {
  if (!filter || Object.keys(filter).length === 0) return records;

  return records.filter(record => {
    return Object.entries(filter).every(([key, value]) => {
      if (value === undefined || value === null || value === '') return true;

      // Special: q is a global search across all string fields
      if (key === 'q') {
        const q = String(value).toLowerCase();
        return Object.values(record).some(
          v => typeof v === 'string' && v.toLowerCase().includes(q)
        );
      }

      const recordVal = getNestedValue(record, key);
      if (typeof value === 'string') {
        return String(recordVal ?? '').toLowerCase().includes(value.toLowerCase());
      }
      return recordVal === value;
    });
  });
}

/** Paginate records */
function paginateRecords(records: RaRecord[], page: number, perPage: number): RaRecord[] {
  const start = (page - 1) * perPage;
  return records.slice(start, start + perPage);
}

// ============================
// MDMS methods
// ============================

async function mdmsGetList(config: ResourceConfig, params: GetListParams): Promise<GetListResult> {
  const tenantId = getTenantId(params.meta);
  const response = await apiClient.post(ENDPOINTS.MDMS_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo(),
    MdmsCriteria: {
      tenantId,
      schemaCode: config.schema,
      limit: 500, // fetch all, paginate client-side
      offset: 0,
    },
  });

  const mdmsRecords = ((response as Record<string, unknown>).mdms ?? []) as MdmsRecord[];
  let records = mdmsRecords
    .filter(r => r.isActive !== false)
    .map(r => normalizeMdmsRecord(r, config));

  records = filterRecords(records, params.filter);
  records = sortRecords(records, params.sort.field, params.sort.order);
  const total = records.length;
  const data = paginateRecords(records, params.pagination.page, params.pagination.perPage);

  return { data, total };
}

async function mdmsGetOne(config: ResourceConfig, params: GetOneParams): Promise<GetOneResult> {
  const tenantId = getTenantId(params.meta);
  const response = await apiClient.post(ENDPOINTS.MDMS_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo(),
    MdmsCriteria: {
      tenantId,
      schemaCode: config.schema,
      uniqueIdentifiers: [String(params.id)],
      limit: 1,
    },
  });

  const mdmsRecords = ((response as Record<string, unknown>).mdms ?? []) as MdmsRecord[];
  if (mdmsRecords.length === 0) {
    throw new Error(`Record "${params.id}" not found in ${config.schema}`);
  }

  return { data: normalizeMdmsRecord(mdmsRecords[0], config) };
}

async function mdmsGetMany(config: ResourceConfig, params: GetManyParams): Promise<GetManyResult> {
  const tenantId = getTenantId(params.meta);
  const ids = params.ids.map(String);
  const response = await apiClient.post(ENDPOINTS.MDMS_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo(),
    MdmsCriteria: {
      tenantId,
      schemaCode: config.schema,
      uniqueIdentifiers: ids,
      limit: ids.length,
    },
  });

  const mdmsRecords = ((response as Record<string, unknown>).mdms ?? []) as MdmsRecord[];
  const data = mdmsRecords.map(r => normalizeMdmsRecord(r, config));
  return { data };
}

async function mdmsCreate(config: ResourceConfig, params: CreateParams): Promise<CreateResult> {
  const tenantId = getTenantId(params.meta);
  const idValue = String(params.data[config.idField] ?? '');

  const response = await apiClient.post(`${ENDPOINTS.MDMS_CREATE}/${config.schema}`, {
    RequestInfo: apiClient.buildRequestInfo(),
    Mdms: {
      tenantId,
      schemaCode: config.schema,
      uniqueIdentifier: idValue,
      data: params.data,
      isActive: true,
    },
  });

  const created = (response as Record<string, unknown>).Mdms as MdmsRecord;
  return { data: normalizeMdmsRecord(created, config) };
}

// ============================
// HRMS methods
// ============================

async function hrmsGetList(config: ResourceConfig, params: GetListParams): Promise<GetListResult> {
  const tenantId = getTenantId(params.meta);
  const response = await apiClient.post(ENDPOINTS.HRMS_EMPLOYEES_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo({ action: '_search' }),
    criteria: {
      tenantId,
      limit: 500,
      offset: 0,
    },
  });

  let records = (((response as Record<string, unknown>).Employees ?? []) as Employee[])
    .map(emp => normalizeRecord(emp as unknown as Record<string, unknown>, config));

  records = filterRecords(records, params.filter);
  records = sortRecords(records, params.sort.field, params.sort.order);
  const total = records.length;
  const data = paginateRecords(records, params.pagination.page, params.pagination.perPage);

  return { data, total };
}

async function hrmsGetOne(config: ResourceConfig, params: GetOneParams): Promise<GetOneResult> {
  const tenantId = getTenantId(params.meta);
  const response = await apiClient.post(ENDPOINTS.HRMS_EMPLOYEES_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo({ action: '_search' }),
    criteria: {
      tenantId,
      codes: [String(params.id)],
      limit: 1,
    },
  });

  const employees = ((response as Record<string, unknown>).Employees ?? []) as Employee[];
  if (employees.length === 0) {
    throw new Error(`Employee "${params.id}" not found`);
  }

  return { data: normalizeRecord(employees[0] as unknown as Record<string, unknown>, config) };
}

async function hrmsCreate(config: ResourceConfig, params: CreateParams): Promise<CreateResult> {
  const response = await apiClient.post(ENDPOINTS.HRMS_EMPLOYEES_CREATE, {
    RequestInfo: apiClient.buildRequestInfo({ action: '_create' }),
    Employees: [params.data],
  });

  const created = ((response as Record<string, unknown>).Employees ?? []) as Employee[];
  if (created.length === 0) throw new Error('Employee creation failed');
  return { data: normalizeRecord(created[0] as unknown as Record<string, unknown>, config) };
}

async function hrmsUpdate(config: ResourceConfig, params: UpdateParams): Promise<UpdateResult> {
  const response = await apiClient.post(ENDPOINTS.HRMS_EMPLOYEES_UPDATE, {
    RequestInfo: apiClient.buildRequestInfo({ action: '_update' }),
    Employees: [params.data],
  });

  const updated = ((response as Record<string, unknown>).Employees ?? []) as Employee[];
  if (updated.length === 0) throw new Error('Employee update failed');
  return { data: normalizeRecord(updated[0] as unknown as Record<string, unknown>, config) };
}

// ============================
// Boundary methods
// ============================

async function boundaryGetList(config: ResourceConfig, params: GetListParams): Promise<GetListResult> {
  const tenantId = getTenantId(params.meta);
  const response = await apiClient.post(ENDPOINTS.BOUNDARY_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo(),
    Boundary: {
      tenantId,
      hierarchyType: (params.filter?.hierarchyType as string) ?? 'ADMIN',
      limit: 1000,
      offset: 0,
    },
  });

  // Flatten nested boundary tree
  const tenantBoundaries = ((response as Record<string, unknown>).TenantBoundary ?? []) as Array<{ boundary: Record<string, unknown> }>;
  const flatList: RaRecord[] = [];

  function flatten(boundary: Record<string, unknown>): void {
    flatList.push(normalizeRecord({
      code: boundary.code,
      name: boundary.name ?? boundary.code,
      boundaryType: boundary.boundaryType,
      parent: boundary.parent,
      tenantId: boundary.tenantId ?? tenantId,
    }, config));

    const children = boundary.children as Record<string, unknown>[] | undefined;
    if (children) children.forEach(flatten);
  }

  for (const tb of tenantBoundaries) {
    if (tb.boundary) flatten(tb.boundary);
  }

  let records = filterRecords(flatList, params.filter);
  records = sortRecords(records, params.sort.field, params.sort.order);
  const total = records.length;
  const data = paginateRecords(records, params.pagination.page, params.pagination.perPage);

  return { data, total };
}

async function boundaryGetOne(config: ResourceConfig, params: GetOneParams): Promise<GetOneResult> {
  // Boundary service doesn't have a get-by-id; search and filter
  const result = await boundaryGetList(config, {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'code', order: 'ASC' },
    filter: {},
    meta: params.meta,
  });

  const match = result.data.find(r => r.id === params.id || r['code'] === params.id);
  if (!match) throw new Error(`Boundary "${params.id}" not found`);
  return { data: match };
}

// ============================
// Dispatch by resource type
// ============================

function getConfig(resource: string): ResourceConfig {
  const config = getResourceConfig(resource);
  if (!config) throw new Error(`Unknown resource: "${resource}". Register it in resourceRegistry.`);
  return config;
}

function notSupported(method: string, resource: string): never {
  throw new Error(`${method} is not supported for resource "${resource}"`);
}

export const digitDataProvider: DataProvider = {
  async getList(resource, params) {
    const config = getConfig(resource);
    switch (config.type) {
      case 'mdms': return mdmsGetList(config, params);
      case 'hrms': return hrmsGetList(config, params);
      case 'boundary': return boundaryGetList(config, params);
      default: return mdmsGetList(config, params); // fallback
    }
  },

  async getOne(resource, params) {
    const config = getConfig(resource);
    switch (config.type) {
      case 'mdms': return mdmsGetOne(config, params);
      case 'hrms': return hrmsGetOne(config, params);
      case 'boundary': return boundaryGetOne(config, params);
      default: return mdmsGetOne(config, params);
    }
  },

  async getMany(resource, params) {
    const config = getConfig(resource);
    switch (config.type) {
      case 'mdms': return mdmsGetMany(config, params);
      default: {
        // Fallback: getOne per id
        const results = await Promise.all(
          params.ids.map(id => digitDataProvider.getOne(resource, { id, meta: params.meta }))
        );
        return { data: results.map(r => r.data) };
      }
    }
  },

  async getManyReference(resource, params) {
    // Fetch list filtered by the target field
    const result = await digitDataProvider.getList(resource, {
      pagination: params.pagination,
      sort: params.sort,
      filter: { ...params.filter, [params.target]: params.id },
      meta: params.meta,
    });
    return result;
  },

  async create(resource, params) {
    const config = getConfig(resource);
    switch (config.type) {
      case 'mdms': return mdmsCreate(config, params);
      case 'hrms': return hrmsCreate(config, params);
      default: notSupported('create', resource);
    }
  },

  async update(resource, params) {
    const config = getConfig(resource);
    switch (config.type) {
      case 'hrms': return hrmsUpdate(config, params);
      case 'mdms': {
        // MDMS v2 doesn't have a true update — delete + recreate pattern
        // For now, treat as create (idempotent in DIGIT)
        return mdmsCreate(config, { data: params.data, meta: params.meta });
      }
      default: notSupported('update', resource);
    }
  },

  async updateMany(_resource, _params) {
    // Not needed for v1
    return { data: [] };
  },

  async delete(resource, params) {
    const config = getConfig(resource);
    if (config.type === 'hrms') {
      // Deactivate employee
      const current = await hrmsGetOne(config, { id: params.id, meta: params.meta });
      const deactivated = { ...current.data, employeeStatus: 'INACTIVE' };
      const result = await hrmsUpdate(config, {
        id: params.id,
        data: deactivated,
        previousData: current.data,
        meta: params.meta,
      });
      return result;
    }
    // MDMS: would need _update to set isActive=false — stub for now
    return { data: { id: params.id } as RaRecord };
  },

  async deleteMany(_resource, params) {
    return { data: params.ids };
  },
};
```

**Step 4: Run tests**

```bash
npx vitest run src/providers/digitDataProvider.test.ts
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/providers/digitDataProvider.ts src/providers/digitDataProvider.test.ts
git commit -m "feat: add DIGIT data provider for ra-core integration"
```

---

## Task 4: Create the Auth Provider

**Files:**
- Create: `src/providers/digitAuthProvider.ts`

**Step 1: Write test**

Create `src/providers/digitAuthProvider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  apiClient: {
    isAuthenticated: vi.fn(() => true),
    getAuth: vi.fn(() => ({
      token: 'test-token',
      user: { uuid: 'u1', name: 'Test User', roles: [{ code: 'EMPLOYEE' }] },
      tenantId: 'pg',
    })),
    logout: vi.fn(),
  },
}));

import { digitAuthProvider } from './digitAuthProvider';

describe('digitAuthProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('checkAuth resolves when authenticated', async () => {
    await expect(digitAuthProvider.checkAuth()).resolves.toBeUndefined();
  });

  it('getIdentity returns user info', async () => {
    const identity = await digitAuthProvider.getIdentity();
    expect(identity).toEqual({ id: 'u1', fullName: 'Test User' });
  });

  it('getPermissions returns role codes', async () => {
    const perms = await digitAuthProvider.getPermissions();
    expect(perms).toEqual(['EMPLOYEE']);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx vitest run src/providers/digitAuthProvider.test.ts
```

**Step 3: Write the auth provider**

Create `src/providers/digitAuthProvider.ts`:

```typescript
/**
 * DIGIT Auth Provider for react-admin (ra-core).
 *
 * Bridges the existing apiClient OAuth2 flow to ra-core's auth system.
 * The LoginPage remains unchanged — this provider just tells ra-core
 * whether the user is logged in and what their identity/permissions are.
 */

import type { AuthProvider } from 'ra-core';
import { apiClient } from '@/api/client';

const AUTH_STORAGE_KEY = 'crs-auth-state';

export const digitAuthProvider: AuthProvider = {
  /**
   * Login is handled by the existing LoginPage.tsx which calls apiClient.login()
   * directly and updates AppContext. This method is a no-op stub because ra-core
   * requires it, but the actual login flow bypasses it.
   */
  async login() {
    // Handled externally by LoginPage
  },

  /**
   * Check if the user is authenticated. Called on every route change.
   * Throws to redirect to /login.
   */
  async checkAuth() {
    if (!apiClient.isAuthenticated()) {
      throw new Error('Not authenticated');
    }
  },

  /**
   * Called when an API call returns an error. If 401/403, reject to force logout.
   */
  async checkError(error: { status?: number }) {
    if (error.status === 401 || error.status === 403) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      apiClient.logout();
      throw new Error('Session expired');
    }
  },

  /**
   * Logout. Clear everything.
   */
  async logout() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    apiClient.logout();
    return '/login';
  },

  /**
   * Return user identity for display in the UI.
   */
  async getIdentity() {
    const { user } = apiClient.getAuth();
    return {
      id: user?.uuid ?? user?.userName ?? 'unknown',
      fullName: user?.name ?? 'Unknown',
    };
  },

  /**
   * Return user permissions (role codes) for role-based access control.
   */
  async getPermissions() {
    const { user } = apiClient.getAuth();
    return user?.roles?.map(r => r.code) ?? [];
  },
};
```

**Step 4: Run test**

```bash
npx vitest run src/providers/digitAuthProvider.test.ts
```

Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add src/providers/digitAuthProvider.ts src/providers/digitAuthProvider.test.ts
git commit -m "feat: add DIGIT auth provider for ra-core integration"
```

---

## Task 5: Build DIGIT Admin Kit — DigitList

The first adapter component. Wraps `useListController` from ra-core inside a DIGIT-styled card with header, search, and table area.

**Files:**
- Create: `src/admin/DigitList.tsx`

**Step 1: Write the component**

```tsx
/**
 * DigitList — List page wrapper for the DIGIT Admin Kit.
 *
 * Uses ra-core's useListController for data fetching, pagination, sorting,
 * and filtering. Renders a DIGIT-styled page with header, search bar,
 * and children (typically a DigitDatagrid).
 */

import { useListController, ListContextProvider } from 'ra-core';
import type { ReactNode } from 'react';
import { DigitCard, DigitCardHeader } from '@/components/digit';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Plus, Search } from 'lucide-react';

interface DigitListProps {
  /** Page title */
  title: string;
  /** Resource name (auto-injected by ra-core if inside a Resource, but can be overridden) */
  resource?: string;
  /** Children — typically DigitDatagrid */
  children: ReactNode;
  /** Show create button */
  hasCreate?: boolean;
  /** Callback when create button is clicked */
  onCreate?: () => void;
  /** Extra toolbar buttons */
  actions?: ReactNode;
  /** Default sort */
  sort?: { field: string; order: 'ASC' | 'DESC' };
  /** Default items per page */
  perPage?: number;
  /** Permanent filter (always applied, not visible to user) */
  filter?: Record<string, unknown>;
}

export function DigitList({
  title,
  resource,
  children,
  hasCreate = false,
  onCreate,
  actions,
  sort = { field: 'id', order: 'ASC' },
  perPage = 25,
  filter,
}: DigitListProps) {
  const listContext = useListController({
    resource,
    sort,
    perPage,
    filter,
  });

  const { total, isPending, filterValues, setFilters, refetch } = listContext;

  const searchValue = (filterValues?.q as string) ?? '';

  return (
    <ListContextProvider value={listContext}>
      <div className="space-y-4">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground font-['Roboto_Condensed']">{title}</h1>
            {total !== undefined && (
              <Badge variant="secondary" className="mt-1 text-xs">
                {total} {total === 1 ? 'record' : 'records'}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isPending}
            >
              <RefreshCw className={`w-4 h-4 mr-1 ${isPending ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            {hasCreate && (
              <Button size="sm" onClick={onCreate} className="bg-primary hover:bg-primary/90">
                <Plus className="w-4 h-4 mr-1" />
                Create
              </Button>
            )}
          </div>
        </div>

        {/* Search + Content Card */}
        <DigitCard>
          {/* Search Bar */}
          <div className="p-4 border-b border-border">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchValue}
                onChange={(e) => setFilters({ ...filterValues, q: e.target.value }, undefined)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Children (Datagrid, etc.) */}
          <div className="p-0">
            {children}
          </div>
        </DigitCard>
      </div>
    </ListContextProvider>
  );
}
```

**Step 2: Verify it compiles**

```bash
npx tsc --noEmit --project tsconfig.app.json 2>&1 | head -20
```

We may get import errors if types don't match perfectly — fix as needed. The key is the pattern is right.

**Step 3: Commit**

```bash
git add src/admin/DigitList.tsx
git commit -m "feat: add DigitList adapter component"
```

---

## Task 6: Build DIGIT Admin Kit — DigitDatagrid

Wires `useListContext` to TanStack Table with DIGIT styling.

**Files:**
- Create: `src/admin/DigitDatagrid.tsx`

**Step 1: Write the component**

```tsx
/**
 * DigitDatagrid — Data table powered by ra-core's ListContext + TanStack Table.
 *
 * Reads data/sort/pagination from ListContext and renders a DIGIT-styled table
 * with sortable columns, row click navigation, and pagination.
 */

import { useListContext, useResourceContext } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

// ============================
// Column Definition
// ============================

export interface DigitColumn {
  /** Field path in the record (e.g. "code", "user.name") */
  source: string;
  /** Column header label */
  label: string;
  /** Whether this column is sortable (default: true) */
  sortable?: boolean;
  /** Custom cell renderer */
  render?: (record: Record<string, unknown>) => ReactNode;
}

interface DigitDatagridProps {
  columns: DigitColumn[];
  /** Navigate to detail page on row click */
  rowClick?: 'show' | 'edit' | false;
  /** Custom row click handler */
  onRowClick?: (record: Record<string, unknown>) => void;
  /** Extra column with action buttons */
  actions?: (record: Record<string, unknown>) => ReactNode;
}

/** Get a nested value from an object given a dot path */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function DigitDatagrid({
  columns,
  rowClick = false,
  onRowClick,
  actions,
}: DigitDatagridProps) {
  const { data, isPending, sort, setSort, page, perPage, total, setPage } = useListContext();
  const resource = useResourceContext();
  const navigate = useNavigate();

  const totalPages = total ? Math.ceil(total / perPage) : 1;

  const handleSort = (field: string) => {
    if (sort?.field === field) {
      setSort({ field, order: sort.order === 'ASC' ? 'DESC' : 'ASC' });
    } else {
      setSort({ field, order: 'ASC' });
    }
  };

  const handleRowClick = (record: Record<string, unknown>) => {
    if (onRowClick) {
      onRowClick(record);
      return;
    }
    if (rowClick === 'show') {
      navigate(`/${resource}/${encodeURIComponent(String(record.id))}/show`);
    } else if (rowClick === 'edit') {
      navigate(`/${resource}/${encodeURIComponent(String(record.id))}`);
    }
  };

  if (isPending) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No records found.
      </div>
    );
  }

  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead
                key={col.source}
                className={col.sortable !== false ? 'cursor-pointer select-none hover:bg-muted/50' : ''}
                onClick={() => col.sortable !== false && handleSort(col.source)}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {col.sortable !== false && (
                    sort?.field === col.source
                      ? sort.order === 'ASC'
                        ? <ChevronUp className="w-3 h-3" />
                        : <ChevronDown className="w-3 h-3" />
                      : <ChevronsUpDown className="w-3 h-3 text-muted-foreground/40" />
                  )}
                </div>
              </TableHead>
            ))}
            {actions && <TableHead className="w-[100px]">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((record) => (
            <TableRow
              key={String(record.id)}
              className={rowClick || onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''}
              onClick={() => (rowClick || onRowClick) && handleRowClick(record as unknown as Record<string, unknown>)}
            >
              {columns.map((col) => (
                <TableCell key={col.source}>
                  {col.render
                    ? col.render(record as unknown as Record<string, unknown>)
                    : String(getNestedValue(record as unknown as Record<string, unknown>, col.source) ?? '—')
                  }
                </TableCell>
              ))}
              {actions && (
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {actions(record as unknown as Record<string, unknown>)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div className="text-sm text-muted-foreground">
            Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total ?? 0)} of {total}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm px-2">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/admin/DigitDatagrid.tsx
git commit -m "feat: add DigitDatagrid adapter component"
```

---

## Task 7: Build DIGIT Admin Kit — DigitShow, DigitEdit, DigitCreate, DigitFormInput

**Files:**
- Create: `src/admin/DigitShow.tsx`
- Create: `src/admin/DigitEdit.tsx`
- Create: `src/admin/DigitCreate.tsx`
- Create: `src/admin/DigitFormInput.tsx`
- Create: `src/admin/index.ts`

**Step 1: Write DigitShow** (`src/admin/DigitShow.tsx`)

```tsx
import { useShowController, useResourceContext } from 'ra-core';
import type { ReactNode } from 'react';
import { DigitCard, DigitCardHeader } from '@/components/digit';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';

interface DigitShowProps {
  title?: string;
  children: ReactNode;
  hasEdit?: boolean;
}

export function DigitShow({ title, children, hasEdit = false }: DigitShowProps) {
  const { record, isPending } = useShowController();
  const resource = useResourceContext();
  const navigate = useNavigate();

  if (isPending || !record) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold text-foreground font-['Roboto_Condensed']">
          {title ?? `${resource} / ${record.id}`}
        </h1>
        {hasEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/${resource}/${encodeURIComponent(String(record.id))}`)}
          >
            <Pencil className="w-4 h-4 mr-1" /> Edit
          </Button>
        )}
      </div>

      <DigitCard>
        <div className="p-6 space-y-4">
          {children}
        </div>
      </DigitCard>
    </div>
  );
}
```

**Step 2: Write DigitEdit** (`src/admin/DigitEdit.tsx`)

```tsx
import { EditBase, useEditContext, Form } from 'ra-core';
import type { ReactNode } from 'react';
import { DigitCard } from '@/components/digit';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';

interface DigitEditProps {
  title?: string;
  children: ReactNode;
}

export function DigitEdit({ title, children }: DigitEditProps) {
  return (
    <EditBase mutationMode="pessimistic">
      <DigitEditView title={title}>{children}</DigitEditView>
    </EditBase>
  );
}

function DigitEditView({ title, children }: DigitEditProps) {
  const { record, isPending, save } = useEditContext();
  const navigate = useNavigate();

  if (isPending || !record) {
    return <div className="p-8 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold text-foreground font-['Roboto_Condensed']">
          {title ?? `Edit ${record.id}`}
        </h1>
      </div>

      <DigitCard>
        <Form onSubmit={(data) => save?.(data)}>
          <div className="p-6 space-y-4">
            {children}
          </div>
          <div className="p-4 border-t border-border flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90">
              <Save className="w-4 h-4 mr-1" /> Save
            </Button>
          </div>
        </Form>
      </DigitCard>
    </div>
  );
}
```

**Step 3: Write DigitCreate** (`src/admin/DigitCreate.tsx`)

```tsx
import { CreateBase, useCreateContext, Form } from 'ra-core';
import type { ReactNode } from 'react';
import { DigitCard } from '@/components/digit';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';

interface DigitCreateProps {
  title?: string;
  children: ReactNode;
}

export function DigitCreate({ title, children }: DigitCreateProps) {
  return (
    <CreateBase>
      <DigitCreateView title={title}>{children}</DigitCreateView>
    </CreateBase>
  );
}

function DigitCreateView({ title, children }: DigitCreateProps) {
  const { save } = useCreateContext();
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-bold text-foreground font-['Roboto_Condensed']">
          {title ?? 'Create'}
        </h1>
      </div>

      <DigitCard>
        <Form onSubmit={(data) => save?.(data)}>
          <div className="p-6 space-y-4">
            {children}
          </div>
          <div className="p-4 border-t border-border flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" className="bg-primary hover:bg-primary/90">
              <Save className="w-4 h-4 mr-1" /> Create
            </Button>
          </div>
        </Form>
      </DigitCard>
    </div>
  );
}
```

**Step 4: Write DigitFormInput** (`src/admin/DigitFormInput.tsx`)

```tsx
import { useInput } from 'ra-core';
import type { InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DigitFormInputProps extends InputProps {
  label?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}

export function DigitFormInput({
  label,
  placeholder,
  type = 'text',
  disabled = false,
  ...props
}: DigitFormInputProps) {
  const { field, fieldState } = useInput(props);

  return (
    <div className="space-y-1.5">
      {label && (
        <Label htmlFor={field.name} className="text-sm font-medium text-foreground">
          {label}
          {props.validate && <span className="text-destructive ml-1">*</span>}
        </Label>
      )}
      <Input
        {...field}
        id={field.name}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        className={fieldState.error ? 'border-destructive' : ''}
      />
      {fieldState.error && (
        <p className="text-xs text-destructive">{fieldState.error.message}</p>
      )}
    </div>
  );
}
```

**Step 5: Write barrel export** (`src/admin/index.ts`)

```typescript
export { DigitList } from './DigitList';
export { DigitDatagrid } from './DigitDatagrid';
export type { DigitColumn } from './DigitDatagrid';
export { DigitShow } from './DigitShow';
export { DigitEdit } from './DigitEdit';
export { DigitCreate } from './DigitCreate';
export { DigitFormInput } from './DigitFormInput';
```

**Step 6: Commit**

```bash
git add src/admin/
git commit -m "feat: add DIGIT Admin Kit components (Show, Edit, Create, FormInput)"
```

---

## Task 8: Build DigitLayout

The management mode layout with sidebar navigation, replacing ManagementLayout.tsx.

**Files:**
- Create: `src/admin/DigitLayout.tsx`

**Step 1: Write the layout**

```tsx
/**
 * DigitLayout — Management mode layout for react-admin.
 *
 * Sidebar navigation + top header + main content area.
 * Replaces ManagementLayout.tsx.
 */

import { useState } from 'react';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useApp } from '@/App';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Building2, MapPin, Users, Briefcase, Award,
  AlertTriangle, Globe, LayoutDashboard, Settings,
  ChevronLeft, ChevronRight, LogOut, HelpCircle, User,
  Database,
} from 'lucide-react';
import { DocsPane } from '@/components/layout/DocsPane';
import { ENVIRONMENTS } from '@/api/config';

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/manage', icon: LayoutDashboard },
  { label: 'Tenants', path: '/manage/tenants', icon: Building2 },
  { label: 'Boundaries', path: '/manage/boundaries', icon: MapPin },
  { label: 'Departments', path: '/manage/departments', icon: Briefcase },
  { label: 'Designations', path: '/manage/designations', icon: Award },
  { label: 'Complaint Types', path: '/manage/complaint-types', icon: AlertTriangle },
  { label: 'Employees', path: '/manage/employees', icon: Users },
  { label: 'Localization', path: '/manage/localization', icon: Globe },
  { label: 'Advanced', path: '/manage/advanced', icon: Database },
];

export function DigitLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { state, logout, setMode, toggleHelp } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const envName = ENVIRONMENTS.find(e => e.url === state.environment)?.name ?? 'Unknown';

  const handleSwitchToOnboarding = () => {
    setMode('onboarding');
    navigate('/phase/1');
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className={`${sidebarCollapsed ? 'w-16' : 'w-56'} bg-card border-r border-border flex flex-col transition-all duration-200`}>
        {/* Logo Area */}
        <div className="h-14 flex items-center justify-between px-3 border-b border-border">
          {!sidebarCollapsed && (
            <span className="text-sm font-bold text-primary font-['Roboto_Condensed'] truncate">
              DIGIT Studio
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path ||
              (item.path !== '/manage' && location.pathname.startsWith(item.path));

            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2 mx-1 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!sidebarCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer */}
        <div className="border-t border-border p-3 space-y-2">
          <button
            onClick={handleSwitchToOnboarding}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={sidebarCollapsed ? 'Switch to Onboarding' : undefined}
          >
            <Settings className="w-5 h-5 flex-shrink-0" />
            {!sidebarCollapsed && <span className="text-sm">Switch to Onboarding</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-card sticky top-0 z-40 shadow-card border-b border-border">
          <div className="h-1 bg-primary" />
          <div className="px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                Management Mode
              </Badge>
            </div>

            <div className="flex items-center gap-4">
              <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20">
                {envName}
              </Badge>

              <Button
                variant="ghost"
                size="icon"
                onClick={toggleHelp}
                className="h-9 w-9 text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <HelpCircle className="w-5 h-5" />
              </Button>

              <div className="flex items-center gap-2 pl-4 border-l border-border">
                <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                  <User className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{state.user?.name}</p>
                  <p className="text-xs text-muted-foreground">{state.tenant}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-9 w-9"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main content */}
        <main id="main-content" className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      <DocsPane />
    </div>
  );
}
```

**Step 2: Update `src/admin/index.ts`** — add export:

Add to barrel:
```typescript
export { DigitLayout } from './DigitLayout';
```

**Step 3: Commit**

```bash
git add src/admin/DigitLayout.tsx src/admin/index.ts
git commit -m "feat: add DigitLayout for management mode"
```

---

## Task 9: Build First Resource — Departments

Proves the full stack end-to-end: dataProvider → DigitList → DigitDatagrid → DIGIT UI.

**Files:**
- Create: `src/resources/departments/DepartmentList.tsx`
- Create: `src/resources/departments/DepartmentEdit.tsx`
- Create: `src/resources/index.ts`

**Step 1: Write DepartmentList**

```tsx
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { Badge } from '@/components/ui/badge';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name' },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <Badge variant={record.active ? 'default' : 'secondary'}>
        {record.active ? 'Active' : 'Inactive'}
      </Badge>
    ),
  },
];

export function DepartmentList() {
  return (
    <DigitList
      title="Departments"
      hasCreate
      sort={{ field: 'code', order: 'ASC' }}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
```

**Step 2: Write DepartmentEdit**

```tsx
import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function DepartmentEdit() {
  return (
    <DigitEdit title="Edit Department">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={required()} />
    </DigitEdit>
  );
}
```

**Step 3: Write resource index**

Create `src/resources/index.ts`:

```typescript
export { DepartmentList } from './departments/DepartmentList';
export { DepartmentEdit } from './departments/DepartmentEdit';
```

**Step 4: Commit**

```bash
git add src/resources/
git commit -m "feat: add department resource pages"
```

---

## Task 10: Wire Up App.tsx with CoreAdminContext

Replace management mode routes with react-admin-powered routing.

**Files:**
- Modify: `src/App.tsx`

**Step 1: Update App.tsx**

Key changes:
1. Import `CoreAdminContext`, `CoreAdminUI`, `Resource` from `ra-core`
2. Import `QueryClient`, `QueryClientProvider` from `@tanstack/react-query`
3. Import providers and resources
4. Replace management mode `<Route>` block with `<CoreAdminContext>` + `<CoreAdminUI>`
5. Keep onboarding routes unchanged

The management mode block changes from:

```tsx
<Route path="/manage" element={...}>
  <Route index element={<ManagementDashboard />} />
  <Route path="departments" element={<DepartmentsPage />} />
  ...
</Route>
```

To:

```tsx
<Route path="/manage/*" element={
  state.isAuthenticated && state.mode === 'management'
    ? <ManagementAdmin />
    : <Navigate to="/login" />
} />
```

Where `<ManagementAdmin>` is a new component wrapping `CoreAdminContext`:

```tsx
import { CoreAdminContext, CoreAdminUI, Resource } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { digitDataProvider } from '@/providers/digitDataProvider';
import { digitAuthProvider } from '@/providers/digitAuthProvider';
import { DigitLayout } from '@/admin';
import { DepartmentList, DepartmentEdit } from '@/resources';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
});

function ManagementAdmin() {
  return (
    <CoreAdminContext
      dataProvider={digitDataProvider}
      authProvider={digitAuthProvider}
      queryClient={queryClient}
      basename="/manage"
    >
      <CoreAdminUI layout={DigitLayout}>
        <Resource name="departments" list={DepartmentList} edit={DepartmentEdit} />
        {/* More resources added in subsequent tasks */}
      </CoreAdminUI>
    </CoreAdminContext>
  );
}
```

**Step 2: Test it runs**

```bash
npm run dev
```

Open browser, log in, switch to management mode, navigate to departments. Should see the DIGIT-styled department list.

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up management mode with react-admin CoreAdminContext"
```

---

## Task 11: Build Remaining Core Resources

Follow the same pattern as departments for each resource. Each is a thin composition file.

**Files to create:**
- `src/resources/designations/DesignationList.tsx`
- `src/resources/complaint-types/ComplaintTypeList.tsx`
- `src/resources/tenants/TenantList.tsx`
- `src/resources/tenants/TenantShow.tsx`
- `src/resources/employees/EmployeeList.tsx`
- `src/resources/employees/EmployeeCreate.tsx`
- `src/resources/boundaries/BoundaryList.tsx`

For each:
1. Define `columns: DigitColumn[]` with resource-specific fields
2. Use `<DigitList>` + `<DigitDatagrid>` for list views
3. Use custom `render` functions for badges (status, roles), reference fields, etc.
4. Register each as a `<Resource>` in `ManagementAdmin`

Example — **EmployeeList** (the most complex):

```tsx
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { Badge } from '@/components/ui/badge';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'user.name', label: 'Name' },
  { source: 'assignments[0].designation', label: 'Designation' },
  { source: 'assignments[0].department', label: 'Department' },
  { source: 'user.mobileNumber', label: 'Mobile' },
  {
    source: 'user.roles',
    label: 'Roles',
    sortable: false,
    render: (record) => {
      const roles = (record.user as Record<string, unknown>)?.roles as Array<{ code: string }> | undefined;
      return (
        <div className="flex flex-wrap gap-1">
          {roles?.map(r => (
            <Badge key={r.code} variant="outline" className="text-xs">{r.code}</Badge>
          ))}
        </div>
      );
    },
  },
  {
    source: 'employeeStatus',
    label: 'Status',
    render: (record) => (
      <Badge variant={record.employeeStatus === 'EMPLOYED' ? 'default' : 'secondary'}>
        {String(record.employeeStatus)}
      </Badge>
    ),
  },
];

export function EmployeeList() {
  return (
    <DigitList title="Employees" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}
```

After building all resource files, register them in App.tsx:

```tsx
<Resource name="tenants" list={TenantList} show={TenantShow} />
<Resource name="departments" list={DepartmentList} edit={DepartmentEdit} />
<Resource name="designations" list={DesignationList} />
<Resource name="complaint-types" list={ComplaintTypeList} />
<Resource name="employees" list={EmployeeList} create={EmployeeCreate} />
<Resource name="boundaries" list={BoundaryList} />
```

**Commit after each resource or batch:**

```bash
git add src/resources/ src/App.tsx
git commit -m "feat: add all core resource pages (tenants, designations, complaint-types, employees, boundaries)"
```

---

## Task 12: Build MdmsResourcePage (Generic MDMS Resources)

A single component that auto-generates columns from MDMS record data, handling all 25+ advanced entities without dedicated code.

**Files:**
- Create: `src/admin/MdmsResourcePage.tsx`

**Step 1: Write the component**

```tsx
/**
 * MdmsResourcePage — Generic list/show for any MDMS schema.
 *
 * Auto-generates columns by inspecting the first record's data keys.
 * Used for advanced entities that don't need custom UI.
 */

import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { useListController, ListContextProvider, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceLabel } from '@/providers/resourceRegistry';

export function MdmsResourcePage() {
  const resource = useResourceContext();
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);

  const listContext = useListController({
    sort: { field: config?.idField ?? 'id', order: 'ASC' },
    perPage: 25,
  });

  // Auto-detect columns from first record
  const firstRecord = listContext.data?.[0];
  const columns: DigitColumn[] = firstRecord
    ? Object.keys(firstRecord as Record<string, unknown>)
        .filter(key => !key.startsWith('_') && key !== 'id') // skip internal fields
        .slice(0, 8) // limit to 8 columns max
        .map(key => ({
          source: key,
          label: key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()),
        }))
    : [{ source: 'id', label: 'ID' }];

  return (
    <ListContextProvider value={listContext}>
      <DigitList title={label}>
        <DigitDatagrid columns={columns} rowClick="show" />
      </DigitList>
    </ListContextProvider>
  );
}
```

**Step 2: Register generic resources in App.tsx**

```tsx
import { getGenericMdmsResources } from '@/providers/resourceRegistry';
import { MdmsResourcePage } from '@/admin/MdmsResourcePage';

// Inside ManagementAdmin:
{getGenericMdmsResources().map(name => (
  <Resource key={name} name={name} list={MdmsResourcePage} />
))}
```

**Step 3: Commit**

```bash
git add src/admin/MdmsResourcePage.tsx src/App.tsx
git commit -m "feat: add generic MdmsResourcePage for 25+ advanced entities"
```

---

## Task 13: Build DigitDashboard

Overview dashboard with record counts per resource.

**Files:**
- Create: `src/admin/DigitDashboard.tsx`

**Step 1: Write the component**

```tsx
import { useGetList, useResourceContext } from 'ra-core';
import { DigitCard } from '@/components/digit';
import { useNavigate } from 'react-router-dom';
import { getDedicatedResources, getResourceLabel, getResourceConfig } from '@/providers/resourceRegistry';
import {
  Building2, MapPin, Users, Briefcase, Award, AlertTriangle, Globe,
} from 'lucide-react';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  tenants: Building2,
  departments: Briefcase,
  designations: Award,
  'complaint-types': AlertTriangle,
  employees: Users,
  boundaries: MapPin,
  localization: Globe,
};

function ResourceCard({ resource }: { resource: string }) {
  const { total, isPending } = useGetList(resource, {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  const navigate = useNavigate();
  const label = getResourceLabel(resource);
  const Icon = ICONS[resource] ?? Briefcase;

  return (
    <button
      onClick={() => navigate(`/manage/${resource}`)}
      className="text-left"
    >
      <DigitCard>
        <div className="p-6 flex items-center gap-4">
          <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
            <Icon className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">
              {isPending ? '...' : (total ?? 0)}
            </p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </div>
      </DigitCard>
    </button>
  );
}

export function DigitDashboard() {
  const resources = getDedicatedResources().filter(r => r !== 'complaints' && r !== 'localization');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground font-['Roboto_Condensed']">
        DIGIT Management Studio
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {resources.map(resource => (
          <ResourceCard key={resource} resource={resource} />
        ))}
      </div>
    </div>
  );
}
```

**Step 2: Register as dashboard in CoreAdminUI**

In App.tsx, add `dashboard={DigitDashboard}` to `<CoreAdminUI>`.

**Step 3: Commit**

```bash
git add src/admin/DigitDashboard.tsx src/App.tsx
git commit -m "feat: add management dashboard with resource count cards"
```

---

## Task 14: Build Advanced Entities Navigation Page

A page listing all generic MDMS resources as cards for navigation.

**Files:**
- Create: `src/resources/advanced/AdvancedPage.tsx`

**Step 1: Write the component**

```tsx
import { getGenericMdmsResources, getResourceLabel, getResourceConfig } from '@/providers/resourceRegistry';
import { DigitCard } from '@/components/digit';
import { useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';

export function AdvancedPage() {
  const resources = getGenericMdmsResources();
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-foreground font-['Roboto_Condensed']">
        Advanced Entities
      </h1>
      <p className="text-muted-foreground">
        Browse and manage all MDMS schema data.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {resources.map(name => {
          const config = getResourceConfig(name);
          return (
            <button
              key={name}
              onClick={() => navigate(`/manage/${name}`)}
              className="text-left"
            >
              <DigitCard>
                <div className="p-4 flex items-center gap-3">
                  <Database className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{getResourceLabel(name)}</p>
                    <p className="text-xs text-muted-foreground">{config?.schema}</p>
                  </div>
                </div>
              </DigitCard>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Register as a custom route in the admin**

```tsx
import { CustomRoutes } from 'ra-core';

// Inside CoreAdminUI:
<CustomRoutes>
  <Route path="/advanced" element={<AdvancedPage />} />
</CustomRoutes>
```

**Step 3: Commit**

```bash
git add src/resources/advanced/ src/App.tsx
git commit -m "feat: add advanced entities navigation page"
```

---

## Task 15: Cleanup Old Management Files

Remove files that are now replaced by the react-admin integration.

**Files to delete:**
- `src/pages/manage/` (entire directory)
- `src/pages/ManagementDashboard.tsx`
- `src/components/layout/ManagementLayout.tsx`
- `src/hooks/useEntity.ts`
- `src/lib/entityRegistry.ts`
- `src/components/DataTableFacetedFilter.tsx`
- `src/components/DataTablePagination.tsx`

**Files to keep but update:**
- `src/pages/manage/index.ts` — DELETE (no longer needed)
- `src/App.tsx` — remove old imports
- `src/components/ui/EntityLink.tsx` — keep (may still be used by onboarding)
- `src/components/ui/editable-cell.tsx` — keep (may still be used)
- `src/components/ui/add-row-dialog.tsx` — keep (may still be used)

**Step 1: Remove old files**

```bash
rm -rf src/pages/manage/
rm src/pages/ManagementDashboard.tsx
rm src/components/layout/ManagementLayout.tsx
rm src/hooks/useEntity.ts
rm src/lib/entityRegistry.ts
rm src/components/DataTableFacetedFilter.tsx
rm src/components/DataTablePagination.tsx
```

**Step 2: Update App.tsx to remove old imports**

Remove all imports referencing deleted files. The management routes should already point to the new `ManagementAdmin` component.

**Step 3: Verify build**

```bash
npm run build
```

Fix any remaining import errors.

**Step 4: Run tests**

```bash
npm run test
```

Fix any broken tests (old test files referencing deleted modules).

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old management pages, replace with react-admin"
```

---

## Task 16: Final Verification

**Step 1: Full build check**

```bash
npm run build
```

Expected: Clean build, no errors.

**Step 2: Run all tests**

```bash
npm run test
```

Expected: All tests pass.

**Step 3: Manual smoke test**

Start dev server and verify:
1. Login works
2. Onboarding mode (phases 1-4) works unchanged
3. Switch to management mode
4. Dashboard shows resource counts
5. Navigate to Departments — see list with sorting/filtering/pagination
6. Navigate to Employees — see list with roles badges
7. Navigate to Advanced — see all generic MDMS entities
8. Click into a generic entity — see auto-generated columns
9. Search works across all lists
10. Back button works
11. Sidebar navigation works
12. Help button works

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete react-admin DIGIT Management Studio migration"
```

---

## Summary

| Task | Description | Estimated Complexity |
|------|-------------|---------------------|
| 1 | Install ra-core | Low |
| 2 | Resource Registry | Low |
| 3 | DIGIT Data Provider | High |
| 4 | Auth Provider | Low |
| 5 | DigitList component | Medium |
| 6 | DigitDatagrid component | Medium |
| 7 | DigitShow/Edit/Create/FormInput | Medium |
| 8 | DigitLayout | Medium |
| 9 | First resource (Departments) | Low |
| 10 | Wire up App.tsx | Medium |
| 11 | Remaining core resources | Medium |
| 12 | MdmsResourcePage (generic) | Medium |
| 13 | Dashboard | Low |
| 14 | Advanced entities page | Low |
| 15 | Cleanup old files | Low |
| 16 | Final verification | Low |

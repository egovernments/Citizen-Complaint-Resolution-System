# Arbitrary URL Onboarding + xlsx Tenant Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the DIGIT MCP `configure` tool to connect to arbitrary DIGIT instances by URL, and add a new `city_setup_from_xlsx` tool that loads tenant data from CCRS-format xlsx files.

**Architecture:** Feature 1 adds `setAdHocEnvironment()` to `DigitApiClient` and a `probeServices()` utility that detects available services. Feature 2 ports the CCRS `UnifiedExcelReader` to TypeScript using `exceljs`, orchestrates 4 loading phases (Tenant, Boundaries, Masters, Employees), and registers a new MCP tool.

**Tech Stack:** TypeScript, exceljs (xlsx parsing), existing DigitApiClient singleton, MCP ToolRegistry

**Spec:** `docs/superpowers/specs/2026-03-26-onboarding-and-xlsx-setup-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/digit-api.ts` | Modify | Add `setAdHocEnvironment()` method (~10 lines) |
| `src/utils/probe.ts` | Create | `probeServices(baseUrl, authToken)` — parallel service availability detection |
| `src/tools/mdms-tenant.ts` | Modify | Extend `configure` input schema + handler; register `city_setup_from_xlsx` tool |
| `src/utils/xlsx-reader.ts` | Create | TypeScript port of CCRS `UnifiedExcelReader` — sheet parsing, code generation, date conversion |
| `src/utils/xlsx-loader.ts` | Create | Phase orchestrator — sequences 4 phases, manages cross-phase state, calls DigitApiClient |
| `test-xlsx-reader.ts` | Create | Unit tests for xlsx-reader (pure parsing, no API needed) |
| `test-integration-full.ts` | Modify | Add integration tests for configure with base_url and city_setup_from_xlsx |
| `package.json` | Modify | Add `exceljs` dependency |

---

## Task 1: Add `setAdHocEnvironment()` to DigitApiClient

**Files:**
- Modify: `src/services/digit-api.ts:23-44` (class definition, after `setStateTenant()`)

- [ ] **Step 1: Add `setAdHocEnvironment` method**

In `src/services/digit-api.ts`, add a new method after `setStateTenant()` (after line 44):

```typescript
  /**
   * Set an ad-hoc environment from a raw base URL (no named env lookup needed).
   * Clears existing auth state so the caller must re-authenticate.
   */
  setAdHocEnvironment(baseUrl: string, endpointOverrides?: Record<string, string>): void {
    // Strip trailing slash
    const url = baseUrl.replace(/\/+$/, '');
    const hostname = new URL(url).hostname;
    this.environment = {
      name: `${hostname} (ad-hoc)`,
      url,
      stateTenantId: 'default', // will be resolved from login response
      description: `Ad-hoc connection to ${url}`,
      endpointOverrides,
    };
    this.stateTenantOverride = null;
    this.authToken = null;
    this.userInfo = null;
  }
```

- [ ] **Step 2: Verify build**

Run: `cd /root/DIGIT-MCP && npm run build`
Expected: Clean compile, no errors.

- [ ] **Step 3: Commit**

```bash
cd /root/DIGIT-MCP && git add src/services/digit-api.ts
git commit -m "feat: add setAdHocEnvironment() to DigitApiClient"
```

---

## Task 2: Create service probing utility

**Files:**
- Create: `src/utils/probe.ts`

- [ ] **Step 1: Create `src/utils/probe.ts`**

```typescript
/**
 * Probe DIGIT service endpoints to detect availability.
 * Used by `configure` when connecting to an arbitrary base URL.
 */

export interface ServiceProbeResult {
  status: 'available' | 'not_found' | 'unreachable';
  endpoint?: string;
  error?: string;
}

export interface ProbeReport {
  services: Record<string, ServiceProbeResult>;
  detectedEndpointOverrides: Record<string, string>;
}

/**
 * Probe a single HTTP endpoint. Returns availability status.
 * - 2xx or 400 (bad request but service exists) → available
 * - 404 → not_found
 * - connection error / timeout → unreachable
 */
async function probeSingle(
  baseUrl: string,
  authToken: string,
  path: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>,
): Promise<ServiceProbeResult> {
  try {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const response = await fetch(url, {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 404) {
      return { status: 'not_found' };
    }
    // Extract base service path (e.g. "/pgr-services/v2/request/_search" → "/pgr-services")
    const segments = path.split('/').filter(Boolean);
    const basePath = `/${segments[0]}`;
    return { status: 'available', endpoint: basePath };
  } catch (error) {
    return {
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Minimal DIGIT RequestInfo for probe requests */
function probeRequestInfo(authToken: string): Record<string, unknown> {
  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    msgId: `${Date.now()}|en_IN`,
    authToken,
  };
}

/**
 * Probe all known DIGIT services in two waves:
 * 1. MDMS endpoint detection (sequential — determines correct path)
 * 2. All other services (parallel)
 */
export async function probeServices(baseUrl: string, authToken: string): Promise<ProbeReport> {
  const report: ProbeReport = {
    services: {},
    detectedEndpointOverrides: {},
  };

  const ri = probeRequestInfo(authToken);

  // ── Wave 1: MDMS endpoint detection (sequential) ──
  const mdmsBody = { MdmsCriteria: { tenantId: 'default', schemaCode: 'tenant.tenants', limit: 1 } };

  const mdmsV2 = await probeSingle(baseUrl, authToken, '/mdms-v2/v2/_search', 'POST', mdmsBody);
  if (mdmsV2.status === 'available') {
    report.services.mdms = { status: 'available', endpoint: '/mdms-v2' };
    report.detectedEndpointOverrides.MDMS_SEARCH = '/mdms-v2/v2/_search';
    report.detectedEndpointOverrides.MDMS_CREATE = '/mdms-v2/v2/_create';
    report.detectedEndpointOverrides.MDMS_UPDATE = '/mdms-v2/v2/_update';
  } else {
    const legacy = await probeSingle(baseUrl, authToken, '/egov-mdms-service/v2/_search', 'POST', mdmsBody);
    if (legacy.status === 'available') {
      report.services.mdms = { status: 'available', endpoint: '/egov-mdms-service' };
      report.detectedEndpointOverrides.MDMS_SEARCH = '/egov-mdms-service/v2/_search';
      report.detectedEndpointOverrides.MDMS_CREATE = '/egov-mdms-service/v2/_create';
      report.detectedEndpointOverrides.MDMS_UPDATE = '/egov-mdms-service/v2/_update';
    } else {
      report.services.mdms = mdmsV2; // report original probe result
    }
  }

  // ── Wave 2: All other services (parallel) ──
  const probes: Array<{ name: string; path: string; method?: 'GET' | 'POST'; body?: Record<string, unknown> }> = [
    { name: 'pgr', path: '/pgr-services/v2/request/_search', body: { RequestInfo: ri } },
    { name: 'hrms', path: '/egov-hrms/employees/_search', body: { RequestInfo: ri, criteria: {} } },
    { name: 'boundary', path: '/boundary-service/boundary-hierarchy-definition/_search', body: { RequestInfo: ri } },
    { name: 'workflow', path: '/egov-workflow-v2/egov-wf/businessservice/_search', body: { RequestInfo: ri } },
    { name: 'localization', path: '/localization/messages/v1/_search', body: { RequestInfo: ri, MsgSearchCriteria: { tenantId: 'default', locale: 'en_IN' } } },
    { name: 'filestore', path: '/filestore/v1/files/url', method: 'GET' as const },
    { name: 'idgen', path: '/egov-idgen/id/_generate', body: { RequestInfo: ri, idRequests: [] } },
    { name: 'user', path: '/user/_search', body: { RequestInfo: ri } },
    { name: 'encryption', path: '/egov-enc-service/crypto/v1/_encrypt', body: { RequestInfo: ri } },
    { name: 'inbox', path: '/inbox/v2/_search', body: { RequestInfo: ri } },
  ];

  const results = await Promise.all(
    probes.map(async (p) => ({
      name: p.name,
      result: await probeSingle(baseUrl, authToken, p.path, p.method || 'POST', p.body),
    })),
  );

  for (const { name, result } of results) {
    report.services[name] = result;
  }

  return report;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /root/DIGIT-MCP && npm run build`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
cd /root/DIGIT-MCP && git add src/utils/probe.ts
git commit -m "feat: add probeServices() utility for DIGIT service detection"
```

---

## Task 3: Extend `configure` tool with `base_url` support

**Files:**
- Modify: `src/tools/mdms-tenant.ts:167-366` (configure tool registration)

- [ ] **Step 1: Add imports for probe utility**

At the top of `src/tools/mdms-tenant.ts` (after line 10, the last existing import), add:

```typescript
import { probeServices } from '../utils/probe.js';
import type { ProbeReport } from '../utils/probe.js';
```

- [ ] **Step 2: Extend configure input schema**

In the `configure` tool's `inputSchema.properties` (around line 173), add three new properties. The existing properties are `environment`, `username`, `password`, `tenant_id`, `state_tenant`. Add before `environment`:

```typescript
        base_url: {
          type: 'string',
          description:
            'Base URL of a DIGIT instance (e.g. "https://unified-dev.digit.org"). ' +
            'When provided, connects directly to this URL instead of using a named environment. ' +
            'Runs service probing to detect available APIs.',
        },
```

Update the `environment` property description to note it's optional when `base_url` is provided:

```typescript
        environment: {
          type: 'string',
          description:
            'Named environment key (e.g. "chakshu-digit"). Optional when base_url is provided. ' +
            `Available: ${Object.keys(ENVIRONMENTS).join(', ')}. ` +
            `Falls back to CRS_ENVIRONMENT env var (current: "${process.env.CRS_ENVIRONMENT || 'chakshu-digit'}").`,
        },
```

- [ ] **Step 3: Add base_url handling to configure handler**

In the configure handler, after extracting args (around line 205), add the base_url branch. The current code starts with:

```typescript
      const envKey = (args.environment as string) || process.env.CRS_ENVIRONMENT || 'chakshu-digit';
```

Replace that line and the `digitApi.setEnvironment(envKey)` call with:

```typescript
      const baseUrl = args.base_url as string | undefined;
      const envKey = (args.environment as string) || process.env.CRS_ENVIRONMENT || 'chakshu-digit';

      // Switch environment: ad-hoc URL or named environment
      if (baseUrl) {
        digitApi.setAdHocEnvironment(baseUrl);
      } else {
        if (!ENVIRONMENTS[envKey]) {
          return JSON.stringify({
            success: false,
            error: `Unknown environment "${envKey}". Available: ${Object.keys(ENVIRONMENTS).join(', ')}`,
          }, null, 2);
        }
        digitApi.setEnvironment(envKey);
      }
```

- [ ] **Step 4: Add service probing after successful login**

After the successful login block (after the cross-tenant role provisioning section, around line 340 where the response object is being built), add probing logic. Find the section that builds the response object (starts with `return JSON.stringify({`). Before that return, add:

```typescript
      // ── Service probing (when using ad-hoc base_url) ──
      let probeReport: ProbeReport | undefined;
      if (baseUrl) {
        const authInfo = digitApi.getAuthInfo();
        probeReport = await probeServices(baseUrl, authInfo.token!);

        // Apply detected endpoint overrides so subsequent tool calls use correct paths
        if (Object.keys(probeReport.detectedEndpointOverrides).length > 0) {
          digitApi.setAdHocEnvironment(baseUrl, probeReport.detectedEndpointOverrides);
          // Re-authenticate since setAdHocEnvironment clears auth
          await digitApi.login(username, password, usedLoginTenant);
        }
      }
```

Then include probe results and source indicator in the response. In the response JSON object, add after the existing fields:

```typescript
        ...(baseUrl ? { source: 'base_url' } : {}),
        ...(probeReport ? {
          services: probeReport.services,
          detectedEndpointOverrides: probeReport.detectedEndpointOverrides,
        } : {}),
```

- [ ] **Step 5: Verify build**

Run: `cd /root/DIGIT-MCP && npm run build`
Expected: Clean compile.

- [ ] **Step 6: Commit**

```bash
cd /root/DIGIT-MCP && git add src/tools/mdms-tenant.ts
git commit -m "feat: extend configure tool with base_url param and service probing"
```

---

## Task 4: Integration test for arbitrary URL onboarding

**Files:**
- Modify: `test-integration-full.ts`

- [ ] **Step 1: Add integration test for configure with base_url**

In `test-integration-full.ts`, find the existing configure tests (around line 330, section `1.4` and `1.5`). After the last configure test, add:

```typescript
  await test('1.6 configure: login via base_url (ad-hoc environment)', async () => {
    const username = process.env.CRS_USERNAME || 'ADMIN';
    const password = process.env.CRS_PASSWORD || 'eGov@123';
    const baseUrl = process.env.CRS_API_URL || 'https://api.egov.theflywheel.in';

    const r = await call('configure', { base_url: baseUrl, username, password });
    assert(r.success === true, `configure with base_url should succeed: ${r.error || ''}`);
    assert(r.environment, 'response should include environment info');
    assert((r.environment as Record<string, unknown>).source === 'base_url' || (r.environment as Record<string, unknown>).name?.toString().includes('ad-hoc'),
      'environment should indicate ad-hoc connection');

    // Should have service probing results
    assert(r.services, 'response should include services probe report');
    const services = r.services as Record<string, Record<string, unknown>>;
    assert(services.mdms, 'should have probed MDMS');
    assert(services.mdms.status === 'available', `MDMS should be available: ${JSON.stringify(services.mdms)}`);

    // Re-configure with named environment for subsequent tests
    await call('configure', { environment: targetEnv, username, password });
    return [`Connected via base_url, probed ${Object.keys(services).length} services`];
  });
```

- [ ] **Step 2: Run the integration test**

Run: `cd /root/DIGIT-MCP && CRS_ENVIRONMENT=chakshu-digit CRS_USERNAME=ADMIN CRS_PASSWORD=eGov@123 npx tsx test-integration-full.ts 2>&1 | head -60`
Expected: All tests pass including the new `1.6` test.

- [ ] **Step 3: Commit**

```bash
cd /root/DIGIT-MCP && git add test-integration-full.ts
git commit -m "test: add integration test for configure with base_url"
```

---

## Task 5: Install exceljs and create xlsx-reader (tenant + masters parsing)

**Files:**
- Modify: `package.json` (add exceljs dependency)
- Create: `src/utils/xlsx-reader.ts`
- Create: `test-xlsx-reader.ts`

- [ ] **Step 1: Install exceljs**

Run: `cd /root/DIGIT-MCP && npm install exceljs`

- [ ] **Step 2: Create `src/utils/xlsx-reader.ts` with types and tenant parsing**

```typescript
/**
 * xlsx-reader.ts — TypeScript port of CCRS UnifiedExcelReader.
 * Parses xlsx sheets in CCRS-compatible format into structured data
 * ready for DIGIT API calls.
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';

// ── Types ──

export interface TenantRecord {
  code: string;
  name: string;
  type: string;
  logoFilePath?: string;
  city: {
    code: string;
    name: string;
    districtName?: string;
    latitude?: number;
    longitude?: number;
  };
  domainUrl?: string;
}

export interface TenantBrandingRecord {
  code: string;
  name: string;
  bannerUrl?: string;
  logoUrl?: string;
  logoUrlWhite?: string;
  statelogo?: string;
}

export interface LocalizationMessage {
  code: string;
  message: string;
  module: string;
  locale: string;
}

export interface DepartmentRecord {
  code: string;
  name: string;
  enabled: boolean;
  active: boolean;
}

export interface DesignationRecord {
  code: string;
  name: string;
  enabled: boolean;
  active: boolean;
}

export interface ComplaintTypeRecord {
  serviceCode: string;
  name: string;
  menuPath: string;
  department: string;
  slaHours: number;
  keywords: string;
  order: number;
  active: boolean;
}

export interface EmployeeRecord {
  code: string;
  name: string;
  mobileNumber: string;
  departmentName: string;
  designationName: string;
  roleNames: string[];
  appointmentDate: number; // Unix ms
  joiningDate: number; // Unix ms
  password: string;
}

// ── Helpers ──

/**
 * Read a worksheet into an array of row objects keyed by header names.
 * Skips the header row (row 1) and any fully empty rows.
 */
function sheetToRows(sheet: ExcelJS.Worksheet): Record<string, string>[] {
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cell.text.trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        const val = cellToString(cell);
        obj[header] = val;
        if (val) hasValue = true;
      }
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}

/** Convert an ExcelJS cell value to a plain string. Handles dates, numbers, nulls. */
function cellToString(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && 'result' in val) {
    // Formula cell — use the result
    const result = (val as ExcelJS.CellFormulaValue).result;
    if (result === null || result === undefined) return '';
    return String(result);
  }
  return String(val).trim();
}

/**
 * Convert an Excel date value to Unix timestamp in milliseconds.
 * Handles: Date objects, ISO strings, Excel serial numbers.
 */
export function excelDateToTimestamp(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (typeof value === 'number') {
    // Excel serial date: days since 1899-12-30
    // JavaScript epoch: 1970-01-01 = Excel serial 25569
    const msPerDay = 86400000;
    return Math.round((value - 25569) * msPerDay);
  }
  throw new Error(`Cannot convert "${value}" to date timestamp`);
}

/** Generate PascalCase code from a name: "Road Pothole" → "RoadPothole" */
export function nameToPascalCode(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/** Generate UPPER_SNAKE code from a name: "John Smith" → "JOHN_SMITH" */
export function nameToUpperSnake(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

/**
 * Find a worksheet by trying multiple names (case-insensitive).
 * Returns undefined if none found.
 */
function findSheet(workbook: ExcelJS.Workbook, ...names: string[]): ExcelJS.Worksheet | undefined {
  for (const name of names) {
    const sheet = workbook.worksheets.find(
      (ws) => ws.name.toLowerCase().trim() === name.toLowerCase().trim(),
    );
    if (sheet) return sheet;
  }
  return undefined;
}

// ── Sheet Readers ──

/**
 * Read "Tenant Info" sheet → tenant records + localization messages.
 */
export function readTenantInfo(workbook: ExcelJS.Workbook): {
  tenants: TenantRecord[];
  localizations: LocalizationMessage[];
} {
  const sheet = findSheet(workbook, 'Tenant Info');
  if (!sheet) throw new Error("Sheet 'Tenant Info' not found in workbook");

  const rows = sheetToRows(sheet);
  const tenants: TenantRecord[] = [];
  const localizations: LocalizationMessage[] = [];

  for (const row of rows) {
    const name = row['Tenant Display Name*'];
    const code = (row['Tenant Code*'] || '').toLowerCase().replace(/\./g, '');
    const type = row['Tenant Type*'];

    if (!name || !code) continue;

    const tenant: TenantRecord = {
      code,
      name,
      type: type || 'CITY',
      logoFilePath: row['Logo File Path*'] || undefined,
      city: {
        code: code.toUpperCase(),
        name: row['City Name'] || name,
        districtName: row['District Name'] || undefined,
        latitude: row['Latitude'] ? parseFloat(row['Latitude']) : undefined,
        longitude: row['Longitude'] ? parseFloat(row['Longitude']) : undefined,
      },
      domainUrl: row['Tenant Website'] || undefined,
    };
    tenants.push(tenant);

    // Auto-generate localization key
    localizations.push({
      code: `TENANT_TENANTS_${code.toUpperCase().replace(/\./g, '_')}`,
      message: name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    });
  }

  return { tenants, localizations };
}

/**
 * Read optional "Tenant Branding Details" sheet → branding records.
 * Returns empty array if sheet not found (it's optional).
 */
export function readTenantBranding(workbook: ExcelJS.Workbook): TenantBrandingRecord[] {
  const sheet = findSheet(workbook, 'Tenant Branding Details');
  if (!sheet) return []; // Optional sheet

  const rows = sheetToRows(sheet);
  const records: TenantBrandingRecord[] = [];

  for (const row of rows) {
    const code = (row['Tenant Code*'] || row['Tenant Code'] || '').toLowerCase().replace(/\./g, '');
    if (!code) continue;

    records.push({
      code,
      name: row['Tenant Display Name*'] || row['Tenant Display Name'] || code,
      bannerUrl: row['Banner URL'] || undefined,
      logoUrl: row['Logo URL'] || undefined,
      logoUrlWhite: row['Logo URL (White)'] || undefined,
      statelogo: row['State Logo'] || undefined,
    });
  }

  return records;
}

/**
 * Read "Department And Designation Master" sheet → departments, designations, localizations.
 * Auto-generates codes: DEPT_1, DEPT_2..., DESIG_01, DESIG_02...
 * Returns a deptNameToCode map for cross-phase use.
 */
export function readDepartmentsDesignations(workbook: ExcelJS.Workbook): {
  departments: DepartmentRecord[];
  designations: DesignationRecord[];
  localizations: LocalizationMessage[];
  deptNameToCode: Map<string, string>;
  desigNameToCode: Map<string, string>;
} {
  const sheet = findSheet(workbook, 'Department And Designation Master', 'Department and Designation Master');
  if (!sheet) throw new Error("Sheet 'Department And Designation Master' not found in workbook");

  const rows = sheetToRows(sheet);

  // Collect unique names
  const deptNames = new Set<string>();
  const desigNames = new Set<string>();
  for (const row of rows) {
    const dept = row['Department Name*']?.trim();
    const desig = row['Designation Name*']?.trim();
    if (dept) deptNames.add(dept);
    if (desig) desigNames.add(desig);
  }

  // Generate codes
  const departments: DepartmentRecord[] = [];
  const deptNameToCode = new Map<string, string>();
  let deptIdx = 1;
  for (const name of deptNames) {
    const code = `DEPT_${deptIdx}`;
    departments.push({ code, name, enabled: true, active: true });
    deptNameToCode.set(name, code);
    deptIdx++;
  }

  const designations: DesignationRecord[] = [];
  const desigNameToCode = new Map<string, string>();
  let desigIdx = 1;
  for (const name of desigNames) {
    const code = `DESIG_${String(desigIdx).padStart(2, '0')}`;
    designations.push({ code, name, enabled: true, active: true });
    desigNameToCode.set(name, code);
    desigIdx++;
  }

  // Localization
  const localizations: LocalizationMessage[] = [];
  for (const dept of departments) {
    localizations.push({
      code: `COMMON_MASTERS_DEPARTMENT_${dept.code}`,
      message: dept.name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    });
  }
  for (const desig of designations) {
    localizations.push({
      code: `COMMON_MASTERS_DESIGNATION_${desig.code}`,
      message: desig.name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    });
  }

  return { departments, designations, localizations, deptNameToCode, desigNameToCode };
}

/**
 * Read "Complaint Type Master" sheet → complaint types + localizations.
 * Handles parent-child hierarchy: parent rows have "Complaint Type*",
 * child rows have "Complaint sub type*". Children inherit department/SLA from parent.
 */
export function readComplaintTypes(
  workbook: ExcelJS.Workbook,
  deptNameToCode: Map<string, string>,
): {
  complaintTypes: ComplaintTypeRecord[];
  localizations: LocalizationMessage[];
} {
  const sheet = findSheet(workbook, 'Complaint Type Master');
  if (!sheet) throw new Error("Sheet 'Complaint Type Master' not found in workbook");

  const rows = sheetToRows(sheet);
  const complaintTypes: ComplaintTypeRecord[] = [];
  const localizations: LocalizationMessage[] = [];

  let currentParent: {
    name: string;
    department: string;
    slaHours: number;
    keywords: string;
  } | null = null;
  let order = 1;

  for (const row of rows) {
    const parentName = row['Complaint Type*']?.trim();
    const childName = row['Complaint sub type*']?.trim();

    if (parentName) {
      // This is a parent row — update current parent context
      const deptName = row['Department Name*']?.trim() || '';
      const deptCode = deptNameToCode.get(deptName) || deptName;
      currentParent = {
        name: parentName,
        department: deptCode,
        slaHours: parseInt(row['Resolution Time (Hours)*'] || '48', 10) || 48,
        keywords: row['Search Words*'] || '',
      };

      // Create the parent complaint type record
      const serviceCode = nameToPascalCode(parentName);
      complaintTypes.push({
        serviceCode,
        name: parentName,
        menuPath: `complaints.categories.${serviceCode}`,
        department: deptCode,
        slaHours: currentParent.slaHours,
        keywords: currentParent.keywords,
        order: order++,
        active: true,
      });

      localizations.push({
        code: `SERVICEDEFS.${serviceCode.toUpperCase()}`,
        message: parentName,
        module: 'rainmaker-pgr',
        locale: 'en_IN',
      });
    } else if (childName && currentParent) {
      // This is a child row — inherits from current parent
      const serviceCode = nameToPascalCode(`${currentParent.name} ${childName}`);
      const childDept = row['Department Name*']?.trim();
      const childDeptCode = childDept ? (deptNameToCode.get(childDept) || childDept) : currentParent.department;

      complaintTypes.push({
        serviceCode,
        name: childName,
        menuPath: `complaints.categories.${nameToPascalCode(currentParent.name)}.${serviceCode}`,
        department: childDeptCode,
        slaHours: parseInt(row['Resolution Time (Hours)*'] || '', 10) || currentParent.slaHours,
        keywords: row['Search Words*'] || currentParent.keywords,
        order: order++,
        active: true,
      });

      localizations.push({
        code: `SERVICEDEFS.${serviceCode.toUpperCase()}`,
        message: childName,
        module: 'rainmaker-pgr',
        locale: 'en_IN',
      });
    }
  }

  return { complaintTypes, localizations };
}

/**
 * Read "Employee Master" sheet → employee records.
 * Auto-generates employee codes from names: "John Smith" → "JOHN_SMITH".
 */
export function readEmployees(workbook: ExcelJS.Workbook): EmployeeRecord[] {
  const sheet = findSheet(workbook, 'Employee Master');
  if (!sheet) throw new Error("Sheet 'Employee Master' not found in workbook");

  const rows = sheetToRows(sheet);
  const employees: EmployeeRecord[] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const name = row['User Name*']?.trim();
    const mobile = row['Mobile Number*']?.trim();
    if (!name || !mobile) continue;

    // Generate unique code
    let code = nameToUpperSnake(name);
    if (seenCodes.has(code)) {
      let suffix = 2;
      while (seenCodes.has(`${code}_${suffix}`)) suffix++;
      code = `${code}_${suffix}`;
    }
    seenCodes.add(code);

    // Parse dates — get raw cell values for date conversion
    const appointmentRaw = sheet.getRow(rows.indexOf(row) + 2).getCell(
      findColumnIndex(sheet, 'Date of Appointment*'),
    ).value;
    const joiningRaw = sheet.getRow(rows.indexOf(row) + 2).getCell(
      findColumnIndex(sheet, 'Assignment From Date*'),
    ).value;

    employees.push({
      code,
      name,
      mobileNumber: mobile.replace(/\D/g, '').slice(-10),
      departmentName: row['Department Name*']?.trim() || '',
      designationName: row['Designation Name*']?.trim() || '',
      roleNames: (row['Role Names*'] || 'EMPLOYEE')
        .split(',')
        .map((r: string) => r.trim())
        .filter(Boolean),
      appointmentDate: excelDateToTimestamp(appointmentRaw || row['Date of Appointment*']),
      joiningDate: excelDateToTimestamp(joiningRaw || row['Assignment From Date*']),
      password: row['Password'] || 'eGov@123',
    });
  }

  return employees;
}

/** Find column index (1-based) by header name. */
function findColumnIndex(sheet: ExcelJS.Worksheet, headerName: string): number {
  const headerRow = sheet.getRow(1);
  let found = 1;
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (cell.text.trim() === headerName) found = colNumber;
  });
  return found;
}

/**
 * Load an ExcelJS Workbook from a file path or Buffer.
 */
export async function loadWorkbook(source: string | Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  if (typeof source === 'string') {
    await workbook.xlsx.readFile(source);
  } else {
    await workbook.xlsx.load(source);
  }
  return workbook;
}
```

- [ ] **Step 3: Verify build**

Run: `cd /root/DIGIT-MCP && npm run build`
Expected: Clean compile.

- [ ] **Step 4: Commit**

```bash
cd /root/DIGIT-MCP && git add src/utils/xlsx-reader.ts package.json package-lock.json
git commit -m "feat: add xlsx-reader with tenant, department, complaint type, and employee parsers"
```

---

## Task 6: Unit tests for xlsx-reader

**Files:**
- Create: `test-xlsx-reader.ts`

- [ ] **Step 1: Create `test-xlsx-reader.ts`**

```typescript
/**
 * Unit tests for xlsx-reader — pure parsing, no DIGIT API needed.
 * Creates xlsx workbooks programmatically with ExcelJS and verifies parsed output.
 */
import assert from 'node:assert';
import ExcelJS from 'exceljs';
import {
  readTenantInfo,
  readDepartmentsDesignations,
  readComplaintTypes,
  readEmployees,
  excelDateToTimestamp,
  nameToPascalCode,
  nameToUpperSnake,
} from './src/utils/xlsx-reader.js';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Helper: create workbook with sheet data ──

function createWorkbook(sheets: Record<string, string[][]>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  for (const [name, data] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of data) {
      ws.addRow(row);
    }
  }
  return wb;
}

// ── Tests ──

async function run() {
  console.log('\n── xlsx-reader unit tests ──\n');

  // ── Helper function tests ──

  await test('nameToPascalCode: basic', () => {
    assert.strictEqual(nameToPascalCode('Road Pothole'), 'RoadPothole');
    assert.strictEqual(nameToPascalCode('garbage not collected'), 'GarbageNotCollected');
    assert.strictEqual(nameToPascalCode('Broken Street-Light'), 'BrokenStreetLight');
  });

  await test('nameToUpperSnake: basic', () => {
    assert.strictEqual(nameToUpperSnake('John Smith'), 'JOHN_SMITH');
    assert.strictEqual(nameToUpperSnake('jane doe'), 'JANE_DOE');
    assert.strictEqual(nameToUpperSnake('Bob'), 'BOB');
  });

  await test('excelDateToTimestamp: Date object', () => {
    const d = new Date('2024-01-15T00:00:00.000Z');
    assert.strictEqual(excelDateToTimestamp(d), d.getTime());
  });

  await test('excelDateToTimestamp: ISO string', () => {
    const ts = excelDateToTimestamp('2024-01-15');
    assert.ok(ts > 0, 'should produce positive timestamp');
    const d = new Date(ts);
    assert.strictEqual(d.getUTCFullYear(), 2024);
    assert.strictEqual(d.getUTCMonth(), 0); // January
    assert.strictEqual(d.getUTCDate(), 15);
  });

  await test('excelDateToTimestamp: Excel serial number', () => {
    // 2024-01-15 = Excel serial 45306
    const ts = excelDateToTimestamp(45306);
    const d = new Date(ts);
    assert.strictEqual(d.getUTCFullYear(), 2024);
    assert.strictEqual(d.getUTCMonth(), 0);
    assert.strictEqual(d.getUTCDate(), 15);
  });

  // ── Tenant Info ──

  await test('readTenantInfo: parses tenant rows', () => {
    const wb = createWorkbook({
      'Tenant Info': [
        ['Tenant Display Name*', 'Tenant Code*', 'Tenant Type*', 'Logo File Path*', 'City Name', 'District Name', 'Latitude', 'Longitude', 'Tenant Website'],
        ['Test City', 'pg.testcity', 'CITY', '/logo.png', 'Test City', 'Test District', '12.5', '77.5', 'https://test.city'],
        ['Another City', 'pg.another', 'CITY', '', 'Another', '', '', '', ''],
      ],
    });

    const { tenants, localizations } = readTenantInfo(wb);

    assert.strictEqual(tenants.length, 2);
    assert.strictEqual(tenants[0].code, 'pgtestcity'); // dots removed, lowercase
    assert.strictEqual(tenants[0].name, 'Test City');
    assert.strictEqual(tenants[0].city.latitude, 12.5);
    assert.strictEqual(tenants[0].domainUrl, 'https://test.city');

    assert.strictEqual(tenants[1].code, 'pganother');
    assert.strictEqual(tenants[1].city.districtName, undefined); // empty → undefined

    assert.strictEqual(localizations.length, 2);
    assert.ok(localizations[0].code.startsWith('TENANT_TENANTS_'));
  });

  await test('readTenantInfo: skips empty rows', () => {
    const wb = createWorkbook({
      'Tenant Info': [
        ['Tenant Display Name*', 'Tenant Code*', 'Tenant Type*'],
        ['Test City', 'tc', 'CITY'],
        ['', '', ''], // empty row
        ['Second City', 'sc', 'CITY'],
      ],
    });

    const { tenants } = readTenantInfo(wb);
    assert.strictEqual(tenants.length, 2);
  });

  await test('readTenantInfo: throws on missing sheet', () => {
    const wb = createWorkbook({ 'Wrong Sheet': [['a']] });
    assert.throws(() => readTenantInfo(wb), /Sheet 'Tenant Info' not found/);
  });

  // ── Departments & Designations ──

  await test('readDepartmentsDesignations: parses and deduplicates', () => {
    const wb = createWorkbook({
      'Department And Designation Master': [
        ['Department Name*', 'Designation Name*', 'Jurisdiction'],
        ['Public Works', 'Junior Engineer', 'City'],
        ['Public Works', 'Senior Engineer', 'City'],
        ['Sanitation', 'Inspector', 'City'],
        ['Sanitation', 'Supervisor', 'City'],
      ],
    });

    const { departments, designations, deptNameToCode, desigNameToCode, localizations } =
      readDepartmentsDesignations(wb);

    assert.strictEqual(departments.length, 2); // deduplicated
    assert.strictEqual(departments[0].code, 'DEPT_1');
    assert.strictEqual(departments[0].name, 'Public Works');
    assert.strictEqual(departments[1].code, 'DEPT_2');

    assert.strictEqual(designations.length, 4);
    assert.strictEqual(designations[0].code, 'DESIG_01');
    assert.strictEqual(designations[1].code, 'DESIG_02');

    assert.strictEqual(deptNameToCode.get('Public Works'), 'DEPT_1');
    assert.strictEqual(deptNameToCode.get('Sanitation'), 'DEPT_2');
    assert.strictEqual(desigNameToCode.get('Junior Engineer'), 'DESIG_01');

    // Localizations: 2 depts + 4 desigs = 6
    assert.strictEqual(localizations.length, 6);
  });

  // ── Complaint Types ──

  await test('readComplaintTypes: parses parent-child hierarchy', () => {
    const deptNameToCode = new Map([['Public Works', 'DEPT_1'], ['Sanitation', 'DEPT_2']]);

    const wb = createWorkbook({
      'Complaint Type Master': [
        ['Complaint Type*', 'Complaint sub type*', 'Department Name*', 'Resolution Time (Hours)*', 'Search Words*', 'Priority'],
        ['Road Maintenance', '', 'Public Works', '48', 'road,pothole', '3'],
        ['', 'Pothole', '', '', '', ''],
        ['', 'Gutter Damage', '', '', '', ''],
        ['Garbage', '', 'Sanitation', '24', 'garbage,trash', '2'],
        ['', 'Not Collected', '', '', '', ''],
      ],
    });

    const { complaintTypes, localizations } = readComplaintTypes(wb, deptNameToCode);

    // 2 parents + 3 children = 5 types
    assert.strictEqual(complaintTypes.length, 5);

    // Parent: Road Maintenance
    assert.strictEqual(complaintTypes[0].serviceCode, 'RoadMaintenance');
    assert.strictEqual(complaintTypes[0].department, 'DEPT_1');
    assert.strictEqual(complaintTypes[0].slaHours, 48);

    // Child: Pothole (inherits from Road Maintenance)
    assert.strictEqual(complaintTypes[1].serviceCode, 'RoadMaintenancePothole');
    assert.strictEqual(complaintTypes[1].department, 'DEPT_1'); // inherited
    assert.strictEqual(complaintTypes[1].slaHours, 48); // inherited

    // Parent: Garbage
    assert.strictEqual(complaintTypes[3].serviceCode, 'Garbage');
    assert.strictEqual(complaintTypes[3].department, 'DEPT_2');

    assert.strictEqual(localizations.length, 5);
  });

  // ── Employees ──

  await test('readEmployees: parses employee rows', () => {
    const wb = createWorkbook({
      'Employee Master': [
        ['User Name*', 'Mobile Number*', 'Department Name*', 'Designation Name*', 'Role Names*', 'Date of Appointment*', 'Assignment From Date*', 'Password'],
        ['John Smith', '9876543210', 'Public Works', 'Junior Engineer', 'EMPLOYEE,GRO', '2024-01-15', '2024-01-15', 'pass123'],
        ['Jane Doe', '9876543211', 'Sanitation', 'Inspector', 'EMPLOYEE', '2024-02-01', '2024-02-01', ''],
      ],
    });

    const employees = readEmployees(wb);

    assert.strictEqual(employees.length, 2);
    assert.strictEqual(employees[0].code, 'JOHN_SMITH');
    assert.strictEqual(employees[0].mobileNumber, '9876543210');
    assert.deepStrictEqual(employees[0].roleNames, ['EMPLOYEE', 'GRO']);
    assert.strictEqual(employees[0].password, 'pass123');

    assert.strictEqual(employees[1].code, 'JANE_DOE');
    assert.strictEqual(employees[1].password, 'eGov@123'); // default
    assert.ok(employees[1].appointmentDate > 0, 'should have valid timestamp');
  });

  await test('readEmployees: handles duplicate names', () => {
    const wb = createWorkbook({
      'Employee Master': [
        ['User Name*', 'Mobile Number*', 'Department Name*', 'Designation Name*', 'Role Names*', 'Date of Appointment*', 'Assignment From Date*'],
        ['John Smith', '9876543210', 'PW', 'JE', 'EMPLOYEE', '2024-01-15', '2024-01-15'],
        ['John Smith', '9876543211', 'SN', 'IN', 'EMPLOYEE', '2024-01-15', '2024-01-15'],
      ],
    });

    const employees = readEmployees(wb);
    assert.strictEqual(employees[0].code, 'JOHN_SMITH');
    assert.strictEqual(employees[1].code, 'JOHN_SMITH_2'); // deduplicated
  });

  // ── Summary ──
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /root/DIGIT-MCP && npx tsx test-xlsx-reader.ts`
Expected: All tests pass. If any fail due to xlsx-reader bugs, fix the reader and re-run.

- [ ] **Step 3: Commit**

```bash
cd /root/DIGIT-MCP && git add test-xlsx-reader.ts
git commit -m "test: add unit tests for xlsx-reader sheet parsers"
```

---

## Task 7: Create xlsx-loader orchestrator

**Files:**
- Create: `src/utils/xlsx-loader.ts`

- [ ] **Step 1: Create `src/utils/xlsx-loader.ts`**

```typescript
/**
 * xlsx-loader.ts — Phase orchestrator for xlsx-based tenant setup.
 * Sequences 4 phases (Tenant → Boundaries → Masters → Employees),
 * manages cross-phase state, and calls DigitApiClient methods.
 */
import * as fs from 'fs';
import {
  loadWorkbook,
  readTenantInfo,
  readTenantBranding,
  readDepartmentsDesignations,
  readComplaintTypes,
  readEmployees,
} from './xlsx-reader.js';
import { digitApi } from '../services/digit-api.js';
import type ExcelJS from 'exceljs';

// ── Types ──

export interface PhaseResult {
  status: 'completed' | 'skipped' | 'failed';
  error?: string;
  [key: string]: unknown;
}

export interface XlsxLoadResult {
  success: boolean;
  tenant_id: string;
  phases: {
    tenant?: PhaseResult;
    boundaries?: PhaseResult;
    masters?: PhaseResult;
    employees?: PhaseResult;
  };
}

interface RowStatus {
  name: string;
  code?: string;
  status: 'created' | 'exists' | 'failed';
  error?: string;
}

// ── File Resolution ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a file reference to a Buffer.
 * - Local path (starts with / or ./) → fs.readFileSync
 * - UUID → download from DIGIT filestore
 */
async function resolveFile(ref: string, tenantId: string): Promise<Buffer> {
  if (ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('../')) {
    return fs.readFileSync(ref);
  }

  if (UUID_RE.test(ref)) {
    // Download from DIGIT filestore
    const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
    const urls = await digitApi.filestoreGetUrl(root, [ref]);
    if (!urls.length) throw new Error(`FileStore ID "${ref}" not found`);

    const downloadUrl = (urls[0] as Record<string, unknown>).url as string;
    if (!downloadUrl) throw new Error(`No download URL for fileStoreId "${ref}"`);

    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);

    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  throw new Error(
    `Cannot resolve file "${ref}". Expected a local path (starting with /) or a fileStoreId (UUID format).`,
  );
}

// ── Phase Handlers ──

async function runTenantPhase(
  tenantId: string,
  fileRef: string,
): Promise<PhaseResult> {
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

  const buf = await resolveFile(fileRef, tenantId);
  const workbook = await loadWorkbook(buf);
  const { tenants, localizations } = readTenantInfo(workbook);

  let created = 0;
  let skipped = 0;
  let failedCount = 0;
  const rows: RowStatus[] = [];

  for (const tenant of tenants) {
    const uniqueId = `Tenant.${tenant.code}`;
    try {
      await digitApi.mdmsV2Create(root, 'tenant.tenants', uniqueId, {
        code: tenant.code,
        name: tenant.name,
        tenantId: tenant.code,
        parent: root,
        city: tenant.city,
        domainUrl: tenant.domainUrl,
      });
      created++;
      rows.push({ name: tenant.name, code: tenant.code, status: 'created' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists') || msg.includes('DUPLICATE') || msg.includes('unique')) {
        skipped++;
        rows.push({ name: tenant.name, code: tenant.code, status: 'exists' });
      } else {
        failedCount++;
        rows.push({ name: tenant.name, code: tenant.code, status: 'failed', error: msg });
      }
    }
  }

  // Handle optional branding sheet
  const brandingRecords = readTenantBranding(workbook);
  let brandingCreated = 0;
  for (const branding of brandingRecords) {
    try {
      await digitApi.mdmsV2Create(root, 'tenant.citymodule', `Branding.${branding.code}`, branding);
      brandingCreated++;
    } catch {
      // Non-fatal — branding is optional
    }
  }

  // Upsert localizations
  let localizationKeys = 0;
  if (localizations.length > 0) {
    try {
      await digitApi.localizationUpsert(root, localizations);
      localizationKeys = localizations.length;
    } catch {
      // Non-fatal — log but don't fail the phase
    }
  }

  return {
    status: failedCount > 0 && created === 0 ? 'failed' : 'completed',
    created,
    skipped,
    failed: failedCount,
    branding_created: brandingCreated,
    localization_keys: localizationKeys,
    rows,
  };
}

async function runBoundaryPhase(
  tenantId: string,
  fileRef: string,
): Promise<PhaseResult> {
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

  const buf = await resolveFile(fileRef, tenantId);

  // Upload file to filestore
  const uploadResult = await digitApi.filestoreUpload(
    root,
    'boundary',
    buf,
    'boundary-data.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );

  if (!uploadResult.length) {
    return { status: 'failed', error: 'Filestore upload returned no results' };
  }

  const fileStoreId = (uploadResult[0] as Record<string, unknown>).fileStoreId as string;
  if (!fileStoreId) {
    return { status: 'failed', error: 'Filestore upload returned no fileStoreId' };
  }

  // Call boundary management process API
  try {
    const processResult = await digitApi.boundaryMgmtProcess(tenantId, {
      tenantId,
      type: 'boundary',
      hierarchyType: 'ADMIN',
      fileStoreId,
      action: 'create',
    });

    return {
      status: 'completed',
      message: 'Boundary file submitted for processing via boundary management service',
      fileStoreId,
      processResult,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      fileStoreId,
    };
  }
}

async function runMastersPhase(
  tenantId: string,
  fileRef: string,
): Promise<PhaseResult & { deptNameToCode?: Map<string, string> }> {
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

  const buf = await resolveFile(fileRef, tenantId);
  const workbook = await loadWorkbook(buf);

  const result: PhaseResult & { deptNameToCode?: Map<string, string> } = {
    status: 'completed',
    departments: { created: 0, exists: 0, failed: 0 } as Record<string, number>,
    designations: { created: 0, exists: 0, failed: 0 } as Record<string, number>,
    complaint_types: { created: 0, exists: 0, failed: 0 } as Record<string, number>,
    localization_keys: 0,
  };

  // ── Departments & Designations ──
  const {
    departments,
    designations,
    localizations: deptDesigLocalizations,
    deptNameToCode,
    desigNameToCode,
  } = readDepartmentsDesignations(workbook);

  const deptStats = result.departments as Record<string, number>;
  for (const dept of departments) {
    try {
      await digitApi.mdmsV2Create(root, 'common-masters.Department', dept.code, dept);
      deptStats.created++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists') || msg.includes('DUPLICATE') || msg.includes('unique')) {
        deptStats.exists++;
      } else {
        deptStats.failed++;
      }
    }
  }

  const desigStats = result.designations as Record<string, number>;
  for (const desig of designations) {
    try {
      await digitApi.mdmsV2Create(root, 'common-masters.Designation', desig.code, desig);
      desigStats.created++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists') || msg.includes('DUPLICATE') || msg.includes('unique')) {
        desigStats.exists++;
      } else {
        desigStats.failed++;
      }
    }
  }

  // ── Complaint Types ──
  let complaintTypes: { serviceCode: string; name: string; [k: string]: unknown }[] = [];
  let complaintLocalizations: { code: string; message: string; module: string; locale: string }[] = [];
  try {
    const parsed = readComplaintTypes(workbook, deptNameToCode);
    complaintTypes = parsed.complaintTypes;
    complaintLocalizations = parsed.localizations;
  } catch {
    // Complaint Type Master sheet may be absent — that's OK
  }

  const ctStats = result.complaint_types as Record<string, number>;
  for (const ct of complaintTypes) {
    try {
      await digitApi.mdmsV2Create(root, 'RAINMAKER-PGR.ServiceDefs', ct.serviceCode, ct);
      ctStats.created++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('already exists') || msg.includes('DUPLICATE') || msg.includes('unique')) {
        ctStats.exists++;
      } else {
        ctStats.failed++;
      }
    }
  }

  // ── Localizations ──
  const allLocalizations = [...deptDesigLocalizations, ...complaintLocalizations];
  if (allLocalizations.length > 0) {
    try {
      await digitApi.localizationUpsert(root, allLocalizations);
      (result as Record<string, unknown>).localization_keys = allLocalizations.length;
    } catch {
      // Non-fatal
    }
  }

  // Pass deptNameToCode for Phase 4
  result.deptNameToCode = deptNameToCode;

  return result;
}

async function runEmployeePhase(
  tenantId: string,
  fileRef: string,
  deptNameToCode?: Map<string, string>,
): Promise<PhaseResult> {
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

  const buf = await resolveFile(fileRef, tenantId);
  const workbook = await loadWorkbook(buf);
  const employees = readEmployees(workbook);

  // If deptNameToCode not provided from Phase 3, fetch from MDMS
  const deptMap = deptNameToCode || new Map<string, string>();
  const desigMap = new Map<string, string>();

  if (deptMap.size === 0) {
    try {
      const depts = await digitApi.mdmsV2Search<Record<string, unknown>>(root, 'common-masters.Department');
      for (const d of depts) {
        deptMap.set(d.name as string, d.code as string);
      }
    } catch {
      // Will proceed with raw names
    }
  }

  try {
    const desigs = await digitApi.mdmsV2Search<Record<string, unknown>>(root, 'common-masters.Designation');
    for (const d of desigs) {
      desigMap.set(d.name as string, d.code as string);
    }
  } catch {
    // Will proceed with raw names
  }

  const rows: RowStatus[] = [];
  let created = 0;
  let failedCount = 0;

  for (const emp of employees) {
    const deptCode = deptMap.get(emp.departmentName) || emp.departmentName;
    const desigCode = desigMap.get(emp.designationName) || emp.designationName;

    const assignments = [
      {
        department: deptCode,
        designation: desigCode,
        fromDate: emp.joiningDate,
        isCurrentAssignment: true,
        tenantId,
      },
    ];

    const jurisdictions = [
      {
        hierarchy: 'ADMIN',
        boundaryType: 'City',
        boundary: tenantId,
        tenantId,
      },
    ];

    const user = {
      name: emp.name,
      mobileNumber: emp.mobileNumber,
      userName: emp.code,
      password: emp.password,
      tenantId,
      roles: emp.roleNames.map((r) => ({
        code: r,
        name: r,
        tenantId,
      })),
    };

    try {
      await digitApi.employeeCreate(tenantId, [
        {
          code: emp.code,
          employeeStatus: 'EMPLOYED',
          employeeType: 'PERMANENT',
          dateOfAppointment: emp.appointmentDate,
          user,
          assignments,
          jurisdictions,
        },
      ]);
      created++;
      rows.push({ name: emp.name, code: emp.code, status: 'created' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failedCount++;
      rows.push({ name: emp.name, code: emp.code, status: 'failed', error: msg });
    }
  }

  return {
    status: failedCount > 0 && created === 0 ? 'failed' : 'completed',
    created,
    failed: failedCount,
    rows,
  };
}

// ── Main Orchestrator ──

export interface XlsxLoadOptions {
  tenant_id: string;
  tenant_file?: string;
  boundary_file?: string;
  masters_file?: string;
  employee_file?: string;
}

/**
 * Run xlsx-based tenant setup across all provided phases.
 * Phases execute in dependency order: Tenant → Boundaries → Masters → Employees.
 */
export async function loadFromXlsx(options: XlsxLoadOptions): Promise<XlsxLoadResult> {
  const { tenant_id, tenant_file, boundary_file, masters_file, employee_file } = options;

  const result: XlsxLoadResult = {
    success: true,
    tenant_id,
    phases: {},
  };

  let deptNameToCode: Map<string, string> | undefined;

  // Phase 1: Tenant
  if (tenant_file) {
    try {
      result.phases.tenant = await runTenantPhase(tenant_id, tenant_file);
    } catch (error) {
      result.phases.tenant = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Phase 2: Boundaries
  if (boundary_file) {
    try {
      result.phases.boundaries = await runBoundaryPhase(tenant_id, boundary_file);
    } catch (error) {
      result.phases.boundaries = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Phase 3: Masters
  if (masters_file) {
    try {
      const mastersResult = await runMastersPhase(tenant_id, masters_file);
      deptNameToCode = mastersResult.deptNameToCode;
      // Remove the Map from the serializable result
      const { deptNameToCode: _, ...serializableResult } = mastersResult;
      result.phases.masters = serializableResult;
    } catch (error) {
      result.phases.masters = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Phase 4: Employees
  if (employee_file) {
    try {
      result.phases.employees = await runEmployeePhase(tenant_id, employee_file, deptNameToCode);
    } catch (error) {
      result.phases.employees = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Set overall success based on phase results
  const phaseResults = Object.values(result.phases);
  result.success = phaseResults.length > 0 && phaseResults.every((p) => p.status !== 'failed');

  return result;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /root/DIGIT-MCP && npm run build`
Expected: Clean compile.

- [ ] **Step 3: Commit**

```bash
cd /root/DIGIT-MCP && git add src/utils/xlsx-loader.ts
git commit -m "feat: add xlsx-loader phase orchestrator for tenant setup"
```

---

## Task 8: Register `city_setup_from_xlsx` tool

**Files:**
- Modify: `src/tools/mdms-tenant.ts` (add new tool registration at end of `registerMdmsTenantTools`)

- [ ] **Step 1: Add import for xlsx-loader**

At the top of `src/tools/mdms-tenant.ts`, after the probe imports added in Task 3, add:

```typescript
import { loadFromXlsx } from '../utils/xlsx-loader.js';
```

- [ ] **Step 2: Register the tool**

In `src/tools/mdms-tenant.ts`, find the end of `registerMdmsTenantTools()` (the closing `}` of the function). Before that closing brace, add the new tool registration:

```typescript
  // ──────────────────────────────────────────
  // city_setup_from_xlsx — xlsx-based tenant setup
  // ──────────────────────────────────────────
  registry.register({
    name: 'city_setup_from_xlsx',
    group: 'mdms',
    category: 'setup',
    risk: 'write',
    description:
      'Set up a city tenant from xlsx files in CCRS dataloader format. ' +
      'Processes up to 4 phases in order: Tenant info, Boundaries, Common Masters (departments, ' +
      'designations, complaint types), and Employees. Each file is optional — provide only the ' +
      'phases you need. Files can be local paths or DIGIT filestore IDs (UUID format).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Target city tenant ID (e.g. "pg.newcity"). Must contain a dot.',
        },
        tenant_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Tenant & Branding xlsx. ' +
            'Expected sheets: "Tenant Info" (required), "Tenant Branding Details" (optional).',
        },
        boundary_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Boundary xlsx. ' +
            'Uploaded to filestore and processed via boundary management service.',
        },
        masters_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Common & Complaint Masters xlsx. ' +
            'Expected sheets: "Department And Designation Master", "Complaint Type Master".',
        },
        employee_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Employee Master xlsx. ' +
            'Expected sheet: "Employee Master".',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const tenantFile = args.tenant_file as string | undefined;
      const boundaryFile = args.boundary_file as string | undefined;
      const mastersFile = args.masters_file as string | undefined;
      const employeeFile = args.employee_file as string | undefined;

      // Validate tenant_id format
      if (!tenantId.includes('.')) {
        return JSON.stringify({
          success: false,
          error: `tenant_id "${tenantId}" must contain a dot (e.g. "pg.newcity"). ` +
            'Use tenant_bootstrap for state-level root tenants.',
        }, null, 2);
      }

      // At least one file must be provided
      if (!tenantFile && !boundaryFile && !mastersFile && !employeeFile) {
        return JSON.stringify({
          success: false,
          error: 'At least one file parameter must be provided (tenant_file, boundary_file, masters_file, or employee_file).',
        }, null, 2);
      }

      try {
        const result = await loadFromXlsx({
          tenant_id: tenantId,
          tenant_file: tenantFile,
          boundary_file: boundaryFile,
          masters_file: mastersFile,
          employee_file: employeeFile,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'If files are local paths, ensure they exist and are readable. ' +
            'If fileStoreIds, ensure the files were uploaded to DIGIT filestore first.',
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);
```

- [ ] **Step 3: Verify build**

Run: `cd /root/DIGIT-MCP && npm run build`
Expected: Clean compile.

- [ ] **Step 4: Verify tool appears in registry**

Run: `cd /root/DIGIT-MCP && npx tsx -e "
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';
const r = new ToolRegistry();
registerAllTools(r);
const tool = r.getTool('city_setup_from_xlsx');
console.log(tool ? 'Tool registered: ' + tool.name + ' (group: ' + tool.group + ')' : 'NOT FOUND');
"`
Expected: `Tool registered: city_setup_from_xlsx (group: mdms)`

- [ ] **Step 5: Commit**

```bash
cd /root/DIGIT-MCP && git add src/tools/mdms-tenant.ts
git commit -m "feat: register city_setup_from_xlsx MCP tool"
```

---

## Task 9: Integration test for xlsx-based tenant setup

**Files:**
- Modify: `test-integration-full.ts`

- [ ] **Step 1: Add xlsx creation helper to test file**

At the top of `test-integration-full.ts`, after existing imports, add:

```typescript
import ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
```

Add a helper function near the other helpers (before the test functions):

```typescript
/** Create a temporary xlsx file with given sheet data. Returns the file path. */
async function createTempXlsx(sheets: Record<string, string[][]>): Promise<string> {
  const wb = new ExcelJS.Workbook();
  for (const [name, data] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    for (const row of data) {
      ws.addRow(row);
    }
  }
  const tmpPath = path.join(os.tmpdir(), `digit-test-${Date.now()}-${Math.random().toString(36).slice(2)}.xlsx`);
  await wb.xlsx.writeFile(tmpPath);
  return tmpPath;
}
```

- [ ] **Step 2: Add integration test for city_setup_from_xlsx with masters file**

Find an appropriate location in the test file (after the existing tenant/city_setup tests, or at the end before the summary). Add:

```typescript
  // ── xlsx-based tenant setup tests ──

  await test('16.1 city_setup_from_xlsx: masters file (departments + complaint types)', async () => {
    const mastersPath = await createTempXlsx({
      'Department And Designation Master': [
        ['Department Name*', 'Designation Name*', 'Jurisdiction'],
        [`${TEST_PREFIX} Roads`, `${TEST_PREFIX} Engineer`, 'City'],
        [`${TEST_PREFIX} Roads`, `${TEST_PREFIX} Supervisor`, 'City'],
        [`${TEST_PREFIX} Water`, `${TEST_PREFIX} Inspector`, 'City'],
      ],
      'Complaint Type Master': [
        ['Complaint Type*', 'Complaint sub type*', 'Department Name*', 'Resolution Time (Hours)*', 'Search Words*', 'Priority'],
        [`${TEST_PREFIX} Road Issue`, '', `${TEST_PREFIX} Roads`, '48', 'road,pothole', '3'],
        ['', `${TEST_PREFIX} Pothole`, '', '', '', ''],
      ],
    });

    try {
      const r = await call('city_setup_from_xlsx', {
        tenant_id: state.tenantId,
        masters_file: mastersPath,
      });
      assert(r.success !== undefined, 'should return success field');
      assert(r.phases, 'should return phases');
      const phases = r.phases as Record<string, Record<string, unknown>>;
      assert(phases.masters, 'should have masters phase');
      assert(phases.masters.status === 'completed' || phases.masters.departments,
        `masters phase should complete: ${JSON.stringify(phases.masters)}`);
      return [`Masters phase: ${JSON.stringify(phases.masters)}`];
    } finally {
      fs.unlinkSync(mastersPath);
    }
  });

  await test('16.2 city_setup_from_xlsx: validation errors', async () => {
    // No dot in tenant_id
    const r1 = await call('city_setup_from_xlsx', { tenant_id: 'nodot' });
    assert(r1.success === false, 'should fail without dot in tenant_id');
    assert((r1.error as string).includes('dot'), 'error should mention dot requirement');

    // No files provided
    const r2 = await call('city_setup_from_xlsx', { tenant_id: 'pg.test' });
    assert(r2.success === false, 'should fail without any files');
    assert((r2.error as string).includes('file'), 'error should mention file requirement');

    return ['Validation errors caught correctly'];
  });
```

- [ ] **Step 3: Run the integration tests**

Run: `cd /root/DIGIT-MCP && CRS_ENVIRONMENT=chakshu-digit CRS_USERNAME=ADMIN CRS_PASSWORD=eGov@123 npx tsx test-integration-full.ts 2>&1 | tail -30`
Expected: All tests pass including the new `16.x` tests.

- [ ] **Step 4: Commit**

```bash
cd /root/DIGIT-MCP && git add test-integration-full.ts
git commit -m "test: add integration tests for city_setup_from_xlsx"
```

---

## Task 10: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd /root/DIGIT-MCP && npm run build`
Expected: Clean compile, no errors.

- [ ] **Step 2: Run xlsx-reader unit tests**

Run: `cd /root/DIGIT-MCP && npx tsx test-xlsx-reader.ts`
Expected: All tests pass.

- [ ] **Step 3: Run full integration test suite**

Run: `cd /root/DIGIT-MCP && CRS_ENVIRONMENT=chakshu-digit CRS_USERNAME=ADMIN CRS_PASSWORD=eGov@123 npx tsx test-integration-full.ts`
Expected: 129+ tests pass (127 existing + 2-3 new).

- [ ] **Step 4: Verify CLI auto-generation**

Run: `cd /root/DIGIT-MCP && npx tsx src/cli.ts mdms city-setup-from-xlsx --help`
Expected: Shows help with tenant_id, tenant_file, boundary_file, masters_file, employee_file options.

- [ ] **Step 5: Commit any remaining changes**

```bash
cd /root/DIGIT-MCP && git add -A && git status
# Only commit if there are changes
git commit -m "chore: final verification pass"
```

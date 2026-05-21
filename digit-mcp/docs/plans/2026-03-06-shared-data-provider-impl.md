# Shared DIGIT Data Provider — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract a shared `@digit-mcp/data-provider` package from existing MCP and UI code, providing `DigitApiClient`, react-admin `DataProvider`, `AuthProvider`, and resource registry.

**Architecture:** npm workspace monorepo. The package lives at `packages/data-provider/` with TypeScript source compiled to ESM. MCP server re-exports from the package. UI imports it via workspace link.

**Tech Stack:** TypeScript 5.5+, ra-core (headless react-admin), native fetch, npm workspaces

---

### Task 1: Monorepo Workspace Setup

**Files:**
- Modify: `DIGIT-MCP/package.json`
- Create: `DIGIT-MCP/packages/data-provider/package.json`
- Create: `DIGIT-MCP/packages/data-provider/tsconfig.json`
- Create: `DIGIT-MCP/packages/data-provider/src/index.ts`

**Step 1: Add workspaces to root package.json**

Add `"workspaces": ["packages/*"]` to `/root/DIGIT-MCP/package.json` (top-level, after `"type": "module"`):

```json
{
  "name": "@chakshu-gautam/digit-mcp",
  "version": "1.0.0",
  "type": "module",
  "workspaces": ["packages/*"],
  ...
}
```

Also update root `tsconfig.json` to exclude packages from its own compilation — add `"packages"` to the `exclude` array:

```json
{
  "compilerOptions": { ... },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "packages"]
}
```

**Step 2: Create package.json for data-provider**

Create `/root/DIGIT-MCP/packages/data-provider/package.json`:

```json
{
  "name": "@digit-mcp/data-provider",
  "version": "0.1.0",
  "description": "Shared DIGIT platform API client, react-admin DataProvider, and AuthProvider",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./client": {
      "import": "./dist/client/index.js",
      "types": "./dist/client/index.d.ts"
    }
  },
  "files": ["dist/"],
  "scripts": {
    "build": "tsc",
    "test": "node --import tsx --test src/**/*.test.ts",
    "test:watch": "node --import tsx --test --watch src/**/*.test.ts"
  },
  "dependencies": {},
  "peerDependencies": {
    "ra-core": ">=4.0.0"
  },
  "peerDependenciesMeta": {
    "ra-core": { "optional": true }
  },
  "devDependencies": {
    "ra-core": "^5.0.0",
    "typescript": "^5.5.0",
    "tsx": "^4.15.0"
  }
}
```

**Step 3: Create tsconfig.json for data-provider**

Create `/root/DIGIT-MCP/packages/data-provider/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create barrel index**

Create `/root/DIGIT-MCP/packages/data-provider/src/index.ts`:

```typescript
// Client
export { DigitApiClient, ApiClientError } from './client/DigitApiClient.js';
export { ENDPOINTS, OAUTH_CONFIG } from './client/endpoints.js';
export type {
  RequestInfo, UserInfo, Role, MdmsRecord, ApiError,
  Environment, ErrorCategory,
} from './client/types.js';

// Resource registry
export {
  REGISTRY, getResourceConfig, getAllResources,
  getDedicatedResources, getMdmsResources, getGenericMdmsResources,
  getResourceIdField, getResourceLabel,
} from './providers/resourceRegistry.js';
export type { ResourceConfig, ResourceType } from './providers/resourceRegistry.js';

// react-admin providers (optional peer dep on ra-core)
export { createDigitDataProvider } from './providers/dataProvider.js';
export { createDigitAuthProvider } from './providers/authProvider.js';
```

**Step 5: Run npm install to link workspace**

Run: `cd /root/DIGIT-MCP && npm install`
Expected: Workspace linked, node_modules updated

**Step 6: Commit**

```bash
git add packages/data-provider/package.json packages/data-provider/tsconfig.json packages/data-provider/src/index.ts package.json tsconfig.json
git commit -m "feat: scaffold @digit-mcp/data-provider workspace package"
```

---

### Task 2: Extract Types and Endpoints

**Files:**
- Create: `packages/data-provider/src/client/types.ts`
- Create: `packages/data-provider/src/client/endpoints.ts`
- Create: `packages/data-provider/src/client/errors.ts`

**Step 1: Write the types test**

Create `/root/DIGIT-MCP/packages/data-provider/src/client/types.test.ts`:

```typescript
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { MDMS_SCHEMAS } from './types.js';

describe('types', () => {
  it('exports MDMS_SCHEMAS with expected keys', () => {
    assert.ok(MDMS_SCHEMAS.DEPARTMENT);
    assert.equal(MDMS_SCHEMAS.DEPARTMENT, 'common-masters.Department');
    assert.equal(MDMS_SCHEMAS.TENANT, 'tenant.tenants');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/client/types.test.ts`
Expected: FAIL — module not found

**Step 3: Create types.ts**

Create `/root/DIGIT-MCP/packages/data-provider/src/client/types.ts`:

Copy from `DIGIT-MCP/src/types/index.ts` — the following types (NOT the MCP-specific ones like ToolGroup, ToolMetadata, ValidationResult):

```typescript
/** Error categories for agent-friendly error handling */
export type ErrorCategory = 'validation' | 'auth' | 'api' | 'internal';

/** Standard DIGIT request envelope */
export interface RequestInfo {
  apiId: string;
  ver?: string;
  ts?: number;
  action?: string;
  did?: string;
  key?: string;
  msgId: string;
  authToken: string;
  userInfo?: UserInfo;
}

/** Authenticated user info */
export interface UserInfo {
  id?: number;
  uuid?: string;
  userName: string;
  name: string;
  mobileNumber?: string;
  emailId?: string;
  type?: string;
  tenantId: string;
  roles?: Role[];
}

/** DIGIT role assignment */
export interface Role {
  code: string;
  name: string;
  tenantId?: string;
  description?: string;
}

/** Raw MDMS v2 record envelope */
export interface MdmsRecord {
  id: string;
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: Record<string, unknown>;
  isActive: boolean;
  auditDetails?: {
    createdBy: string;
    createdTime: number;
    lastModifiedBy: string;
    lastModifiedTime: number;
  };
}

/** API error from DIGIT services */
export interface ApiError {
  code: string;
  message: string;
  description?: string;
}

/** Environment configuration */
export interface Environment {
  name: string;
  url: string;
  stateTenantId: string;
  description?: string;
  /** Endpoint path overrides, keyed by ENDPOINTS constant names */
  endpointOverrides?: Record<string, string>;
}

/** Well-known MDMS schema codes */
export const MDMS_SCHEMAS = {
  DEPARTMENT: 'common-masters.Department',
  DESIGNATION: 'common-masters.Designation',
  GENDER_TYPE: 'common-masters.GenderType',
  EMPLOYEE_STATUS: 'egov-hrms.EmployeeStatus',
  EMPLOYEE_TYPE: 'egov-hrms.EmployeeType',
  ROLES: 'ACCESSCONTROL-ROLES.roles',
  PGR_SERVICE_DEFS: 'RAINMAKER-PGR.ServiceDefs',
  TENANT: 'tenant.tenants',
} as const;
```

**Step 4: Create endpoints.ts**

Copy from `DIGIT-MCP/src/config/endpoints.ts` — the entire `ENDPOINTS` and `OAUTH_CONFIG` objects.

Create `/root/DIGIT-MCP/packages/data-provider/src/client/endpoints.ts`:

```typescript
// DIGIT API endpoint paths — copied from MCP server, single source of truth
export const ENDPOINTS = {
  AUTH: '/user/oauth/token',
  USER_SEARCH: '/user/_search',
  USER_CREATE: '/user/users/_createnovalidate',
  USER_UPDATE: '/user/users/_updatenovalidate',
  MDMS_SEARCH: '/egov-mdms-service/v2/_search',
  MDMS_CREATE: '/egov-mdms-service/v2/_create',
  MDMS_UPDATE: '/egov-mdms-service/v2/_update',
  MDMS_SCHEMA_CREATE: '/mdms-v2/schema/v1/_create',
  MDMS_SCHEMA_SEARCH: '/mdms-v2/schema/v1/_search',
  BOUNDARY_SEARCH: '/boundary-service/boundary/_search',
  BOUNDARY_CREATE: '/boundary-service/boundary/_create',
  BOUNDARY_HIERARCHY_SEARCH: '/boundary-service/boundary-hierarchy-definition/_search',
  BOUNDARY_HIERARCHY_CREATE: '/boundary-service/boundary-hierarchy-definition/_create',
  BOUNDARY_RELATIONSHIP_CREATE: '/boundary-service/boundary-relationships/_create',
  BOUNDARY_RELATIONSHIP_SEARCH: '/boundary-service/boundary-relationships/_search',
  HRMS_EMPLOYEES_SEARCH: '/egov-hrms/employees/_search',
  HRMS_EMPLOYEES_CREATE: '/egov-hrms/employees/_create',
  HRMS_EMPLOYEES_UPDATE: '/egov-hrms/employees/_update',
  LOCALIZATION_SEARCH: '/localization/messages/v1/_search',
  LOCALIZATION_UPSERT: '/localization/messages/v1/_upsert',
  PGR_CREATE: '/pgr-services/v2/request/_create',
  PGR_SEARCH: '/pgr-services/v2/request/_search',
  PGR_UPDATE: '/pgr-services/v2/request/_update',
  WORKFLOW_BUSINESS_SERVICE_SEARCH: '/egov-workflow-v2/egov-wf/businessservice/_search',
  WORKFLOW_BUSINESS_SERVICE_CREATE: '/egov-workflow-v2/egov-wf/businessservice/_create',
  WORKFLOW_PROCESS_SEARCH: '/egov-workflow-v2/egov-wf/process/_search',
  FILESTORE_UPLOAD: '/filestore/v1/files',
  FILESTORE_URL: '/filestore/v1/files/url',
  ACCESS_ROLES_SEARCH: '/access/v1/roles/_search',
  ACCESS_ACTIONS_SEARCH: '/access/v1/actions/_search',
  IDGEN_GENERATE: '/egov-idgen/id/_generate',
  LOCATION_BOUNDARY_SEARCH: '/egov-location/location/v11/boundarys/_search',
  ENC_ENCRYPT: '/egov-enc-service/crypto/v1/_encrypt',
  ENC_DECRYPT: '/egov-enc-service/crypto/v1/_decrypt',
  BNDRY_MGMT_PROCESS: '/egov-bndry-mgmnt/v1/_process',
  BNDRY_MGMT_GENERATE: '/egov-bndry-mgmnt/v1/_generate',
  BNDRY_MGMT_PROCESS_SEARCH: '/egov-bndry-mgmnt/v1/_process-search',
  BNDRY_MGMT_GENERATE_SEARCH: '/egov-bndry-mgmnt/v1/_generate-search',
  INBOX_V2_SEARCH: '/inbox/v2/_search',
} as const;

export const OAUTH_CONFIG = {
  clientId: 'egov-user-client',
  clientSecret: '',
  grantType: 'password',
  scope: 'read',
} as const;
```

**Step 5: Create errors.ts**

Create `/root/DIGIT-MCP/packages/data-provider/src/client/errors.ts`:

```typescript
import type { ApiError, ErrorCategory } from './types.js';

function deriveErrorCategory(statusCode: number): ErrorCategory {
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode >= 400 && statusCode < 500) return 'validation';
  return 'api';
}

export class ApiClientError extends Error {
  public errors: ApiError[];
  public statusCode: number;
  public category: ErrorCategory;

  constructor(errors: ApiError[], statusCode: number) {
    super(errors.map((e) => e.message || e.code || 'Unknown error').join(', '));
    this.name = 'ApiClientError';
    this.errors = errors;
    this.statusCode = statusCode;
    this.category = deriveErrorCategory(statusCode);
  }

  /** First error message for display */
  get firstError(): string {
    return this.errors[0]?.message || this.message;
  }
}
```

**Step 6: Create client barrel**

Create `/root/DIGIT-MCP/packages/data-provider/src/client/index.ts`:

```typescript
export { DigitApiClient } from './DigitApiClient.js';
export { ApiClientError } from './errors.js';
export { ENDPOINTS, OAUTH_CONFIG } from './endpoints.js';
export type {
  RequestInfo, UserInfo, Role, MdmsRecord, ApiError,
  Environment, ErrorCategory,
} from './types.js';
export { MDMS_SCHEMAS } from './types.js';
```

**Step 7: Run test to verify it passes**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/client/types.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add packages/data-provider/src/client/
git commit -m "feat(data-provider): add types, endpoints, and error classes"
```

---

### Task 3: Extract DigitApiClient

**Files:**
- Create: `packages/data-provider/src/client/DigitApiClient.ts`
- Test: `packages/data-provider/src/client/DigitApiClient.test.ts`

**Step 1: Write the failing test**

Create `/root/DIGIT-MCP/packages/data-provider/src/client/DigitApiClient.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from './DigitApiClient.js';

describe('DigitApiClient', () => {
  let client: DigitApiClient;

  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com' });
  });

  it('starts unauthenticated', () => {
    assert.equal(client.isAuthenticated(), false);
  });

  it('builds request info', () => {
    const info = client.buildRequestInfo();
    assert.equal(info.apiId, 'Rainmaker');
    assert.equal(info.authToken, '');
    assert.ok(info.ts);
  });

  it('sets auth token and user info', () => {
    client.setAuth('test-token', {
      userName: 'admin',
      name: 'Admin',
      tenantId: 'pg',
    });
    assert.equal(client.isAuthenticated(), true);
    const info = client.buildRequestInfo();
    assert.equal(info.authToken, 'test-token');
  });

  it('resolves endpoint with overrides', () => {
    const c = new DigitApiClient({
      url: 'https://test.example.com',
      endpointOverrides: { MDMS_SEARCH: '/mdms-v2/v2/_search' },
    });
    assert.equal(c.endpoint('MDMS_SEARCH'), '/mdms-v2/v2/_search');
    assert.equal(c.endpoint('USER_SEARCH'), '/user/_search');
  });

  it('encodes basic auth isomorphically', () => {
    // btoa is available in Node 16+
    const encoded = client.basicAuthEncode('user', 'pass');
    assert.equal(encoded, btoa('user:pass'));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/client/DigitApiClient.test.ts`
Expected: FAIL — module not found

**Step 3: Write DigitApiClient**

Create `/root/DIGIT-MCP/packages/data-provider/src/client/DigitApiClient.ts`.

This is the core extraction from `DIGIT-MCP/src/services/digit-api.ts`, but:
1. **Not a singleton** — constructor takes config (url, stateTenantId, endpointOverrides)
2. **`buildRequestInfo()` is public** — needed by DataProvider and tools
3. **`endpoint()` is public** — needed for custom requests
4. **`basicAuthEncode()` uses `btoa()`** — isomorphic (Node 16+ and browsers)
5. **All 40+ methods preserved** — same signatures as MCP's digit-api.ts
6. **`setAuth()`** for external login — MCP and UI handle login differently

```typescript
import { ENDPOINTS, OAUTH_CONFIG } from './endpoints.js';
import { ApiClientError } from './errors.js';
import type {
  RequestInfo, UserInfo, MdmsRecord, ApiError, Environment,
} from './types.js';

export interface DigitApiClientConfig {
  url: string;
  stateTenantId?: string;
  endpointOverrides?: Record<string, string>;
}

export class DigitApiClient {
  private baseUrl: string;
  private _stateTenantId: string;
  private overrides: Record<string, string>;
  private authToken: string | null = null;
  private userInfo: UserInfo | null = null;

  private static readonly RETRY_STATUS_CODES = new Set([429, 503]);
  private static readonly MAX_RETRIES = 3;

  constructor(config: DigitApiClientConfig) {
    this.baseUrl = config.url;
    this._stateTenantId = config.stateTenantId || '';
    this.overrides = config.endpointOverrides || {};
  }

  // ------------------------------------------------------------------
  // Auth
  // ------------------------------------------------------------------

  isAuthenticated(): boolean {
    return this.authToken !== null;
  }

  get stateTenantId(): string {
    return this._stateTenantId;
  }

  set stateTenantId(id: string) {
    this._stateTenantId = id;
  }

  getAuthInfo(): { authenticated: boolean; user: UserInfo | null; token: string | null; stateTenantId: string } {
    return {
      authenticated: this.isAuthenticated(),
      user: this.userInfo,
      token: this.authToken,
      stateTenantId: this._stateTenantId,
    };
  }

  /** Set auth externally (e.g., after login handled by UI) */
  setAuth(token: string, user: UserInfo): void {
    this.authToken = token;
    this.userInfo = user;
  }

  clearAuth(): void {
    this.authToken = null;
    this.userInfo = null;
  }

  // ------------------------------------------------------------------
  // Request infrastructure
  // ------------------------------------------------------------------

  /** Resolve an endpoint path, applying overrides */
  endpoint(key: keyof typeof ENDPOINTS): string {
    return this.overrides[key] || ENDPOINTS[key];
  }

  /** Build the standard DIGIT RequestInfo envelope */
  buildRequestInfo(action?: string): RequestInfo {
    return {
      apiId: 'Rainmaker',
      ver: '1.0',
      ts: Date.now(),
      action,
      msgId: `${Date.now()}|en_IN`,
      authToken: this.authToken || '',
      userInfo: this.userInfo || undefined,
    };
  }

  /** Isomorphic base64 encoding */
  basicAuthEncode(user: string, pass: string): string {
    return btoa(`${user}:${pass}`);
  }

  /** Core request method with retry logic */
  async request<T = unknown>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const jsonBody = JSON.stringify(body);
    let lastResponse: Response | undefined;

    for (let attempt = 0; attempt < DigitApiClient.MAX_RETRIES; attempt++) {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: jsonBody,
      });

      if (!DigitApiClient.RETRY_STATUS_CODES.has(response.status)) {
        const data = await response.json() as Record<string, unknown>;
        if (!response.ok || (data.Errors as ApiError[] | undefined)?.length) {
          const errors: ApiError[] = (data.Errors as ApiError[]) || [
            { code: `HTTP_${response.status}`, message: (data.message as string) || `Request failed: ${response.status}` },
          ];
          throw new ApiClientError(errors, response.status);
        }
        return data as T;
      }

      lastResponse = response;
      if (attempt < DigitApiClient.MAX_RETRIES - 1) {
        const retryAfter = response.headers.get('Retry-After');
        const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : (1 << attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    const data = await lastResponse!.json().catch(() => ({})) as Record<string, unknown>;
    const errors: ApiError[] = (data.Errors as ApiError[]) || [
      { code: `HTTP_${lastResponse!.status}`, message: (data.message as string) || `Request failed after ${DigitApiClient.MAX_RETRIES} retries` },
    ];
    throw new ApiClientError(errors, lastResponse!.status);
  }

  // ------------------------------------------------------------------
  // Login (OAuth2 password grant)
  // ------------------------------------------------------------------

  async login(username: string, password: string, tenantId: string, userType = 'EMPLOYEE'): Promise<{ access_token: string; UserRequest: UserInfo }> {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('userType', userType);
    formData.append('tenantId', tenantId);
    formData.append('scope', OAUTH_CONFIG.scope);
    formData.append('grant_type', OAUTH_CONFIG.grantType);

    const basicAuth = this.basicAuthEncode(OAUTH_CONFIG.clientId, OAUTH_CONFIG.clientSecret);

    const response = await fetch(`${this.baseUrl}${this.endpoint('AUTH')}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: formData.toString(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        (error as Record<string, string>).error_description ||
        (error as Record<string, string>).message ||
        `Login failed: ${response.status}`
      );
    }

    const data = await response.json() as { access_token: string; UserRequest: UserInfo };
    this.authToken = data.access_token;
    this.userInfo = data.UserRequest;

    // Auto-detect state tenant
    const derivedState = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
    this._stateTenantId = derivedState;

    return data;
  }

  // ------------------------------------------------------------------
  // User service
  // ------------------------------------------------------------------

  async userSearch(tenantId: string, options?: {
    userName?: string; mobileNumber?: string; uuid?: string[];
    roleCodes?: string[]; userType?: string; limit?: number; offset?: number;
  }): Promise<Record<string, unknown>[]> {
    const body: Record<string, unknown> = {
      RequestInfo: this.buildRequestInfo(),
      tenantId,
      pageSize: options?.limit || 100,
      pageNumber: options?.offset ? Math.floor(options.offset / (options.limit || 100)) : 0,
    };
    if (options?.userName) body.userName = options.userName;
    if (options?.mobileNumber) body.mobileNumber = options.mobileNumber;
    if (options?.uuid) body.uuid = options.uuid;
    if (options?.roleCodes) body.roleCodes = options.roleCodes;
    if (options?.userType) body.userType = options.userType;

    const data = await this.request<{ user?: Record<string, unknown>[] }>(this.endpoint('USER_SEARCH'), body);
    return data.user || [];
  }

  async userCreate(user: Record<string, unknown>, tenantId: string): Promise<Record<string, unknown>> {
    const data = await this.request<{ user?: Record<string, unknown>[] }>(this.endpoint('USER_CREATE'), {
      RequestInfo: this.buildRequestInfo(), user: { ...user, tenantId },
    });
    return (data.user || [])[0] || {};
  }

  async userUpdate(user: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.request<{ user?: Record<string, unknown>[] }>(this.endpoint('USER_UPDATE'), {
      RequestInfo: this.buildRequestInfo(), user,
    });
    return (data.user || [])[0] || {};
  }

  // ------------------------------------------------------------------
  // MDMS v2
  // ------------------------------------------------------------------

  async mdmsSearch(tenantId: string, schemaCode: string, options?: {
    limit?: number; offset?: number; uniqueIdentifiers?: string[];
  }): Promise<MdmsRecord[]> {
    const criteria: Record<string, unknown> = {
      tenantId, limit: options?.limit || 100, offset: options?.offset || 0,
    };
    if (schemaCode) criteria.schemaCode = schemaCode;
    if (options?.uniqueIdentifiers) criteria.uniqueIdentifiers = options.uniqueIdentifiers;

    const data = await this.request<{ mdms?: MdmsRecord[] }>(this.endpoint('MDMS_SEARCH'), {
      RequestInfo: this.buildRequestInfo(), MdmsCriteria: criteria,
    });
    return data.mdms || [];
  }

  async mdmsCreate(tenantId: string, schemaCode: string, uniqueIdentifier: string, recordData: Record<string, unknown>): Promise<MdmsRecord> {
    const data = await this.request<{ mdms?: MdmsRecord[] }>(`${this.endpoint('MDMS_CREATE')}/${schemaCode}`, {
      RequestInfo: this.buildRequestInfo(),
      Mdms: { tenantId, schemaCode, uniqueIdentifier, data: recordData, isActive: true },
    });
    return (data.mdms || [])[0] as MdmsRecord;
  }

  async mdmsUpdate(record: MdmsRecord, isActive: boolean): Promise<MdmsRecord> {
    const data = await this.request<{ mdms?: MdmsRecord[] }>(`${this.endpoint('MDMS_UPDATE')}/${record.schemaCode}`, {
      RequestInfo: this.buildRequestInfo(),
      Mdms: { tenantId: record.tenantId, schemaCode: record.schemaCode, uniqueIdentifier: record.uniqueIdentifier, id: record.id, data: record.data, auditDetails: record.auditDetails, isActive },
    });
    return (data.mdms || [])[0] as MdmsRecord;
  }

  async mdmsSchemaSearch(tenantId: string, codes?: string[], options?: { limit?: number; offset?: number }): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ SchemaDefinitions?: Record<string, unknown>[] }>(this.endpoint('MDMS_SCHEMA_SEARCH'), {
      RequestInfo: this.buildRequestInfo(),
      SchemaDefCriteria: { tenantId, codes, limit: options?.limit || 200, offset: options?.offset || 0 },
    });
    return data.SchemaDefinitions || [];
  }

  async mdmsSchemaCreate(tenantId: string, code: string, description: string, definition: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.request<{ SchemaDefinition?: Record<string, unknown> }>(this.endpoint('MDMS_SCHEMA_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      SchemaDefinition: { tenantId, code, description, definition, isActive: true },
    });
    return data.SchemaDefinition || {};
  }

  // ------------------------------------------------------------------
  // HRMS
  // ------------------------------------------------------------------

  async employeeSearch(tenantId: string, options?: {
    codes?: string[]; departments?: string[]; limit?: number; offset?: number;
  }): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (options?.codes?.length) params.append('codes', options.codes.join(','));
    if (options?.departments?.length) params.append('departments', options.departments.join(','));
    params.append('limit', String(options?.limit || 100));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(
      `${this.endpoint('HRMS_EMPLOYEES_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.Employees || [];
  }

  async employeeCreate(tenantId: string, employees: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(this.endpoint('HRMS_EMPLOYEES_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      Employees: employees.map((emp) => ({ ...emp, tenantId })),
    });
    return data.Employees || [];
  }

  async employeeUpdate(tenantId: string, employees: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ Employees?: Record<string, unknown>[] }>(this.endpoint('HRMS_EMPLOYEES_UPDATE'), {
      RequestInfo: this.buildRequestInfo(), Employees: employees,
    });
    return data.Employees || [];
  }

  // ------------------------------------------------------------------
  // Boundary
  // ------------------------------------------------------------------

  async boundarySearch(tenantId: string, hierarchyType?: string, options?: { limit?: number; offset?: number }): Promise<Record<string, unknown>[]> {
    const boundary: Record<string, unknown> = { tenantId, limit: options?.limit || 100, offset: options?.offset || 0 };
    if (hierarchyType) boundary.hierarchyType = hierarchyType;

    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_SEARCH'), {
      RequestInfo: this.buildRequestInfo(), Boundary: boundary,
    });
    return data.Boundary || [];
  }

  async boundaryRelationshipSearch(tenantId: string, hierarchyType?: string): Promise<Record<string, unknown>[]> {
    const data = await this.request<{ TenantBoundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_RELATIONSHIP_SEARCH'), {
      RequestInfo: this.buildRequestInfo(),
      BoundaryRelationship: { tenantId, hierarchyType },
    });
    return data.TenantBoundary || [];
  }

  async boundaryHierarchySearch(tenantId: string, hierarchyType?: string): Promise<Record<string, unknown>[]> {
    const criteria: Record<string, unknown> = { tenantId, limit: 100, offset: 0 };
    if (hierarchyType) criteria.hierarchyType = hierarchyType;

    const data = await this.request<{ BoundaryHierarchy?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_HIERARCHY_SEARCH'), {
      RequestInfo: this.buildRequestInfo(), BoundaryTypeHierarchySearchCriteria: criteria,
    });
    return data.BoundaryHierarchy || [];
  }

  async boundaryCreate(tenantId: string, boundaries: { code: string; geometry?: Record<string, unknown> }[]): Promise<Record<string, unknown>[]> {
    const defaultGeometry = { type: 'Point', coordinates: [0, 0] };
    const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      Boundary: boundaries.map((b) => ({ tenantId, code: b.code, geometry: b.geometry || defaultGeometry })),
    });
    return data.Boundary || [];
  }

  async boundaryHierarchyCreate(tenantId: string, hierarchyType: string, levels: { boundaryType: string; parentBoundaryType: string | null }[]): Promise<Record<string, unknown>> {
    const data = await this.request<{ BoundaryHierarchy?: Record<string, unknown> }>(this.endpoint('BOUNDARY_HIERARCHY_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      BoundaryHierarchy: { tenantId, hierarchyType, boundaryHierarchy: levels.map((h) => ({ ...h, active: true })) },
    });
    return data.BoundaryHierarchy || {};
  }

  async boundaryRelationshipCreate(tenantId: string, code: string, hierarchyType: string, boundaryType: string, parent: string | null): Promise<Record<string, unknown>> {
    const data = await this.request<{ BoundaryRelationship?: Record<string, unknown> }>(this.endpoint('BOUNDARY_RELATIONSHIP_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      BoundaryRelationship: { tenantId, code, hierarchyType, boundaryType, parent: parent || undefined },
    });
    return data.BoundaryRelationship || {};
  }

  // ------------------------------------------------------------------
  // PGR
  // ------------------------------------------------------------------

  async pgrSearch(tenantId: string, options?: {
    serviceRequestId?: string; status?: string; limit?: number; offset?: number;
  }): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (options?.serviceRequestId) params.append('serviceRequestId', options.serviceRequestId);
    if (options?.status) params.append('applicationStatus', options.status);
    params.append('limit', String(options?.limit || 50));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(
      `${this.endpoint('PGR_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.ServiceWrappers || [];
  }

  async pgrCreate(tenantId: string, serviceCode: string, description: string, address: Record<string, unknown>, citizen?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const citizenInfo = citizen || (this.userInfo ? {
      mobileNumber: this.userInfo.mobileNumber || '0000000000',
      name: this.userInfo.name, type: 'CITIZEN',
      roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: this._stateTenantId }],
      tenantId: this._stateTenantId,
    } : undefined);

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(this.endpoint('PGR_CREATE'), {
      RequestInfo: this.buildRequestInfo(),
      service: { tenantId, serviceCode, description, address: { tenantId, geoLocation: { latitude: 0, longitude: 0 }, ...address }, citizen: citizenInfo, source: 'web', active: true },
      workflow: { action: 'APPLY' },
    });
    return (data.ServiceWrappers || [])[0] || {};
  }

  async pgrUpdate(service: Record<string, unknown>, action: string, options?: {
    comment?: string; assignees?: string[]; rating?: number;
  }): Promise<Record<string, unknown>> {
    const workflow: Record<string, unknown> = { action, assignes: options?.assignees || [], comments: options?.comment };
    if (options?.rating !== undefined) workflow.rating = options.rating;

    const data = await this.request<{ ServiceWrappers?: Record<string, unknown>[] }>(this.endpoint('PGR_UPDATE'), {
      RequestInfo: this.buildRequestInfo(), service, workflow,
    });
    return (data.ServiceWrappers || [])[0] || {};
  }

  // ------------------------------------------------------------------
  // Localization
  // ------------------------------------------------------------------

  async localizationSearch(tenantId: string, locale: string, module?: string): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, locale });
    if (module) params.append('module', module);

    const data = await this.request<{ messages?: Record<string, unknown>[] }>(
      `${this.endpoint('LOCALIZATION_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.messages || [];
  }

  async localizationUpsert(tenantId: string, locale: string, messages: { code: string; message: string; module: string }[]): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, locale });

    const data = await this.request<{ messages?: Record<string, unknown>[] }>(
      `${this.endpoint('LOCALIZATION_UPSERT')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo(), tenantId, messages: messages.map((m) => ({ ...m, locale })) },
    );
    return data.messages || [];
  }

  // ------------------------------------------------------------------
  // Workflow
  // ------------------------------------------------------------------

  async workflowBusinessServiceSearch(tenantId: string, businessServices?: string[]): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (businessServices?.length) params.append('businessServices', businessServices.join(','));

    const data = await this.request<{ BusinessServices?: Record<string, unknown>[] }>(
      `${this.endpoint('WORKFLOW_BUSINESS_SERVICE_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.BusinessServices || [];
  }

  async workflowBusinessServiceCreate(tenantId: string, businessService: Record<string, unknown>): Promise<Record<string, unknown>> {
    const data = await this.request<{ BusinessServices?: Record<string, unknown>[] }>(this.endpoint('WORKFLOW_BUSINESS_SERVICE_CREATE'), {
      RequestInfo: this.buildRequestInfo(), BusinessServices: [{ ...businessService, tenantId }],
    });
    return (data.BusinessServices || [])[0] || {};
  }

  async workflowProcessSearch(tenantId: string, businessIds?: string[], options?: {
    limit?: number; offset?: number; history?: boolean;
  }): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    if (businessIds?.length) params.append('businessIds', businessIds.join(','));
    params.append('history', String(options?.history ?? true));
    params.append('limit', String(options?.limit || 50));
    params.append('offset', String(options?.offset || 0));

    const data = await this.request<{ ProcessInstances?: Record<string, unknown>[] }>(
      `${this.endpoint('WORKFLOW_PROCESS_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.ProcessInstances || [];
  }

  // ------------------------------------------------------------------
  // Access Control
  // ------------------------------------------------------------------

  async accessRolesSearch(tenantId: string): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId });
    const data = await this.request<{ roles?: Record<string, unknown>[] }>(
      `${this.endpoint('ACCESS_ROLES_SEARCH')}?${params.toString()}`,
      { RequestInfo: this.buildRequestInfo() },
    );
    return data.roles || [];
  }

  // ------------------------------------------------------------------
  // ID Generation
  // ------------------------------------------------------------------

  async idgenGenerate(tenantId: string, idRequests: { idName: string; tenantId?: string; format?: string }[]): Promise<{ id: string }[]> {
    const data = await this.request<{ idResponses?: { id: string }[] }>(this.endpoint('IDGEN_GENERATE'), {
      RequestInfo: this.buildRequestInfo(),
      idRequests: idRequests.map((r) => ({ idName: r.idName, tenantId: r.tenantId || tenantId, format: r.format })),
    });
    return data.idResponses || [];
  }

  // ------------------------------------------------------------------
  // Filestore
  // ------------------------------------------------------------------

  async filestoreGetUrl(tenantId: string, fileStoreIds: string[]): Promise<Record<string, unknown>[]> {
    const params = new URLSearchParams({ tenantId, fileStoreIds: fileStoreIds.join(',') });
    const url = `${this.baseUrl}${this.endpoint('FILESTORE_URL')}?${params.toString()}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    const response = await fetch(url, { method: 'GET', headers });
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      throw new Error(`Filestore returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }
    const data = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error((data.message as string) || `Filestore URL fetch failed: ${response.status}`);
    return (data.fileStoreIds as Record<string, unknown>[]) || [];
  }

  // ------------------------------------------------------------------
  // Encryption (no auth required)
  // ------------------------------------------------------------------

  async encryptData(tenantId: string, values: string[]): Promise<string[]> {
    const url = `${this.baseUrl}${this.endpoint('ENC_ENCRYPT')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encryptionRequests: values.map((value) => ({ tenantId, type: 'Normal', value })) }),
    });
    if (!response.ok) throw new Error(`Encryption failed: HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async decryptData(tenantId: string, encryptedValues: string[]): Promise<string[]> {
    const url = `${this.baseUrl}${this.endpoint('ENC_DECRYPT')}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encryptedValues),
    });
    if (!response.ok) throw new Error(`Decryption failed: HTTP ${response.status}`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/client/DigitApiClient.test.ts`
Expected: PASS — all 5 tests

**Step 5: Commit**

```bash
git add packages/data-provider/src/client/
git commit -m "feat(data-provider): extract DigitApiClient from MCP digit-api.ts"
```

---

### Task 4: Resource Registry

**Files:**
- Create: `packages/data-provider/src/providers/resourceRegistry.ts`
- Test: `packages/data-provider/src/providers/resourceRegistry.test.ts`

**Step 1: Write the failing test**

Create `/root/DIGIT-MCP/packages/data-provider/src/providers/resourceRegistry.test.ts`:

```typescript
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getResourceConfig, getAllResources, getDedicatedResources,
  getGenericMdmsResources, getResourceLabel,
} from './resourceRegistry.js';

describe('resourceRegistry', () => {
  it('returns config for departments', () => {
    const config = getResourceConfig('departments');
    assert.ok(config);
    assert.equal(config.type, 'mdms');
    assert.equal(config.schema, 'common-masters.Department');
    assert.equal(config.idField, 'code');
  });

  it('returns config for employees (hrms)', () => {
    const config = getResourceConfig('employees');
    assert.ok(config);
    assert.equal(config.type, 'hrms');
    assert.equal(config.idField, 'uuid');
  });

  it('returns undefined for unknown resource', () => {
    assert.equal(getResourceConfig('nonexistent'), undefined);
  });

  it('getDedicatedResources excludes generic MDMS', () => {
    const dedicated = getDedicatedResources();
    assert.ok(dedicated['departments']);
    assert.ok(dedicated['employees']);
    assert.equal(dedicated['state-info'], undefined);
  });

  it('getGenericMdmsResources excludes dedicated', () => {
    const generic = getGenericMdmsResources();
    assert.ok(generic['state-info']);
    assert.equal(generic['departments'], undefined);
    assert.equal(generic['employees'], undefined);
  });

  it('getResourceLabel returns label for known resource', () => {
    assert.equal(getResourceLabel('departments'), 'Departments');
  });

  it('getResourceLabel capitalizes unknown resource', () => {
    assert.equal(getResourceLabel('foo'), 'Foo');
  });

  it('has all expected dedicated resources', () => {
    const dedicated = getDedicatedResources();
    const expected = ['tenants', 'departments', 'designations', 'complaint-types', 'employees', 'boundaries', 'complaints', 'localization'];
    for (const name of expected) {
      assert.ok(dedicated[name], `Missing dedicated resource: ${name}`);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/providers/resourceRegistry.test.ts`
Expected: FAIL

**Step 3: Create resourceRegistry.ts**

Create `/root/DIGIT-MCP/packages/data-provider/src/providers/resourceRegistry.ts`.

Copy from UI's `src/providers/resourceRegistry.ts` — the entire REGISTRY, types, and accessor functions. Replace the `ENDPOINTS` and `MDMS_SCHEMAS` imports to point to the package's own:

```typescript
import { ENDPOINTS } from '../client/endpoints.js';
import { MDMS_SCHEMAS } from '../client/types.js';

// (Copy the full content of the UI's resourceRegistry.ts, updating only the imports above)
// Include: ResourceType, ResourceConfig, REGISTRY, getResourceConfig, getAllResources,
// getDedicatedResources, getMdmsResources, getGenericMdmsResources, getResourceIdField, getResourceLabel
```

**Step 4: Run test to verify it passes**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/providers/resourceRegistry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/data-provider/src/providers/resourceRegistry.ts packages/data-provider/src/providers/resourceRegistry.test.ts
git commit -m "feat(data-provider): add resource registry"
```

---

### Task 5: DataProvider Implementation

**Files:**
- Create: `packages/data-provider/src/providers/dataProvider.ts`
- Test: `packages/data-provider/src/providers/dataProvider.test.ts`

**Step 1: Write the failing test**

Create `/root/DIGIT-MCP/packages/data-provider/src/providers/dataProvider.test.ts`:

```typescript
import { describe, it, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitDataProvider } from './dataProvider.js';

describe('createDigitDataProvider', () => {
  let client: DigitApiClient;

  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'pg' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
  });

  it('returns a DataProvider with all 9 methods', () => {
    const dp = createDigitDataProvider(client, 'pg');
    assert.ok(dp.getList);
    assert.ok(dp.getOne);
    assert.ok(dp.getMany);
    assert.ok(dp.getManyReference);
    assert.ok(dp.create);
    assert.ok(dp.update);
    assert.ok(dp.updateMany);
    assert.ok(dp.delete);
    assert.ok(dp.deleteMany);
  });

  it('throws for unknown resource in getList', async () => {
    const dp = createDigitDataProvider(client, 'pg');
    await assert.rejects(
      () => dp.getList('nonexistent', { pagination: { page: 1, perPage: 10 }, sort: { field: 'id', order: 'ASC' }, filter: {} }),
      /Unknown resource/,
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/providers/dataProvider.test.ts`
Expected: FAIL

**Step 3: Create dataProvider.ts**

Create `/root/DIGIT-MCP/packages/data-provider/src/providers/dataProvider.ts`.

This is a refactored version of the UI's `digitDataProvider.ts`, but takes `DigitApiClient` as a parameter instead of importing a global singleton:

```typescript
import type { DataProvider, RaRecord, GetListResult, GetOneResult, GetManyResult, GetManyReferenceResult, CreateResult, UpdateResult, DeleteResult } from 'ra-core';
import type { DigitApiClient } from '../client/DigitApiClient.js';
import type { MdmsRecord } from '../client/types.js';
import { getResourceConfig, type ResourceConfig } from './resourceRegistry.js';

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
  const employees = await client.employeeSearch(tenantId, { limit: 500 });
  return employees.map((e) => normalizeRecord(e, config));
}

async function boundaryGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const trees = await client.boundaryRelationshipSearch(tenantId, 'ADMIN');
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

// --- Factory ---

export function createDigitDataProvider(client: DigitApiClient, tenantId: string): DataProvider {

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
      default: throw new Error(`Unsupported resource type: ${config.type}`);
    }
  }

  return {
    async getList(resource, params): Promise<GetListResult> {
      const { page, perPage } = params.pagination;
      const { field, order } = params.sort;
      const all = await fetchAll(resource, params.filter);
      const filtered = clientFilter(all, params.filter);
      const sorted = clientSort(filtered, field, order);
      const data = clientPaginate(sorted, page, perPage);
      return { data, total: filtered.length };
    },

    async getOne(resource, params): Promise<GetOneResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        const records = await client.mdmsSearch(tenantId, config.schema!, { uniqueIdentifiers: [String(params.id)] });
        const active = records.filter((r) => r.isActive);
        if (!active.length) throw new Error(`Record not found: ${params.id}`);
        return { data: normalizeMdmsRecord(active[0], config) };
      }
      if (config.type === 'hrms') {
        const employees = await client.employeeSearch(tenantId, { codes: [String(params.id)] });
        if (!employees.length) throw new Error(`Employee not found: ${params.id}`);
        return { data: normalizeRecord(employees[0], config) };
      }
      if (config.type === 'pgr') {
        const wrappers = await client.pgrSearch(tenantId, { serviceRequestId: String(params.id) });
        if (!wrappers.length) throw new Error(`Complaint not found: ${params.id}`);
        const service = (wrappers[0].service || wrappers[0]) as Record<string, unknown>;
        return { data: normalizeRecord(service, config) };
      }
      // Fallback: fetch all, find by id
      const all = await fetchAll(resource);
      const found = all.find((r) => String(r.id) === String(params.id));
      if (!found) throw new Error(`Record not found: ${params.id}`);
      return { data: found };
    },

    async getMany(resource, params): Promise<GetManyResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        const records = await client.mdmsSearch(tenantId, config.schema!, {
          uniqueIdentifiers: params.ids.map(String),
        });
        return { data: records.filter((r) => r.isActive).map((r) => normalizeMdmsRecord(r, config)) };
      }
      // Fallback: fetch all, filter by ids
      const all = await fetchAll(resource);
      const ids = new Set(params.ids.map(String));
      return { data: all.filter((r) => ids.has(String(r.id))) };
    },

    async getManyReference(resource, params): Promise<GetManyReferenceResult> {
      const all = await fetchAll(resource);
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
      throw new Error(`Create not supported for resource type: ${config.type}`);
    },

    async update(resource, params): Promise<UpdateResult> {
      const config = resolveConfig(resource);
      if (config.type === 'mdms') {
        // Fetch the raw MDMS record, update its data, re-submit
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
      throw new Error(`Update not supported for resource type: ${config.type}`);
    },

    async updateMany(resource, params): Promise<{ data: (string | number)[] }> {
      const results: (string | number)[] = [];
      for (const id of params.ids) {
        await (this as DataProvider).update(resource, { id, data: params.data, previousData: {} as RaRecord });
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
      throw new Error(`Delete not supported for resource type: ${config.type}`);
    },

    async deleteMany(resource, params): Promise<{ data: (string | number)[] }> {
      const results: (string | number)[] = [];
      for (const id of params.ids) {
        await (this as DataProvider).delete(resource, { id, previousData: {} as RaRecord });
        results.push(id);
      }
      return { data: results };
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/providers/dataProvider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/data-provider/src/providers/dataProvider.ts packages/data-provider/src/providers/dataProvider.test.ts
git commit -m "feat(data-provider): add react-admin DataProvider factory"
```

---

### Task 6: AuthProvider Implementation

**Files:**
- Create: `packages/data-provider/src/providers/authProvider.ts`
- Test: `packages/data-provider/src/providers/authProvider.test.ts`

**Step 1: Write the failing test**

Create `/root/DIGIT-MCP/packages/data-provider/src/providers/authProvider.test.ts`:

```typescript
import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitAuthProvider } from './authProvider.js';

describe('createDigitAuthProvider', () => {
  let client: DigitApiClient;

  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com' });
  });

  it('checkAuth throws when not authenticated', async () => {
    const auth = createDigitAuthProvider(client);
    await assert.rejects(() => auth.checkAuth({}), /Not authenticated/);
  });

  it('checkAuth resolves when authenticated', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    await auth.checkAuth({});
  });

  it('getIdentity returns user info', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', uuid: 'abc-123', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    const identity = await auth.getIdentity();
    assert.equal(identity.fullName, 'Admin');
    assert.equal(identity.id, 'abc-123');
  });

  it('getPermissions returns role codes', async () => {
    client.setAuth('token', {
      userName: 'admin', name: 'Admin', tenantId: 'pg',
      roles: [{ code: 'SUPERUSER', name: 'Super User' }, { code: 'EMPLOYEE', name: 'Employee' }],
    });
    const auth = createDigitAuthProvider(client);
    const perms = await auth.getPermissions({});
    assert.deepEqual(perms, ['SUPERUSER', 'EMPLOYEE']);
  });

  it('logout clears auth', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    const redirectPath = await auth.logout({});
    assert.equal(client.isAuthenticated(), false);
    assert.equal(redirectPath, '/login');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/providers/authProvider.test.ts`
Expected: FAIL

**Step 3: Create authProvider.ts**

Create `/root/DIGIT-MCP/packages/data-provider/src/providers/authProvider.ts`:

```typescript
import type { AuthProvider } from 'ra-core';
import type { DigitApiClient } from '../client/DigitApiClient.js';

export function createDigitAuthProvider(client: DigitApiClient): AuthProvider {
  return {
    login: async () => {
      // No-op: login handled externally (LoginPage calls client.login() directly)
    },

    checkAuth: async () => {
      if (!client.isAuthenticated()) {
        throw new Error('Not authenticated');
      }
    },

    checkError: async (error: { status?: number }) => {
      if (error?.status === 401 || error?.status === 403) {
        client.clearAuth();
        throw new Error('Authentication error');
      }
    },

    logout: async () => {
      client.clearAuth();
      return '/login';
    },

    getIdentity: async () => {
      const { user } = client.getAuthInfo();
      if (!user) throw new Error('No user identity available');
      return {
        id: user.uuid ?? user.userName,
        fullName: user.name,
      };
    },

    getPermissions: async () => {
      const { user } = client.getAuthInfo();
      if (!user?.roles) return [];
      return user.roles.map((role) => role.code);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/providers/authProvider.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/data-provider/src/providers/authProvider.ts packages/data-provider/src/providers/authProvider.test.ts
git commit -m "feat(data-provider): add react-admin AuthProvider factory"
```

---

### Task 7: Build, Test, and Update Barrel

**Files:**
- Modify: `packages/data-provider/src/index.ts` (ensure all exports)
- Modify: `packages/data-provider/src/client/index.ts`

**Step 1: Verify all tests pass**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/**/*.test.ts`
Expected: All tests PASS

**Step 2: Verify TypeScript compiles**

Run: `cd /root/DIGIT-MCP/packages/data-provider && npx tsc --noEmit`
Expected: No errors

**Step 3: Build the package**

Run: `cd /root/DIGIT-MCP/packages/data-provider && npm run build`
Expected: `dist/` created with `.js` and `.d.ts` files

**Step 4: Commit**

```bash
git add packages/data-provider/
git commit -m "feat(data-provider): complete package build with all exports"
```

---

### Task 8: Wire MCP Server to Package

**Files:**
- Modify: `DIGIT-MCP/package.json` (add workspace dependency)
- Modify: `DIGIT-MCP/src/services/digit-api.ts` (re-export from package)
- Modify: `DIGIT-MCP/src/types/index.ts` (re-export shared types)
- Modify: `DIGIT-MCP/src/config/endpoints.ts` (re-export from package)

**Step 1: Add workspace dependency to MCP**

Add to `DIGIT-MCP/package.json` dependencies:
```json
"@digit-mcp/data-provider": "workspace:*"
```

Run: `cd /root/DIGIT-MCP && npm install`

**Step 2: Update digit-api.ts to re-export**

Replace `DIGIT-MCP/src/services/digit-api.ts` with a thin re-export layer:

```typescript
// Re-export from shared package — this preserves the existing singleton API
// while the actual implementation lives in @digit-mcp/data-provider
import { DigitApiClient, ApiClientError } from '@digit-mcp/data-provider';
import { getEnvironment } from '../config/environments.js';

export { ApiClientError };

// Singleton instance (preserves existing MCP behavior)
const env = getEnvironment();
export const digitApi = new DigitApiClient({
  url: env.url,
  stateTenantId: env.stateTenantId,
  endpointOverrides: env.endpointOverrides,
});
```

**Step 3: Update types/index.ts**

Add re-exports at the top of `DIGIT-MCP/src/types/index.ts`:

```typescript
// Re-export shared types from package
export type { RequestInfo, UserInfo, Role, MdmsRecord, ApiError, Environment, ErrorCategory } from '@digit-mcp/data-provider';
export { MDMS_SCHEMAS } from '@digit-mcp/data-provider';

// MCP-specific types below (ToolGroup, ToolMetadata, ValidationResult, etc.)
...
```

**Step 4: Update config/endpoints.ts**

Replace `DIGIT-MCP/src/config/endpoints.ts` with:

```typescript
export { ENDPOINTS, OAUTH_CONFIG } from '@digit-mcp/data-provider';
```

**Step 5: Run MCP tests to verify nothing broke**

Run: `cd /root/DIGIT-MCP && npm test`
Expected: Existing tests still pass

**Step 6: Commit**

```bash
git add src/services/digit-api.ts src/types/index.ts src/config/endpoints.ts package.json
git commit -m "refactor(mcp): re-export from @digit-mcp/data-provider"
```

---

### Task 9: Integration Test with Live API

**Files:**
- Create: `packages/data-provider/src/integration.test.ts`

**Step 1: Write integration test**

This test calls the live DIGIT API via the package to verify it works end-to-end:

```typescript
import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient, createDigitDataProvider } from './index.js';

// Skip if no DIGIT environment available
const DIGIT_URL = process.env.DIGIT_URL || 'https://api.egov.theflywheel.in';
const DIGIT_USER = process.env.DIGIT_USER || 'ADMIN';
const DIGIT_PASS = process.env.DIGIT_PASS || 'eGov@123';
const DIGIT_TENANT = process.env.DIGIT_TENANT || 'pg';

describe('integration: live DIGIT API', () => {
  let client: DigitApiClient;

  before(async () => {
    client = new DigitApiClient({ url: DIGIT_URL });
    await client.login(DIGIT_USER, DIGIT_PASS, DIGIT_TENANT);
  });

  it('client: mdmsSearch returns departments', async () => {
    const records = await client.mdmsSearch(DIGIT_TENANT, 'common-masters.Department', { limit: 5 });
    assert.ok(records.length > 0, 'Should return at least one department');
    assert.ok(records[0].schemaCode, 'Record should have schemaCode');
  });

  it('client: employeeSearch returns employees', async () => {
    const employees = await client.employeeSearch(`${DIGIT_TENANT}.citya`, { limit: 3 });
    assert.ok(employees.length > 0, 'Should return at least one employee');
  });

  it('dataProvider: getList departments', async () => {
    const dp = createDigitDataProvider(client, DIGIT_TENANT);
    const result = await dp.getList('departments', {
      pagination: { page: 1, perPage: 10 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });
    assert.ok(result.data.length > 0, 'Should return departments');
    assert.ok(result.total > 0, 'Should have total count');
    assert.ok(result.data[0].id, 'Each record should have id');
  });

  it('dataProvider: getOne department by code', async () => {
    const dp = createDigitDataProvider(client, DIGIT_TENANT);
    const result = await dp.getOne('departments', { id: 'DEPT_1' });
    assert.equal(result.data.id, 'DEPT_1');
  });

  it('dataProvider: getList employees (HRMS)', async () => {
    const dp = createDigitDataProvider(client, `${DIGIT_TENANT}.citya`);
    const result = await dp.getList('employees', {
      pagination: { page: 1, perPage: 5 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });
    assert.ok(result.data.length > 0, 'Should return employees');
  });
});
```

**Step 2: Run integration test**

Run: `cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/integration.test.ts`
Expected: All tests PASS (requires live DIGIT environment)

**Step 3: Commit**

```bash
git add packages/data-provider/src/integration.test.ts
git commit -m "test(data-provider): add integration tests against live DIGIT API"
```

---

## Summary

| Task | What | Tests |
|------|------|-------|
| 1 | Monorepo workspace scaffold | npm install |
| 2 | Types + endpoints + errors | types.test.ts |
| 3 | DigitApiClient extraction | DigitApiClient.test.ts |
| 4 | Resource registry | resourceRegistry.test.ts |
| 5 | DataProvider factory | dataProvider.test.ts |
| 6 | AuthProvider factory | authProvider.test.ts |
| 7 | Build verification | tsc --noEmit, npm run build |
| 8 | MCP server re-export | existing MCP tests |
| 9 | Integration test | live API verification |

After all tasks: Use `superpowers:finishing-a-development-branch` to decide merge strategy.

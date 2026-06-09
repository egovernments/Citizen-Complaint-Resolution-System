# Shared DIGIT Data Provider — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the API client and react-admin DataProvider/AuthProvider into a shared `packages/data-provider/` package within the MCP monorepo, verified against live DIGIT APIs.

**Architecture:** Isomorphic TypeScript package exporting `DigitApiClient` (refactored from MCP's `digit-api.ts`), a react-admin `DataProvider` covering all 15 DIGIT services, and a react-admin `AuthProvider`. MCP and UI both import from this package.

**Tech Stack:** TypeScript, ra-core (headless react-admin), fetch API, npm workspaces

---

## 1. Verified Service Capabilities

All operations verified via live API calls against `https://api.egov.theflywheel.in` (tenants: `pg`, `pg.citest`).

### 1.1 MDMS (Master Data Management)

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` | `POST /mdms-v2/v2/_search` | Yes | MdmsCriteria in body: `{tenantId, schemaCode, limit, offset}` |
| `getOne` | `POST /mdms-v2/v2/_search` | Yes | Filter via `uniqueIdentifiers: [id]` |
| `getMany` | `POST /mdms-v2/v2/_search` | Yes | Filter via `uniqueIdentifiers: [id1, id2, ...]` |
| `getManyReference` | `POST /mdms-v2/v2/_search` | Yes | Filter by schemaCode (parent reference) |
| `create` | `POST /mdms-v2/v2/_create/{schemaCode}` | Yes | Body: `{Mdms: {tenantId, schemaCode, uniqueIdentifier, data}}` |
| `update` | `POST /mdms-v2/v2/_update` | Inferred | Fetch record, modify `data` field, re-submit with same id |
| `delete` | `POST /mdms-v2/v2/_update` | Inferred | Soft-delete: set `isActive: false` |

**ID field:** `uniqueIdentifier`
**Pagination:** `limit` / `offset` in MdmsCriteria (server default 100)
**Sorting:** Not supported server-side; client-side sort
**Filtering:** `uniqueIdentifiers[]` array, `isActive` filter

### 1.2 HRMS (Employees)

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` | `POST /egov-hrms/employees/_search?tenantId=X&limit=N&offset=N` | Yes | **Query params, NOT body**. Returns `{Employees: [...]}` |
| `getOne` | `POST /egov-hrms/employees/_search?tenantId=X&codes=ID` | Yes | Filter by employee code via query param |
| `getMany` | `POST /egov-hrms/employees/_search?tenantId=X&codes=A,B,C` | Inferred | Comma-separated codes |
| `create` | `POST /egov-hrms/employees/_create` | Yes | Body: `{Employees: [{...}]}` |
| `update` | `POST /egov-hrms/employees/_update` | Yes | Full object replace (fetch → modify → submit) |
| `delete` | `POST /egov-hrms/employees/_update` | Yes | Deactivate: set `isActive: false, deactivationDetails` |

**ID field:** `code` (e.g., `EMP-CITEST-000284`)
**Critical:** Search uses URL query parameters, not POST body criteria. This is a common mistake.
**Pagination:** `limit` / `offset` as URL params

### 1.3 Boundary

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` (hierarchy) | `POST /boundary-service/boundary-hierarchy-definition/_search` | Yes | Returns hierarchy type definitions |
| `getList` (entities) | `POST /boundary-service/boundary-relationships/_search` | Yes | Returns boundary tree |
| `getOne` | `POST /boundary-service/boundary/_search` | Yes | Filter by codes |
| `create` | `POST /boundary-service/boundary/_create` | Yes | Plus `boundary-relationships/_create` for parent-child |
| `update` | N/A | — | No update endpoint |
| `delete` | N/A | — | No delete endpoint |

**ID field:** `code` (boundary code)
**Note:** Boundary is mostly read-only after initial setup. The `boundary-relationships/_search` returns hierarchical tree data.

### 1.4 PGR (Complaints)

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` | `POST /pgr-services/v2/request/_search` | Yes | Filter by `tenantId`, `status`, `serviceRequestId` |
| `getOne` | `POST /pgr-services/v2/request/_search` | Yes | Filter by `serviceRequestId` |
| `create` | `POST /pgr-services/v2/request/_create` | Yes | Body: `{service: {...}, workflow: {action: "APPLY"}}` |
| `update` | `POST /pgr-services/v2/request/_update` | Yes* | Workflow action: ASSIGN, RESOLVE, REJECT, REOPEN, RATE |
| `delete` | N/A | — | No delete; lifecycle via workflow |

**ID field:** `serviceRequestId` (e.g., `PG-PGR-2026-03-06-013765`)
**Note:** Update is workflow-driven, not field-level. Each update includes an `action` and optional `assignees`, `comment`, `rating`.
**Known issue:** Server returns "tracer handler" error intermittently — the operation actually succeeds (confirmed via trace debug).

### 1.5 Localization

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` | `POST /localization/messages/v1/_search` | Yes | Filter by `locale`, `module`, `tenantId`. Returns 13k+ messages |
| `getOne` | Client-side | — | Filter from getList by `code` |
| `create` | `POST /localization/messages/v1/_upsert` | Yes | Upsert semantics (creates or updates) |
| `update` | `POST /localization/messages/v1/_upsert` | Yes | Same endpoint, upsert |
| `delete` | N/A | — | No delete endpoint |

**ID field:** `code` (localization key)
**Note:** Single upsert endpoint for both create and update. Batch support: multiple messages in one call.

### 1.6 Workflow

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` (definitions) | `POST /egov-workflow-v2/egov-wf/businessservice/_search` | Yes | Filter by `businessServices[]` |
| `getList` (instances) | `POST /egov-workflow-v2/egov-wf/process/_search` | Yes | Filter by `businessIds[]` for audit trail |
| `getOne` | Same as above | Yes | Single businessService or businessId filter |
| `create` | `POST /egov-workflow-v2/egov-wf/businessservice/_create` | Yes | State machine definition with states/actions/roles |
| `update` | N/A | — | No update for definitions |
| `delete` | N/A | — | No delete for definitions |

**ID field:** `businessService` (e.g., `PGR`)
**Sub-resources:** Business service definitions (state machines) and process instances (audit trail). Two different list endpoints.

### 1.7 Users

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` | `POST /user/_search` | Yes | Filter by `userName`, `mobileNumber`, `uuid[]`, `roleCodes[]` |
| `getOne` | `POST /user/_search` | Yes | Filter by `userName` or `uuid` |
| `create` | `POST /user/users/_createnovalidate` | Yes | Admin endpoint, no OTP |
| `update` | `POST /user/users/_updatenovalidate` | Inferred | Admin endpoint, full object replace |
| `delete` | N/A | — | Deactivate via update (`active: false`) |

**ID field:** `uuid` (primary), `userName` (secondary), `id` (numeric, legacy)
**Note:** `user_type` filter does NOT work reliably (server error). Filter by role or username instead.

### 1.8 Access Control (Roles)

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` (roles) | `POST /access/v1/roles/_search` | Yes | Returns all defined roles (22 in test env) |
| `getList` (actions) | `POST /access/v1/actions/_search` | No* | Requires ACCESSCONTROL-ACTIONS MDMS data |

**ID field:** `code` (role code)
**Note:** Read-only service. No create/update/delete. Actions search depends on MDMS seed data.

### 1.9 ID Generation

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `create` (generate) | `POST /egov-idgen/id/_generate` | Yes | Returns formatted IDs based on configured patterns |

**ID field:** N/A (generates IDs, doesn't store records)
**Note:** Utility service, not a CRUD resource. Maps to a custom action rather than standard DataProvider methods.

### 1.10 Filestore

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `create` (upload) | `POST /filestore/v1/files` | Inferred | Multipart form upload |
| `getOne` (download URL) | `GET /filestore/v1/files/url?fileStoreIds=X&tenantId=Y` | Inferred | Returns signed download URLs |

**ID field:** `fileStoreId`
**Note:** Utility service. Upload returns fileStoreId; download returns signed URL. Not a standard CRUD resource.

### 1.11 Encryption

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `create` (encrypt) | `POST /egov-enc-service/crypto/v1/_encrypt` | Yes | No auth required |
| `getOne` (decrypt) | `POST /egov-enc-service/crypto/v1/_decrypt` | Yes | No auth required |

**ID field:** N/A (stateless transform)
**Note:** Utility service. Encrypt/decrypt are stateless transformations, not CRUD.

### 1.12 Location (Legacy)

**Not deployed** in test environment. Fully replaced by Boundary service (1.3).
Endpoint: `POST /egov-location/location/v11/boundarys/_search`
**Recommendation:** Skip from DataProvider; use Boundary service instead.

### 1.13 MDMS Schema

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` | `POST /mdms-v2/schema/v1/_search` | Yes | Filter by `codes[]`, `tenantId` |
| `getOne` | Same with `codes: [code]` | Yes | Single schema lookup |
| `create` | `POST /mdms-v2/schema/v1/_create` | Inferred | Register schema definition |
| `update` | N/A | — | No update endpoint |
| `delete` | N/A | — | No delete endpoint |

**ID field:** `code` (schema code, e.g., `common-masters.Department`)

### 1.14 Inbox

| DataProvider Method | DIGIT Endpoint | Verified | Notes |
|---|---|---|---|
| `getList` | `POST /inbox/v2/_search` | Not tested | Aggregates workflow items with ES-backed search |

**Note:** Inbox is a composite view service, not a primary data service. It aggregates PGR complaints filtered by workflow state.

### 1.15 Boundary Management (Bulk)

Specialized file-upload workflow: process → search → generate → download.
Not suitable for standard DataProvider CRUD mapping.

---

## 2. Package Structure

```
DIGIT-MCP/
├── packages/
│   └── data-provider/
│       ├── package.json          # name: @digit-mcp/data-provider
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts          # Public API barrel
│           ├── client/
│           │   ├── DigitApiClient.ts   # Refactored from digit-api.ts
│           │   ├── endpoints.ts        # From config/endpoints.ts
│           │   ├── types.ts            # Shared types
│           │   └── errors.ts           # Error classes
│           ├── providers/
│           │   ├── dataProvider.ts      # react-admin DataProvider
│           │   ├── authProvider.ts      # react-admin AuthProvider
│           │   └── resourceRegistry.ts  # Resource → DIGIT service mapping
│           └── services/               # Per-service adapters
│               ├── mdms.ts
│               ├── hrms.ts
│               ├── boundary.ts
│               ├── pgr.ts
│               ├── localization.ts
│               ├── workflow.ts
│               ├── users.ts
│               ├── accessControl.ts
│               ├── idgen.ts
│               ├── filestore.ts
│               ├── encryption.ts
│               └── mdmsSchema.ts
├── src/                          # MCP server (existing)
│   └── services/
│       └── digit-api.ts          # → Thin re-export from package
├── package.json                  # Workspace root
└── tsconfig.json
```

## 3. DataProvider Method Routing

The DataProvider routes each call based on the resource name:

```typescript
// Resource registry maps resource names to service adapters
const RESOURCE_MAP = {
  // MDMS-backed resources (most master data)
  'departments':       { service: 'mdms', schema: 'common-masters.Department', idField: 'code' },
  'designations':      { service: 'mdms', schema: 'common-masters.Designation', idField: 'code' },
  'complaint-types':   { service: 'mdms', schema: 'RAINMAKER-PGR.ServiceDefs', idField: 'serviceCode' },
  'tenants':           { service: 'mdms', schema: 'tenant.tenants', idField: 'code' },
  'gender-types':      { service: 'mdms', schema: 'common-masters.GenderType', idField: 'code' },
  // ... 20+ more MDMS schemas

  // Dedicated service resources
  'employees':         { service: 'hrms', idField: 'code' },
  'boundaries':        { service: 'boundary', idField: 'code' },
  'complaints':        { service: 'pgr', idField: 'serviceRequestId' },
  'localization':      { service: 'localization', idField: 'code' },
  'workflow-defs':     { service: 'workflow', subResource: 'businessServices', idField: 'businessService' },
  'workflow-instances':{ service: 'workflow', subResource: 'processInstances', idField: 'businessId' },
  'users':             { service: 'users', idField: 'uuid' },
  'roles':             { service: 'accessControl', idField: 'code' },
  'mdms-schemas':      { service: 'mdmsSchema', idField: 'code' },
};
```

## 4. Isomorphic Client Design

```typescript
class DigitApiClient {
  // Browser + Node compatible
  private basicAuth(user: string, pass: string): string {
    return typeof btoa === 'function'
      ? btoa(`${user}:${pass}`)        // Browser + Node 22+
      : Buffer.from(`${user}:${pass}`).toString('base64');  // Older Node
  }

  // Uses global fetch (available in Node 18+ and all browsers)
  async request(path: string, body: object): Promise<any> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new DigitApiError(response);
    return response.json();
  }
}
```

## 5. Key Design Decisions

1. **HRMS uses query params, not POST body** — Verified. This is non-obvious and a common bug source.
2. **MDMS delete is soft-delete** — Set `isActive: false` via the update endpoint.
3. **PGR update is workflow-driven** — Not field-level edits. Each update = workflow action.
4. **Localization uses upsert** — Single endpoint for create + update.
5. **User search: avoid `user_type` filter** — Causes server errors. Use `userName`, `mobileNumber`, or `uuid` filters.
6. **Location service is dead** — Use Boundary service instead.
7. **Access Control is read-only** — No CRUD, just role/action lookup.
8. **IDGen, Filestore, Encryption are utility services** — Not standard CRUD resources. Exposed as custom methods on the client, not via DataProvider.

---

## 6. Migration Path

### MCP Server
- `digit-api.ts` becomes a thin re-export: `export { DigitApiClient } from '@digit-mcp/data-provider'`
- All 40+ methods preserved, just moved to the package
- `endpoints.ts` and types move to package

### UI (ccrs-ui-mockup)
- `src/api/client.ts` → replaced by `import { DigitApiClient } from '@digit-mcp/data-provider'`
- `src/providers/digitDataProvider.ts` → replaced by `import { digitDataProvider } from '@digit-mcp/data-provider'`
- `src/providers/digitAuthProvider.ts` → replaced by `import { digitAuthProvider } from '@digit-mcp/data-provider'`
- `src/providers/resourceRegistry.ts` → replaced by package's registry

### Consuming
```typescript
// MCP server
import { DigitApiClient } from '@digit-mcp/data-provider';
const client = new DigitApiClient({ baseUrl: env.url });

// React app
import { digitDataProvider, digitAuthProvider } from '@digit-mcp/data-provider';
<CoreAdminContext dataProvider={digitDataProvider} authProvider={digitAuthProvider}>
```

# Building a PGR (Complaint Management) UI with DIGIT APIs

> One-shot guide: everything needed to build an end-to-end working complaint management UI against the DIGIT platform.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication](#authentication)
3. [Tenant & Environment Setup](#tenant--environment-setup)
3.5. [DIGIT API SDK](#digit-api-sdk)
4. [API Reference (PGR)](#api-reference-pgr)
5. [API Reference (Supporting Services)](#api-reference-supporting-services)
6. [Data Models](#data-models)
7. [User Flows](#user-flows)
8. [Screen-by-Screen UI Patterns](#screen-by-screen-ui-patterns)
9. [DIGIT UI Component Library](#digit-ui-component-library)
10. [Localization](#localization)
11. [File Uploads](#file-uploads)
12. [Error Handling](#error-handling)
13. [Complete Code Examples](#complete-code-examples)
13.5. [Integration Testing](#integration-testing)
14. [UI Review Checklist](#ui-review-checklist)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (React / Next.js / any SPA)                    │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │
│  │ Citizen UI │  │ Employee UI│  │ Admin / Dashboard  │ │
│  │ - File     │  │ - Inbox    │  │ - Analytics        │ │
│  │ - Track    │  │ - Assign   │  │ - Config           │ │
│  │ - Rate     │  │ - Resolve  │  │ - Employee Mgmt    │ │
│  └─────┬──────┘  └─────┬──────┘  └────────┬───────────┘ │
│        └───────────┬────┘                  │             │
│                    ▼                       │             │
│           Request Wrapper (adds RequestInfo + auth)      │
└─────────────────────┬────────────────────────────────────┘
                      │ HTTPS
                      ▼
┌──────────────────────────────────────────────────────────┐
│  DIGIT Platform (API Gateway)                            │
│                                                          │
│  /user/oauth/token         → Auth Service                │
│  /pgr-services/v2/request  → PGR Service                 │
│  /egov-workflow-v2/        → Workflow Service             │
│  /mdms-v2/                 → Master Data Service         │
│  /filestore/v1/            → File Storage                │
│  /localization/            → Localization Service        │
│  /egov-hrms/               → Employee (HRMS) Service     │
│  /boundary-service/        → Boundary Service            │
└──────────────────────────────────────────────────────────┘
```

### Key Concepts

- **Multi-tenant**: Every API call requires a `tenantId`. City-level (e.g. `pg.citya`) for operational data, state-root (e.g. `pg`) for master data.
- **RequestInfo**: Every POST body must include a `RequestInfo` object with auth token and user info.
- **Workflow-driven**: Complaints move through states via explicit workflow actions (ASSIGN, RESOLVE, etc.).
- **MDMS-driven**: Complaint types, departments, designations are all master data — fetched at runtime, not hardcoded.
- **Localization-first**: All UI labels are localization keys resolved at runtime.

---

## Authentication

### Login (Get Access Token)

```
POST /user/oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=
```

| Parameter    | Value                              |
|--------------|------------------------------------|
| `username`   | Mobile number (citizen) or employee code |
| `password`   | User password (default: `eGov@123`) |
| `userType`   | `CITIZEN` or `EMPLOYEE`            |
| `tenantId`   | City tenant (e.g. `pg.citya`)      |
| `grant_type` | `password`                         |
| `scope`      | `read`                             |

**Response:**
```json
{
  "access_token": "8b3f3e2a-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "token_type": "bearer",
  "expires_in": 3600,
  "scope": "read",
  "UserRequest": {
    "id": 123,
    "uuid": "c0ae57c8-...",
    "userName": "9876543210",
    "name": "Citizen Name",
    "mobileNumber": "9876543210",
    "type": "CITIZEN",
    "tenantId": "pg.citya",
    "roles": [
      { "code": "CITIZEN", "name": "Citizen", "tenantId": "pg.citya" }
    ]
  }
}
```

**Basic auth header**: Base64 of `egov-user-client:` (colon, no secret) = `ZWdvdi11c2VyLWNsaWVudDo=`

### Session Management

Store in session/local storage:
- `access_token` — for API calls
- `UserRequest` — for user info, roles, tenant context
- `userType` — `citizen` or `employee` (controls UI routing)

### RequestInfo Object

Every API call (except auth) must include this in the POST body:

```json
{
  "RequestInfo": {
    "apiId": "Rainmaker",
    "ver": "1.0",
    "ts": 1709000000000,
    "action": "",
    "did": "",
    "key": "",
    "msgId": "1709000000000|en_IN",
    "authToken": "<access_token>",
    "userInfo": {
      "id": 123,
      "uuid": "c0ae57c8-...",
      "userName": "9876543210",
      "name": "Citizen Name",
      "type": "CITIZEN",
      "tenantId": "pg.citya",
      "roles": [{ "code": "CITIZEN", "name": "Citizen", "tenantId": "pg.citya" }]
    }
  }
}
```

**Fields:**
- `msgId`: `"<timestamp>|<locale>"` — used for request tracing and localization context
- `authToken`: Bearer token from login
- `userInfo`: Full user object from login response (include for write operations)

---

## Tenant & Environment Setup

Before the UI can work, the tenant must have:

1. **Tenant record** in MDMS (`tenant.tenants` schema)
2. **Boundary hierarchy** (Country > State > District > City > Ward > Locality)
3. **Complaint types** (MDMS `RAINMAKER-PGR.ServiceDefs`)
4. **Departments** (MDMS `common-masters.Department`)
5. **Workflow definition** (PGR business service)
6. **At least one employee** with GRO + PGR_LME roles

Use the MCP tools `tenant_bootstrap` + `city_setup` to automate all of this, or see [DIGIT docs on tenant setup](https://docs.digit.org/platform/platform/core-services/mdms-v2-master-data-management-service).

### Fetching Tenant Config at App Startup

```
POST /mdms-v2/v2/_search
{
  "RequestInfo": { ... },
  "MdmsCriteria": {
    "tenantId": "pg",
    "schemaCode": "tenant.tenants",
    "limit": 100
  }
}
```

This returns all cities under the state root. Use this to populate city selectors.

---

## DIGIT API SDK

### The Problem

Hand-writing fetch calls to DIGIT APIs leads to silent contract bugs that only surface at runtime. Two real examples from CMS-UI v2:

**Bug 1 — HRMS employee search returns 400:**
The hand-written `api.ts` called `/egov-hrms/employees/_search?tenantId=pg.citya&limit=100` but omitted the `offset` query parameter. The OpenAPI spec marks `offset` as required (with `default: 0`). The API returned a 400 error that was only caught during live testing.

**Bug 2 — PGR assign returns 400:**
The hand-written workflow update sent `assignes: ["employee-uuid"]` (an array of strings), but the DIGIT API expects `assignes: [{ uuid: "employee-uuid" }]` (an array of objects). This only failed when a GRO tried to assign a real complaint.

Both bugs share the same root cause: `api.ts` was hand-written by guessing API shapes instead of using a typed client generated from the actual API spec.

### Three-Layer Solution

```
Layer 1: DIGIT SDK (generated from OpenAPI spec → compile-time safety)
         ↓ catches: missing params, wrong types, incorrect shapes
Layer 2: Integration tests (real API calls → catches spec inaccuracies)
         ↓ catches: spec doesn't match actual API behavior
Layer 3: Spec feedback loop (test failures → fix spec → re-generate SDK)
         ↓ keeps: spec, SDK, and API in sync over time
```

### SDK Generation Workflow

#### Step 1 — Export the OpenAPI spec

Use the MCP server's `api_catalog` tool to get the full OpenAPI 3.0 spec:

```typescript
// Via MCP tool call:
api_catalog(format = "openapi")
// Returns a complete OpenAPI 3.0 JSON spec covering 14 services, 37 endpoints
```

Save the output as `digit-api.json` in the project root.

#### Step 2 — Generate TypeScript types

```bash
npx openapi-typescript digit-api.json -o src/lib/digit-api.d.ts
```

This produces type definitions for every request body, response body, query parameter, and path parameter across all DIGIT services.

#### Step 3 — Create a typed client with DIGIT RequestInfo adapter

DIGIT uses a POST-for-everything pattern where every request body must include a `RequestInfo` wrapper object. Standard OpenAPI clients don't handle this natively, so we need a thin adapter:

```typescript
// src/lib/digit-client.ts
import createClient from 'openapi-fetch';
import type { paths } from './digit-api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '/digit-api';

// Build the RequestInfo object that DIGIT requires in every POST body
function buildRequestInfo(authToken?: string, userInfo?: any) {
  const locale = typeof window !== 'undefined'
    ? localStorage.getItem('locale') || 'en_IN'
    : 'en_IN';

  return {
    apiId: 'Rainmaker',
    ver: '1.0',
    ts: Date.now(),
    action: '',
    did: '',
    key: '',
    msgId: `${Date.now()}|${locale}`,
    ...(authToken ? { authToken } : {}),
    ...(userInfo ? { userInfo } : {}),
  };
}

// Create the base openapi-fetch client
const baseClient = createClient<paths>({ baseUrl: API_BASE });

// Wrap every call to inject RequestInfo into the body
export function digitRequest<T>(
  url: string,
  options: {
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    auth?: boolean;
  } = {}
): Promise<T> {
  const { params, body = {}, auth = true } = options;
  const session = getSession(); // your auth session helper

  return baseClient.POST(url as any, {
    params: { query: params },
    body: {
      RequestInfo: buildRequestInfo(
        auth ? session?.access_token : undefined,
        auth ? session?.userInfo : undefined
      ),
      ...body,
    } as any,
  }).then(({ data, error }) => {
    if (error) throw new Error(JSON.stringify(error));
    return data as T;
  });
}
```

#### Step 4 — Use everywhere

**Before (hand-written, bug-prone):**
```typescript
// Missing offset param — 400 error at runtime
const res = await fetch(`/digit-api/egov-hrms/employees/_search?tenantId=${tid}&limit=100`, {
  method: 'POST',
  body: JSON.stringify({ RequestInfo: buildRequestInfo() }),
});
```

**After (SDK, compile-time safe):**
```typescript
// TypeScript error if offset is missing and required in the spec
const res = await digitRequest('/egov-hrms/employees/_search', {
  params: { tenantId: tid, limit: '100', offset: '0' },
});
```

#### Install dependencies

```bash
npm install openapi-fetch                    # runtime — typed fetch client
npm install -D openapi-typescript            # dev — type generation from spec
```

### DIGIT RequestInfo Adapter Pattern

DIGIT's POST-for-everything pattern doesn't map cleanly to standard REST OpenAPI clients. The adapter above handles this by:

1. Intercepting every request before it's sent
2. Injecting the `RequestInfo` object (auth token, user info, locale, timestamp) into the POST body
3. Preserving the typed parameters and response types from the generated spec

This means your application code gets full type safety (autocomplete on parameter names, type errors on wrong shapes) while the adapter handles DIGIT's non-standard request format.

### When to Re-Generate

- After updating the MCP server's `api-catalog.ts` (e.g. fixing the `assignes` type)
- When integration tests reveal a spec inaccuracy — fix the spec first, then re-generate
- When the DIGIT platform adds new endpoints or changes existing ones

---

## API Reference (PGR)

### Create Complaint

```
POST /pgr-services/v2/request/_create?tenantId=pg.citya
```

```json
{
  "RequestInfo": { "..." },
  "service": {
    "tenantId": "pg.citya",
    "serviceCode": "StreetLightNotWorking",
    "description": "The street light near main road is not working for 3 days",
    "accountId": "<citizen_uuid>",
    "address": {
      "city": "City A",
      "locality": {
        "code": "SUN04"
      }
    },
    "citizen": {
      "name": "Ramesh Kumar",
      "mobileNumber": "9876543210"
    },
    "source": "web"
  },
  "workflow": {
    "action": "APPLY"
  }
}
```

**Response:**
```json
{
  "ServiceWrappers": [{
    "service": {
      "serviceRequestId": "PG-PGR-2026-01-15-000001",
      "tenantId": "pg.citya",
      "serviceCode": "StreetLightNotWorking",
      "description": "...",
      "accountId": "citizen-uuid",
      "applicationStatus": "PENDINGFORASSIGNMENT",
      "address": { "..." },
      "citizen": { "..." },
      "auditDetails": {
        "createdBy": "citizen-uuid",
        "createdTime": 1709000000000,
        "lastModifiedBy": "citizen-uuid",
        "lastModifiedTime": 1709000000000
      }
    },
    "workflow": {
      "action": "APPLY",
      "businessId": "PG-PGR-2026-01-15-000001",
      "state": { "state": "CREATED", "applicationStatus": "PENDINGFORASSIGNMENT" }
    }
  }]
}
```

### Search Complaints

```
POST /pgr-services/v2/request/_search?tenantId=pg.citya
```

**Query parameters:**
| Param | Description |
|-------|-------------|
| `tenantId` | Required. City-level tenant ID |
| `serviceRequestId` | Filter by specific complaint ID |
| `applicationStatus` | Filter: `PENDINGFORASSIGNMENT`, `PENDINGATLME`, `PENDINGFORREASSIGNMENT`, `RESOLVED`, `REJECTED`, `CLOSEDAFTERRESOLUTION` |
| `limit` | Max results (default: 50) |
| `offset` | Pagination offset |

**Body:** `{ "RequestInfo": { ... } }`

**Response:** `{ "ServiceWrappers": [{ "service": {...}, "workflow": {...} }] }`

### Update Complaint (Workflow Actions)

```
POST /pgr-services/v2/request/_update?tenantId=pg.citya
```

```json
{
  "RequestInfo": { "..." },
  "service": { "... (full service object from search)" },
  "workflow": {
    "action": "ASSIGN",
    "assignes": ["employee-uuid"],
    "comments": "Assigning to field team",
    "verificationDocuments": []
  }
}
```

**Available actions by status:**

| Current Status | Action | Role Required | Next Status |
|---------------|--------|---------------|-------------|
| `PENDINGFORASSIGNMENT` | `ASSIGN` | GRO | `PENDINGATLME` |
| `PENDINGFORASSIGNMENT` | `REJECT` | GRO | `REJECTED` |
| `PENDINGATLME` | `RESOLVE` | PGR_LME | `RESOLVED` |
| `PENDINGATLME` | `REASSIGN` | GRO | `PENDINGFORREASSIGNMENT` |
| `PENDINGFORREASSIGNMENT` | `ASSIGN` | GRO | `PENDINGATLME` |
| `RESOLVED` | `REOPEN` | CITIZEN | `PENDINGFORASSIGNMENT` |
| `RESOLVED` | `RATE` | CITIZEN | `CLOSEDAFTERRESOLUTION` |

**RATE action** (citizen closes with rating):
```json
{
  "workflow": {
    "action": "RATE",
    "rating": 4,
    "comments": "Issue resolved satisfactorily"
  }
}
```

### Count Complaints

```
POST /pgr-services/v2/request/_count?tenantId=pg.citya
```

Body: `{ "RequestInfo": { ... } }` with optional filter params.

Returns: `{ "count": 42 }`

---

## API Reference (Supporting Services)

### MDMS — Fetch Complaint Types

```
POST /mdms-v2/v2/_search
{
  "RequestInfo": { ... },
  "MdmsCriteria": {
    "tenantId": "pg",
    "schemaCode": "RAINMAKER-PGR.ServiceDefs",
    "limit": 100
  }
}
```

**Response records:**
```json
{
  "serviceCode": "StreetLightNotWorking",
  "serviceName": "Street Light Not Working",
  "department": "DEPT_25",
  "slaHours": 336,
  "menuPath": "StreetLights",
  "order": 1,
  "active": true
}
```

Use `serviceCode` as the key for creating complaints. Group by `menuPath` for hierarchical type selection UI.

### MDMS — Fetch Departments

```
POST /mdms-v2/v2/_search
{
  "RequestInfo": { ... },
  "MdmsCriteria": {
    "tenantId": "pg",
    "schemaCode": "common-masters.Department",
    "limit": 100
  }
}
```

### Boundary — Fetch Localities

```
POST /boundary-service/boundary-relationships/_search
{
  "RequestInfo": { ... },
  "BoundaryRelationship": {
    "tenantId": "pg.citya",
    "hierarchyType": "ADMIN",
    "boundaryType": "Locality"
  }
}
```

Returns locality codes needed for the complaint address. Display as dropdown for the user.

### Workflow — Get Audit Trail

```
POST /egov-workflow-v2/egov-wf/process/_search
{
  "RequestInfo": { ... },
  "criteria": {
    "tenantId": "pg.citya",
    "businessIds": ["PG-PGR-2026-01-15-000001"],
    "limit": 50,
    "offset": 0
  }
}
```

Returns ordered list of workflow transitions. Use this for the complaint timeline.

**Response:**
```json
{
  "ProcessInstances": [{
    "id": "uuid",
    "tenantId": "pg.citya",
    "businessId": "PG-PGR-2026-01-15-000001",
    "businessService": "PGR",
    "action": "ASSIGN",
    "state": {
      "state": "ASSIGNED",
      "applicationStatus": "PENDINGATLME"
    },
    "assigner": { "name": "GRO Officer", "uuid": "..." },
    "assignes": [{ "name": "Field Agent", "uuid": "..." }],
    "comment": "Assigning to field team",
    "auditDetails": { "createdTime": 1709000000000 }
  }]
}
```

### Workflow — Get Business Service Definition

```
POST /egov-workflow-v2/egov-wf/businessservice/_search?tenantId=pg&businessServices=PGR
{
  "RequestInfo": { ... }
}
```

Returns the state machine definition. Use this to determine which actions are available for the current status and user role.

### HRMS — Search Employees

```
POST /egov-hrms/employees/_search?tenantId=pg.citya&limit=100
{
  "RequestInfo": { ... }
}
```

Use for the "assign to" dropdown in the GRO's assignment UI.

### User — Search Users

```
POST /user/_search
{
  "RequestInfo": { ... },
  "tenantId": "pg.citya",
  "uuid": ["employee-uuid-1"]
}
```

Use to resolve employee UUIDs to names for display.

### Filestore — Upload Attachment

```
POST /filestore/v1/files
Content-Type: multipart/form-data

file=<binary>
tenantId=pg.citya
module=rainmaker-pgr
```

**Response:** `{ "files": [{ "fileStoreId": "858452c7-..." }] }`

### Filestore — Get Download URL

```
GET /filestore/v1/files/url?tenantId=pg.citya&fileStoreIds=858452c7-...
```

**Response:** `{ "fileStoreIds": [{ "url": "https://...", "id": "858452c7-..." }] }`

### Localization — Fetch UI Labels

```
POST /localization/messages/v1/_search?tenantId=pg&locale=en_IN&module=rainmaker-pgr
{
  "RequestInfo": { ... }
}
```

**Response:**
```json
{
  "messages": [
    { "code": "SERVICEDEFS.STREETLIGHTNOTWORKING", "message": "Street Light Not Working", "module": "rainmaker-pgr", "locale": "en_IN" },
    { "code": "CS_COMMON_PENDINGFORASSIGNMENT", "message": "Pending for Assignment", "locale": "en_IN" }
  ]
}
```

---

## Data Models

### Complaint (Service)

```typescript
interface Service {
  serviceRequestId: string;        // e.g. "PG-PGR-2026-01-15-000001"
  tenantId: string;                // e.g. "pg.citya"
  serviceCode: string;             // e.g. "StreetLightNotWorking"
  description: string;
  accountId: string;               // citizen UUID
  applicationStatus: ApplicationStatus;
  rating?: number;                 // 1-5, set after RATE
  address: Address;
  citizen: Citizen;
  source: 'web' | 'mobile' | 'whatsapp';
  auditDetails: AuditDetails;
}

type ApplicationStatus =
  | 'PENDINGFORASSIGNMENT'
  | 'PENDINGATLME'
  | 'PENDINGFORREASSIGNMENT'
  | 'RESOLVED'
  | 'REJECTED'
  | 'CLOSEDAFTERRESOLUTION';

interface Address {
  city?: string;
  locality: { code: string; name?: string };
  landmark?: string;
  geoLocation?: { latitude: number; longitude: number };
}

interface Citizen {
  name: string;
  mobileNumber: string;  // 10 digits
  emailId?: string;
}

interface AuditDetails {
  createdBy: string;
  createdTime: number;  // epoch ms
  lastModifiedBy: string;
  lastModifiedTime: number;
}
```

### Workflow Action

```typescript
interface WorkflowAction {
  action: 'APPLY' | 'ASSIGN' | 'REASSIGN' | 'RESOLVE' | 'REJECT' | 'REOPEN' | 'RATE';
  assignes?: string[];          // employee UUIDs (for ASSIGN/REASSIGN)
  comments?: string;
  rating?: number;              // 1-5 (for RATE)
  verificationDocuments?: VerificationDocument[];
}

interface VerificationDocument {
  documentType: string;
  fileStoreId: string;
}
```

### Service Definition (Complaint Type)

```typescript
interface ServiceDef {
  serviceCode: string;         // e.g. "StreetLightNotWorking"
  serviceName: string;         // e.g. "Street Light Not Working"
  department: string;          // e.g. "DEPT_25"
  slaHours: number;            // e.g. 336 (14 days)
  menuPath: string;            // e.g. "StreetLights" — for grouping
  order: number;               // display order
  active: boolean;
}
```

### PGR Roles

| Role | Code | Responsibility |
|------|------|---------------|
| Citizen | `CITIZEN` | File complaints, track status, reopen, rate |
| Grievance Routing Officer | `GRO` | Assign, reassign, reject complaints |
| Last Mile Employee | `PGR_LME` | Resolve assigned complaints |
| Department GRO | `DGRO` | Department-level routing (optional) |
| CSR (Customer Service Rep) | `CSR` | File complaints on behalf of citizens |

---

## User Flows

### Flow 1: Citizen Files a Complaint

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Login / OTP     │────▶│  Select City     │────▶│  Select Type  │
│  (mobile number) │     │  (tenant picker) │     │  (MDMS types) │
└─────────────────┘     └──────────────────┘     └───────┬───────┘
                                                          │
      ┌───────────────────────────────────────────────────┘
      ▼
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Select Locality │────▶│  Enter Details   │────▶│  Upload Photos│
│  (boundary API)  │     │  (description)   │     │  (filestore)  │
└─────────────────┘     └──────────────────┘     └───────┬───────┘
                                                          │
      ┌───────────────────────────────────────────────────┘
      ▼
┌─────────────────┐     ┌──────────────────┐
│  Review & Submit │────▶│  Success Page    │
│  (pgr_create)    │     │  (complaint ID)  │
└─────────────────┘     └──────────────────┘
```

**API sequence:**
1. `POST /user/oauth/token` — login
2. `POST /mdms-v2/v2/_search` (schema: `tenant.tenants`) — get cities
3. `POST /mdms-v2/v2/_search` (schema: `RAINMAKER-PGR.ServiceDefs`) — get types
4. `POST /boundary-service/boundary-relationships/_search` — get localities
5. `POST /filestore/v1/files` — upload photos (if any)
6. `POST /pgr-services/v2/request/_create` — submit complaint

### Flow 2: Citizen Tracks Complaint

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  My Complaints   │────▶│  Complaint Detail│────▶│  Timeline     │
│  (pgr_search     │     │  (full details + │     │  (workflow     │
│   by mobile)     │     │   current status)│     │   process)     │
└─────────────────┘     └──────────────────┘     └───────┬───────┘
                                                          │
                              ┌────────────────────┐      │
                              │  Rate / Reopen     │◀─────┘
                              │  (if RESOLVED)     │
                              └────────────────────┘
```

**API sequence:**
1. `POST /pgr-services/v2/request/_search` with mobile number filter
2. `POST /egov-workflow-v2/egov-wf/process/_search` — get timeline
3. `POST /pgr-services/v2/request/_update` — RATE or REOPEN

### Flow 3: GRO Assigns Complaint

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Inbox           │────▶│  Complaint Detail│────▶│  Assign Modal │
│  (pgr_search     │     │  (full details + │     │  (select      │
│   PENDING*)      │     │   workflow trail) │     │   employee)   │
└─────────────────┘     └──────────────────┘     └───────┬───────┘
                                                          │
                                                          ▼
                                                ┌─────────────────┐
                                                │  Submit          │
                                                │  (pgr_update     │
                                                │   action=ASSIGN) │
                                                └─────────────────┘
```

**API sequence:**
1. `POST /pgr-services/v2/request/_search` (status filter: `PENDINGFORASSIGNMENT`)
2. `POST /egov-hrms/employees/_search` — get assignable employees
3. `POST /pgr-services/v2/request/_update` — ASSIGN with employee UUID

### Flow 4: LME Resolves Complaint

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  My Assignments  │────▶│  Complaint Detail│────▶│  Resolve      │
│  (pgr_search     │     │  (+ timeline)    │     │  (add comment │
│   PENDINGATLME)  │     │                  │     │   + photos)   │
└─────────────────┘     └──────────────────┘     └───────┬───────┘
                                                          │
                                                          ▼
                                                ┌─────────────────┐
                                                │  Submit          │
                                                │  (pgr_update     │
                                                │   action=RESOLVE)│
                                                └─────────────────┘
```

### Complete Workflow State Machine

```
                              ┌─────────────────────────────┐
                              │                             │
    APPLY                     │  REOPEN (citizen)           │
      │                       │                             │
      ▼                       │                             │
┌─────────────────┐    ┌──────┴──────────┐    ┌─────────────────────┐
│ PENDING FOR     │───▶│   RESOLVED      │───▶│ CLOSED AFTER        │
│ ASSIGNMENT      │    │                 │    │ RESOLUTION          │
│ (GRO action)    │    │ (LME resolved)  │    │ (citizen rated)     │
└───┬──────┬──────┘    └─────────────────┘    └─────────────────────┘
    │      │                    ▲
    │      │ REJECT             │ RESOLVE
    │      ▼                    │
    │  ┌──────────┐    ┌────────┴────────┐
    │  │ REJECTED  │    │ PENDING AT LME  │
    │  │ (closed)  │    │ (field work)    │
    │  └──────────┘    └────────┬────────┘
    │                           │
    │ ASSIGN                    │ REASSIGN
    ▼                           ▼
    │              ┌─────────────────────┐
    └─────────────▶│ PENDING FOR         │
                   │ REASSIGNMENT        │──── ASSIGN ────▶ PENDING AT LME
                   └─────────────────────┘
```

---

## Screen-by-Screen UI Patterns

> These patterns describe the expected user experience for each role's screens. They are framework-agnostic — implement them in any frontend stack.

### Citizen: File Complaint (Multi-Step Wizard)

Filing a complaint is a **multi-step wizard** where each step is a separate screen, not a single long form. The user sees one question per screen and navigates forward/back. All entered data persists across steps (e.g. via session storage or in-memory state) so nothing is lost when going back.

**Steps in order:**

1. **Select complaint type** — Show all active complaint types (from MDMS ServiceDefs) as a selectable list or tappable cards. Group them by category if `menuPath` is set.
2. **Select sub-type** — If the chosen type has sub-categories, show a second selection. Otherwise skip.
3. **Enter location** — Pincode or address input. Can auto-resolve to a city/locality.
4. **Select locality** — Dropdown of localities from the boundary service for the resolved city.
5. **Add landmark** — Optional free-text input for a nearby landmark.
6. **Upload photos** — Optional photo upload. Accept images only, max 5 MB per file.
7. **Enter details** — Description textarea, plus citizen name and mobile number.
8. **Review and submit** — Summary of all entered data. A single "Submit" button files the complaint.
9. **Success confirmation** — Show the complaint ID and a link to track the complaint.

**Behaviour:**
- Every step has a fixed bottom bar with a "Next" button (and "Back" on steps 2+).
- The final step's button says "Submit Complaint".
- On mobile the bottom bar is pinned to the viewport bottom.

### Citizen: My Complaints List

A simple scrollable list of the citizen's own complaints. No filters needed — the API already returns only this citizen's data.

```
┌─────────────────────────────────────┐
│  "My Complaints"                     │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Street Light Not Working        │ │
│  │ Complaint No: PG-PGR-2026-001  │ │
│  │ Filed: 15 Jan 2026             │ │
│  │ [Pending Assignment]    Open >  │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ Garbage Needs Clearing          │ │
│  │ Complaint No: PG-PGR-2026-002  │ │
│  │ Filed: 10 Jan 2026             │ │
│  │ [Resolved]              Open >  │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Each card shows:**
- Complaint type name (human-readable)
- Complaint reference number
- Date filed
- Current status as a coloured badge
- Tap anywhere on the card to open the detail page

### Citizen: Complaint Detail

Two sections stacked vertically: a **details table** and a **timeline**.

**Details table** — A two-column key-value layout (label on the left, value on the right), with a horizontal divider between each row:

| Label | Value |
|-------|-------|
| Complaint No. | PG-PGR-2026-001 |
| Complaint Type | Street Light Not Working |
| Status | Pending Assignment |
| Filed Date | 15 Jan 2026 |
| Address | Ward 5, Locality Name |
| Description | The street light near... |

Below the table, show any attached photos as a thumbnail gallery.

**Timeline** — A vertical timeline showing every state change, newest at the top. Each entry has:
- A **dot** connected by a vertical line to the next entry
- The **action name** in plain language (e.g. "Complaint Filed", "Assigned to Field Team", "Resolved")
- **Date and time**
- **Who** performed the action
- **Comments** if any were added at that step
- **Photos** if any were attached at that step

```
  ● Resolved                    15 Jan 2026
  │  By: Field Agent
  │  "Fixed the light"
  │
  ● Assigned to Field Team      14 Jan 2026
  │  By: GRO Officer
  │  Assigned to: Field Agent
  │
  ● Complaint Filed             13 Jan 2026
     Filed via: web
```

**Actions (when status is RESOLVED):**
- A fixed bottom bar with two buttons: "Rate" and "Reopen".
- "Rate" shows a 1–5 star rating input. Submitting it closes the complaint permanently.
- "Reopen" sends the complaint back to the beginning of the workflow.
- After either action, show a brief toast notification confirming success.

### Employee: Inbox (Desktop — 3-Panel Layout)

This is the most complex screen. Desktop uses a **sidebar + search + table** layout:

```
┌─────────────────────┬──────────────────────────────────────────────┐
│  FILTER SIDEBAR     │  SEARCH BAR                                  │
│                     │  ┌────────────────┐ ┌──────────────┐ ┌─────┐│
│  Filter By:         │  │ Complaint No.  │ │ Mobile No.   │ │Srch ││
│  [Clear All]        │  └────────────────┘ └──────────────┘ └─────┘│
│                     │  [Clear Search]                              │
│  ○ Assigned to Me   │                                              │
│  ○ Assigned to All  ├──────────────────────────────────────────────┤
│                     │  DATA TABLE                                  │
│  Complaint Type ▼   │  ┌──────────┬─────────┬────────┬──────┬────┐│
│  [StreetLight ×]    │  │Complaint │Locality │Status  │Owner │SLA ││
│  [Garbage ×]        │  │No        │         │        │      │Days││
│                     │  ├──────────┼─────────┼────────┼──────┼────┤│
│  Locality ▼         │  │PG-PGR-  │Ward 5   │Pending │GRO   │ 12 ││
│  [Ward5 ×]          │  │2026-001 │         │Assign  │Name  │    ││
│                     │  │StreetLt │         │        │      │    ││
│  Status:            │  ├──────────┼─────────┼────────┼──────┼────┤│
│  ☑ Pending Assign   │  │PG-PGR-  │Ward 3   │At LME  │Agent │ -2 ││
│  ☑ Assigned         │  │2026-002 │         │        │Name  │RED ││
│  ☐ Resolved         │  │Garbage  │         │        │      │    ││
│  ☐ Rejected         │  ├──────────┴─────────┴────────┴──────┴────┤│
│  ☐ Closed           │  │  ← Prev  Page 1 of 3  Next →           ││
│                     │  └─────────────────────────────────────────┘│
└─────────────────────┴──────────────────────────────────────────────┘
```

**Filter sidebar** (always visible on desktop):

- **"Assigned to Me" / "Assigned to All"** — Radio toggle. "Assigned to Me" filters complaints where the current user is the workflow assignee. This is essential for field workers (LME) who need to see only their own work.
- **Complaint Type** — A dropdown populated from the master data complaint types. Supports selecting multiple types. Each selected type appears as a dismissible chip/tag below the dropdown.
- **Locality** — Same pattern as complaint type: multi-select dropdown with dismissible chips.
- **Status** — Checkboxes, one for each complaint status (Pending Assignment, Assigned, Resolved, Rejected, Closed).
- **"Clear All"** button — Resets every filter to its default.
- Filters apply instantly as the user changes them (no separate "Apply" button).

**Search bar** (above the table):

- **Two separate input fields** side by side: one for Complaint Number, one for Mobile Number.
- A **"Search" button** next to them to execute the search.
- A **"Clear Search"** link to reset both fields and return to the filtered view.
- Mobile number validation: 10 digits, starts with 6–9.

**Data table columns:**

| Column | What it shows |
|--------|---------------|
| Complaint No. | The complaint reference ID, displayed as a link to the detail page. The complaint type name appears below it in smaller text. |
| Locality | The locality name where the complaint was filed. |
| Current Status | Human-readable status (e.g. "Pending Assignment", not the raw code). |
| Current Owner | Name of the person currently responsible (from the workflow assignee data). |
| SLA Days Remaining | Number of days left before the SLA deadline. Positive numbers in green, negative (overdue) in red. |

**SLA calculation:**
- Get `slaHours` from the complaint type's master data definition.
- Deadline = complaint created time + (slaHours converted to milliseconds).
- Days remaining = ceiling of (deadline − now) in days.
- Positive = on time (show in green). Negative = overdue (show in red).

**Pagination:**
- "Previous" and "Next" buttons.
- Page size selector (e.g. 10, 25, 50 per page).
- Display total count: "Showing 1–10 of 47".
- Backed by `offset` and `limit` query parameters on the PGR search API.

### Employee: Inbox (Mobile — Card Layout)

On mobile (screen width below 768px), the inbox renders as a completely different layout — not a responsive version of the desktop table, but a purpose-built mobile experience.

```
┌─────────────────────────────────────┐
│  [Search] [Filter] [Sort]  action bar│
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐ │
│  │ Complaint No.  │ PG-PGR-2026.. │ │
│  │ Type           │ Street Light  │ │
│  │ Locality       │ Ward 5        │ │
│  │ Status         │ Pending       │ │
│  │ Owner          │ GRO Name      │ │
│  │ SLA            │ 12 days       │ │
│  └─────────────────────────────────┘ │
│  ┌─────────────────────────────────┐ │
│  │ (next complaint card)           │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Key differences from desktop:**
- **No data table.** Each complaint is a vertical card with key-value rows.
- **Filter and Search** open as full-screen overlays (slide-up panels), not a sidebar. Each overlay has its own "Apply" button at the bottom.
- **Sort** opens an overlay with options like "Date (newest first)", "SLA (most urgent first)".
- Tapping a card opens the complaint detail.

### Employee: Complaint Detail + "Take Action" Pattern

The employee detail page shows the same details table and timeline as the citizen view, but with additional fields (citizen name, mobile number, current assignee) and a different action pattern.

**The "Take Action" pattern** — This is the key interaction for all workflow actions. Instead of showing individual action buttons (Assign, Reject, Resolve), there is a single "Take Action" button in a fixed bottom bar.

```
┌─────────────────────────────────────┐
│  Complaint Details                   │
│  ┌─────────────────────────────────┐ │
│  │ (details table — same as        │ │
│  │  citizen view but with extra     │ │
│  │  fields: citizen name, mobile,   │ │
│  │  current assignee)               │ │
│  └─────────────────────────────────┘ │
│                                      │
│  Complaint Timeline                  │
│  ┌─────────────────────────────────┐ │
│  │ (vertical timeline — same as    │ │
│  │  citizen view)                   │ │
│  └─────────────────────────────────┘ │
│                                      │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│  ┌─────────────────────────────────┐ │  ← Fixed bottom bar
│  │       [ Take Action ]           │ │
│  │  ┌───────────────────────────┐  │ │  ← Popup menu (appears on tap)
│  │  │  Assign                   │  │ │
│  │  │  Reject                   │  │ │
│  │  └───────────────────────────┘  │ │
│  └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

**Flow:**
1. A fixed bar at the bottom of the screen contains a single button: **"Take Action"**.
2. Tapping it opens a **popup menu** directly above the button, listing the available actions for this complaint's current status and the user's role. The available actions come from the workflow definition (e.g. a GRO sees "Assign" and "Reject" for a new complaint; an LME sees "Resolve").
3. Selecting an action from the menu opens a **modal dialog**.

**What each action modal contains:**

| Action | Employee selector | Comments box | File upload | Extra |
|--------|:-:|:-:|:-:|-------|
| Assign | Yes | Yes | Yes | — |
| Reassign | Yes | Yes | Yes | — |
| Resolve | No | Yes | Yes | — |
| Reject | No | Yes (required) | Yes | — |
| Reopen | No | Yes | Yes | Reason dropdown |

**Employee selector (for Assign/Reassign):**
- A dropdown listing employees who have the right role for this action.
- Employees are **grouped by department** — the dropdown shows department headings with employee names nested underneath.
- Only employees with the appropriate assignee role (from the workflow config) appear.

**After the action is submitted:**
- The modal closes.
- A **toast notification** appears briefly (auto-dismisses after ~10 seconds) confirming success or showing an error.
- The page refreshes to show the updated status and a new timeline entry.

### General UX Patterns

**Mobile vs desktop rendering:**
- The inbox uses completely different layouts for mobile and desktop — not just CSS breakpoints, but different components/templates.
- Detection: check if the viewport width is below 768px.
- Desktop gets the three-panel sidebar+search+table layout.
- Mobile gets stacked cards with filter/search as full-screen overlays.

**Toast notifications:**
- Used after every workflow action (assign, resolve, reject, rate, etc.).
- Fixed-position bar at the bottom of the screen, above the action bar if one is present.
- Shows a brief success or error message.
- Auto-dismisses after about 10 seconds, with a manual close button.

**Fixed bottom action bar:**
- Present on all action screens (file complaint wizard steps, complaint detail for employees, complaint detail for citizens with resolved complaints).
- Pinned to the viewport bottom on mobile.
- Contains one primary action button (e.g. "Next", "Submit", "Take Action", "Rate").

**Key-value detail display:**
- Complaint details are shown as a two-column table: label on the left, value on the right.
- Each row separated by a light horizontal line.
- Used consistently across citizen and employee detail views.

**Vertical timeline:**
- Used on all complaint detail pages to show the audit trail.
- Each entry: coloured dot → connecting line → next dot.
- Entries ordered newest-first (most recent at top).
- Each entry shows: action name, date/time, who did it, comments, attached photos.

---

## DIGIT UI Component Library

### Option A: Build from Scratch (any framework)

Use the plain-English patterns in the [Screen-by-Screen UI Patterns](#screen-by-screen-ui-patterns) section above and implement them in whatever stack you prefer. No dependency on DIGIT packages.

### Option B: Use DIGIT's Own Components and CSS

If the user asks for the **DIGIT look-and-feel**, or says things like "use DIGIT components", "make it look like DIGIT", "use the official styling", then use the published DIGIT packages directly.

#### Packages

| Package | npm | GitHub |
|---------|-----|--------|
| React components | [@egovernments/digit-ui-react-components](https://www.npmjs.com/package/@egovernments/digit-ui-react-components) | [DIGIT-Frontend/.../react-components](https://github.com/egovernments/DIGIT-Frontend/tree/master/micro-ui/web/micro-ui-internals/packages/react-components) |
| CSS / design tokens | [@egovernments/digit-ui-css](https://www.npmjs.com/package/@egovernments/digit-ui-css) | [DIGIT-Frontend/.../css](https://github.com/egovernments/DIGIT-Frontend/tree/master/micro-ui/web/micro-ui-internals/packages/css) |
| SVG icon library (827+ icons) | [@egovernments/digit-ui-svg-components](https://www.npmjs.com/package/@egovernments/digit-ui-svg-components) | [DIGIT-Frontend/.../svg-components](https://github.com/egovernments/DIGIT-Frontend/tree/master/micro-ui/web/micro-ui-internals/packages/svg-components) |
| Hooks & utilities | [@egovernments/digit-ui-libraries](https://www.npmjs.com/package/@egovernments/digit-ui-libraries) | [DIGIT-Frontend/.../libraries](https://github.com/egovernments/DIGIT-Frontend/tree/master/micro-ui/web/micro-ui-internals/packages/libraries) |

**Install:**
```bash
npm install @egovernments/digit-ui-react-components @egovernments/digit-ui-css
```

**CSS-only via CDN** (no npm needed):
```html
<link rel="stylesheet" href="https://unpkg.com/@egovernments/digit-ui-css/dist/index.css" />
```

#### Interactive Catalog

- **Storybook (SVG icons)**: [https://unified-dev.digit.org/storybook-svg/](https://unified-dev.digit.org/storybook-svg/)
- **Storybook (React components)**: [https://unified-dev.digit.org/storybook](https://unified-dev.digit.org/storybook) *(may be intermittent)*
- **Component docs (Atoms)**: [docs.digit.org — Atom components](https://docs.digit.org/platform/guides/developer-guide/ui-developer-guide/digit-ui-components0.2.0/atom)
- **Full catalog (56+ components)**: [core.digit.org — DIGIT UI Core React Components](https://core.digit.org/guides/developer-guide/ui-developer-guide/digit-ui/ui-components-standardisation/digit-ui-core-react-components)

#### Component Index

The full export list lives in the package's `src/index.js`. Here is every component that ships with `@egovernments/digit-ui-react-components`, organized by the UI patterns described earlier in this doc:

**Pattern → DIGIT Component mapping:**

| UI Pattern (from Screen-by-Screen section) | DIGIT Component(s) | Import |
|--------------------------------------------|--------------------|---------|
| Fixed bottom action bar | `ActionBar` + `SubmitBar` | `import { ActionBar, SubmitBar } from "@egovernments/digit-ui-react-components"` |
| Key-value detail table | `StatusTable` + `Row` | `import { StatusTable, Row } from "..."` |
| Vertical timeline with dots | `ConnectingCheckPoints` + `CheckPoint` | `import { ConnectingCheckPoints, CheckPoint } from "..."` |
| Toast notification | `Toast` | `import { Toast } from "..."` |
| Popup menu (Take Action) | `Menu` | `import { Menu } from "..."` |
| Modal dialog | `Modal` | `import { Modal } from "..."` |
| Container card | `Card`, `CardHeader`, `CardText`, `CardSubHeader` | `import { Card, CardHeader } from "..."` |
| Data table with pagination | `Table` | `import { Table } from "..."` |
| Multi-select dropdown with chips | `MultiSelectDropdown` + `RemoveableTag` | `import { MultiSelectDropdown, RemoveableTag } from "..."` |
| Employee selector grouped by dept | `Dropdown` (with grouped options) | `import { Dropdown } from "..."` |
| Breadcrumb navigation | `BreadCrumb` | `import { BreadCrumb } from "..."` |
| Multi-step wizard | `FormComposer` or `FormStep` + `PageBasedInput` | `import { FormComposer } from "..."` |
| Configurable inbox | `InboxComposer` | `import { InboxComposer } from "..."` |
| Full-screen overlay (mobile filter) | `PopUp` | `import { PopUp } from "..."` |
| Loading spinner | `Loader` | `import { Loader } from "..."` |
| Success/error banner | `Banner` | `import { Banner } from "..."` |
| Photo gallery | `DisplayPhotos` | `import { DisplayPhotos } from "..."` |
| File upload | `UploadFile` | `import { UploadFile } from "..."` |
| Star rating | `Rating` | `import { Rating } from "..."` |
| Radio button group | `RadioButtons` | `import { RadioButtons } from "..."` |
| Checkbox | `CheckBox` | `import { CheckBox } from "..."` |
| Text input | `TextInput` | `import { TextInput } from "..."` |
| Textarea | `TextArea` | `import { TextArea } from "..."` |
| Phone number input | `MobileNumber` | `import { MobileNumber } from "..."` |
| Date picker | `DatePicker` | `import { DatePicker } from "..."` |
| Searchable dropdown | `Dropdown` (with `optionKey` + search) | `import { Dropdown } from "..."` |
| Top navigation bar | `TopBar` | `import { TopBar } from "..."` |
| Horizontal tabs | `HorizontalNav` | `import { HorizontalNav } from "..."` |

**Additional components** not mapped to specific patterns above but commonly used:
- `LinkButton` — Inline link-styled button
- `BackButton` — Back navigation
- `KeyNote` — Label/value pair (used in complaint cards)
- `BreakLine` — Horizontal divider
- `Amount` — Formatted currency display
- `CitizenHomeCard` — Home page card for citizen modules
- `EmployeeModuleCard` — Home page card for employee modules
- `EllipsisMenu` — "..." overflow menu
- `ToggleSwitch` — On/off toggle
- `ImageViewer` — Fullscreen image viewer
- `Stepper` — Step indicator for wizards
- `Tab` — Tab navigation
- `Accordion` — Collapsible section

### Technology Stack (DIGIT's own)

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 17.0.2 | UI framework |
| React Router | 5.3.0 | Routing |
| Redux | 4.1.2 | Global state |
| React Query | 3.6.1 | Server state / caching |
| React Hook Form | 6.15.8 | Form management |
| react-i18next | 11.16.2 | Internationalization |
| Tailwind CSS | 1.9.6 | Utility-first CSS |
| react-table | 7.7.0 | Data tables |

### Recommended Stack for New UI

If building from scratch (not using DIGIT's packages), you can use any modern stack. Recommended:

| Technology | Why |
|-----------|-----|
| React 18+ or Next.js 14+ | Modern React with server components |
| TanStack Query (React Query v5) | Server state, caching, mutations |
| React Hook Form + Zod | Form validation |
| Tailwind CSS 3+ | Styling (matches DIGIT patterns) |
| Axios or fetch | HTTP client |
| i18next | Localization |

### Request Wrapper Pattern

> **Note:** For new projects, use the generated SDK client (Section 3.5) instead of this hand-written wrapper. This pattern is kept as reference for understanding how DIGIT's `RequestInfo` wrapping works under the hood.

The DIGIT UI uses a centralized request wrapper. Here's the pattern to replicate:

```typescript
// api-client.ts
import axios from 'axios';

const API_BASE = 'https://your-digit-api.example.com';

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  params?: Record<string, string>;
  data?: Record<string, unknown>;
  auth?: boolean;
  userService?: boolean;
}

function getRequestInfo(auth: boolean, userService: boolean) {
  const user = getStoredUser(); // from session storage
  const locale = getLocale();   // e.g. "en_IN"

  return {
    apiId: "Rainmaker",
    ver: "1.0",
    ts: Date.now(),
    action: "",
    did: "",
    key: "",
    msgId: `${Date.now()}|${locale}`,
    ...(auth && user?.access_token ? { authToken: user.access_token } : {}),
    ...(userService && user?.info ? { userInfo: user.info } : {}),
  };
}

export async function digitRequest<T>(options: RequestOptions): Promise<T> {
  const { url, method = 'POST', params, data, auth = true, userService = true } = options;

  const body = method === 'POST' ? {
    RequestInfo: getRequestInfo(auth, userService),
    ...data,
  } : undefined;

  const response = await axios({
    method,
    url: `${API_BASE}${url}`,
    params,
    data: body,
    headers: auth ? { 'auth-token': getStoredUser()?.access_token } : {},
  });

  return response.data as T;
}
```

### Service Layer Pattern

> **Note:** For new projects, use the generated SDK client (Section 3.5). This hand-written service layer pattern is kept as reference.

```typescript
// services/pgr.ts
import { digitRequest } from './api-client';

export const PGRService = {
  async search(tenantId: string, filters: Record<string, string> = {}) {
    return digitRequest({
      url: '/pgr-services/v2/request/_search',
      params: { tenantId, ...filters },
    });
  },

  async create(service: ServiceCreatePayload, tenantId: string) {
    return digitRequest({
      url: '/pgr-services/v2/request/_create',
      params: { tenantId },
      data: { service, workflow: { action: 'APPLY' } },
    });
  },

  async update(service: Service, workflow: WorkflowAction) {
    return digitRequest({
      url: '/pgr-services/v2/request/_update',
      params: { tenantId: service.tenantId },
      data: { service, workflow },
    });
  },

  async count(tenantId: string, params: Record<string, string> = {}) {
    return digitRequest({
      url: '/pgr-services/v2/request/_count',
      params: { tenantId, ...params },
    });
  },
};
```

---

## Localization

All UI text should use localization keys, not hardcoded strings. Fetch labels at app startup.

### Key Modules

| Module | Contains |
|--------|----------|
| `rainmaker-pgr` | PGR complaint type names, status labels, UI text |
| `rainmaker-common` | Common labels (Submit, Cancel, etc.) |
| `rainmaker-hr` | Employee/HRMS labels |

### Localization Key Conventions

| Pattern | Example | Resolves to |
|---------|---------|-------------|
| `SERVICEDEFS.<CODE>` | `SERVICEDEFS.STREETLIGHTNOTWORKING` | "Street Light Not Working" |
| `CS_COMMON_<STATUS>` | `CS_COMMON_PENDINGFORASSIGNMENT` | "Pending for Assignment" |
| `DEPT_<CODE>` | `DEPT_25` | "Street Lights" |
| `CS_COMPLAINT_DETAILS_<FIELD>` | `CS_COMPLAINT_DETAILS_COMPLAINT_NO` | "Complaint No" |

### Fetch and Cache

```typescript
// Fetch all PGR labels at startup
const response = await digitRequest({
  url: '/localization/messages/v1/_search',
  params: { tenantId: 'pg', locale: 'en_IN', module: 'rainmaker-pgr' },
});

// Build lookup map
const labels = new Map<string, string>();
for (const msg of response.messages) {
  labels.set(msg.code, msg.message);
}

// Usage
function t(key: string): string {
  return labels.get(key) || key;
}
```

---

## File Uploads

### Upload Flow

```typescript
async function uploadPhoto(file: File, tenantId: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tenantId', tenantId);
  formData.append('module', 'rainmaker-pgr');

  const response = await axios.post(
    `${API_BASE}/filestore/v1/files`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
        'auth-token': getStoredUser()?.access_token,
      },
    }
  );

  return response.data.files[0].fileStoreId;
}
```

### Display Uploaded Photos

```typescript
async function getPhotoUrls(fileStoreIds: string[], tenantId: string): Promise<string[]> {
  const ids = fileStoreIds.join(',');
  const response = await axios.get(
    `${API_BASE}/filestore/v1/files/url?tenantId=${tenantId}&fileStoreIds=${ids}`,
  );
  return response.data.fileStoreIds.map((f: any) => f.url);
}
```

---

## Error Handling

### Common API Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `InvalidAccessTokenException` | Token expired | Re-login, redirect to login page |
| `UnauthorizedAccessException` | Missing role | Check user roles for the action |
| `Schema definition not found` | Missing MDMS schema | Run `tenant_bootstrap` on the state root |
| `Action ASSIGN not found in config` | Invalid workflow transition | Check current status before offering actions |
| `NON_UNIQUE` / `DUPLICATE` | Record already exists | Check before create, handle idempotently |

### Error Response Format

```json
{
  "Errors": [{
    "code": "InvalidInput",
    "message": "Some fields are invalid",
    "description": "Detailed error description",
    "params": ["fieldName"]
  }]
}
```

### Auth Error Handling Pattern

```typescript
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 ||
        error.response?.data?.Errors?.[0]?.code === 'InvalidAccessTokenException') {
      // Clear session and redirect to login
      clearSession();
      window.location.href = '/login?session_expired=true';
    }
    return Promise.reject(error);
  }
);
```

---

## Complete Code Examples

> **Prefer the DIGIT SDK approach** (Section 3.5). The hand-written examples below are kept as reference for understanding the DIGIT API patterns (RequestInfo wrapping, service layer structure), but new UI code should use the generated typed client from `openapi-fetch` instead of hand-writing fetch calls.

### Example: Minimal Complaint Creation Page (React)

```tsx
import { useState, useEffect } from 'react';
import { digitRequest } from '../services/api-client';

interface ComplaintType {
  serviceCode: string;
  serviceName: string;
  department: string;
}

interface Locality {
  code: string;
  name: string;
}

export function CreateComplaint({ tenantId }: { tenantId: string }) {
  const [types, setTypes] = useState<ComplaintType[]>([]);
  const [localities, setLocalities] = useState<Locality[]>([]);
  const [form, setForm] = useState({
    serviceCode: '',
    description: '',
    localityCode: '',
    citizenName: '',
    citizenMobile: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Fetch complaint types on mount
  useEffect(() => {
    const root = tenantId.split('.')[0];

    // Fetch complaint types
    digitRequest({
      url: '/mdms-v2/v2/_search',
      data: {
        MdmsCriteria: {
          tenantId: root,
          schemaCode: 'RAINMAKER-PGR.ServiceDefs',
          limit: 100,
        },
      },
    }).then((res: any) => {
      const defs = res.mdms?.map((r: any) => r.data).filter((d: any) => d.active) || [];
      setTypes(defs);
    });

    // Fetch localities
    digitRequest({
      url: '/boundary-service/boundary-relationships/_search',
      data: {
        BoundaryRelationship: {
          tenantId,
          hierarchyType: 'ADMIN',
          boundaryType: 'Locality',
        },
      },
    }).then((res: any) => {
      // Extract locality codes from the boundary tree
      const locs: Locality[] = [];
      const extract = (items: any[]) => {
        for (const item of items) {
          if (item.boundaryType === 'Locality') {
            locs.push({ code: item.code, name: item.code });
          }
          if (item.children) extract(item.children);
        }
      };
      for (const tb of res.TenantBoundary || []) {
        if (tb.boundary) extract(tb.boundary);
      }
      setLocalities(locs);
    });
  }, [tenantId]);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res: any = await digitRequest({
        url: '/pgr-services/v2/request/_create',
        params: { tenantId },
        data: {
          service: {
            tenantId,
            serviceCode: form.serviceCode,
            description: form.description,
            address: {
              locality: { code: form.localityCode },
            },
            citizen: {
              name: form.citizenName,
              mobileNumber: form.citizenMobile,
            },
            source: 'web',
          },
          workflow: { action: 'APPLY' },
        },
      });
      const id = res.ServiceWrappers?.[0]?.service?.serviceRequestId;
      setResult(id);
    } catch (err) {
      alert('Failed to create complaint: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-bold text-green-600">Complaint Filed!</h2>
        <p className="mt-2">Your complaint ID: <strong>{result}</strong></p>
        <p className="mt-1 text-gray-500">Track status in "My Complaints"</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">File a Complaint</h1>

      <label className="block mb-4">
        <span className="text-sm font-medium">Complaint Type</span>
        <select
          className="mt-1 block w-full border rounded p-2"
          value={form.serviceCode}
          onChange={(e) => setForm({ ...form, serviceCode: e.target.value })}
        >
          <option value="">Select type...</option>
          {types.map((t) => (
            <option key={t.serviceCode} value={t.serviceCode}>
              {t.serviceName}
            </option>
          ))}
        </select>
      </label>

      <label className="block mb-4">
        <span className="text-sm font-medium">Locality</span>
        <select
          className="mt-1 block w-full border rounded p-2"
          value={form.localityCode}
          onChange={(e) => setForm({ ...form, localityCode: e.target.value })}
        >
          <option value="">Select locality...</option>
          {localities.map((l) => (
            <option key={l.code} value={l.code}>{l.name}</option>
          ))}
        </select>
      </label>

      <label className="block mb-4">
        <span className="text-sm font-medium">Description</span>
        <textarea
          className="mt-1 block w-full border rounded p-2"
          rows={4}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe your complaint..."
        />
      </label>

      <label className="block mb-4">
        <span className="text-sm font-medium">Your Name</span>
        <input
          className="mt-1 block w-full border rounded p-2"
          value={form.citizenName}
          onChange={(e) => setForm({ ...form, citizenName: e.target.value })}
        />
      </label>

      <label className="block mb-4">
        <span className="text-sm font-medium">Mobile Number</span>
        <input
          className="mt-1 block w-full border rounded p-2"
          value={form.citizenMobile}
          onChange={(e) => setForm({ ...form, citizenMobile: e.target.value })}
          maxLength={10}
          pattern="[0-9]{10}"
        />
      </label>

      <button
        className="w-full bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50"
        onClick={handleSubmit}
        disabled={submitting || !form.serviceCode || !form.localityCode || !form.description}
      >
        {submitting ? 'Submitting...' : 'Submit Complaint'}
      </button>
    </div>
  );
}
```

### Example: Employee Inbox with Assign Action

```tsx
import { useState, useEffect } from 'react';
import { digitRequest } from '../services/api-client';

export function EmployeeInbox({ tenantId }: { tenantId: string }) {
  const [complaints, setComplaints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('PENDINGFORASSIGNMENT');

  useEffect(() => {
    setLoading(true);
    digitRequest({
      url: '/pgr-services/v2/request/_search',
      params: { tenantId, applicationStatus: statusFilter, limit: '50' },
    }).then((res: any) => {
      setComplaints(res.ServiceWrappers || []);
    }).finally(() => setLoading(false));
  }, [tenantId, statusFilter]);

  async function handleAssign(serviceRequestId: string, service: any) {
    // In production: show modal to select employee from HRMS search
    const comment = prompt('Assignment comment:');
    if (!comment) return;

    await digitRequest({
      url: '/pgr-services/v2/request/_update',
      params: { tenantId },
      data: {
        service,
        workflow: {
          action: 'ASSIGN',
          comments: comment,
        },
      },
    });

    // Refresh list
    setComplaints(complaints.filter(c =>
      c.service.serviceRequestId !== serviceRequestId
    ));
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Complaint Inbox</h1>

      <div className="flex gap-2 mb-4">
        {['PENDINGFORASSIGNMENT', 'PENDINGATLME', 'RESOLVED'].map(status => (
          <button
            key={status}
            className={`px-3 py-1 rounded ${
              statusFilter === status ? 'bg-blue-600 text-white' : 'bg-gray-200'
            }`}
            onClick={() => setStatusFilter(status)}
          >
            {status.replace(/([A-Z])/g, ' $1').trim()}
          </button>
        ))}
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : complaints.length === 0 ? (
        <p className="text-gray-500">No complaints found</p>
      ) : (
        <div className="space-y-4">
          {complaints.map(({ service, workflow }) => (
            <div key={service.serviceRequestId} className="border rounded p-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{service.serviceRequestId}</p>
                  <p className="text-sm text-gray-600">{service.serviceCode}</p>
                  <p className="text-sm mt-1">{service.description}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {new Date(service.auditDetails.createdTime).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {service.applicationStatus === 'PENDINGFORASSIGNMENT' && (
                    <>
                      <button
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm"
                        onClick={() => handleAssign(service.serviceRequestId, service)}
                      >
                        Assign
                      </button>
                      <button className="px-3 py-1 bg-red-600 text-white rounded text-sm">
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Example: Workflow Timeline Component

```tsx
interface TimelineEntry {
  action: string;
  state: { state: string; applicationStatus: string };
  assigner?: { name: string };
  assignes?: Array<{ name: string }>;
  comment?: string;
  auditDetails: { createdTime: number };
}

export function ComplaintTimeline({ entries }: { entries: TimelineEntry[] }) {
  const statusColors: Record<string, string> = {
    PENDINGFORASSIGNMENT: 'bg-yellow-100 text-yellow-800',
    PENDINGATLME: 'bg-blue-100 text-blue-800',
    PENDINGFORREASSIGNMENT: 'bg-orange-100 text-orange-800',
    RESOLVED: 'bg-green-100 text-green-800',
    REJECTED: 'bg-red-100 text-red-800',
    CLOSEDAFTERRESOLUTION: 'bg-gray-100 text-gray-800',
  };

  return (
    <div className="relative">
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-4 mb-6">
          {/* Timeline dot and line */}
          <div className="flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-blue-600" />
            {i < entries.length - 1 && (
              <div className="w-0.5 flex-1 bg-gray-300 mt-1" />
            )}
          </div>
          {/* Content */}
          <div className="flex-1 -mt-1">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                statusColors[entry.state.applicationStatus] || 'bg-gray-100'
              }`}>
                {entry.action}
              </span>
              <span className="text-xs text-gray-400">
                {new Date(entry.auditDetails.createdTime).toLocaleString()}
              </span>
            </div>
            {entry.assigner && (
              <p className="text-sm text-gray-600 mt-1">
                By: {entry.assigner.name}
              </p>
            )}
            {entry.assignes?.length && (
              <p className="text-sm text-gray-600">
                Assigned to: {entry.assignes.map(a => a.name).join(', ')}
              </p>
            )}
            {entry.comment && (
              <p className="text-sm mt-1 italic">"{entry.comment}"</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Integration Testing

### What

Tests that call real DIGIT APIs — not mocks, not stubs. They verify that the SDK-generated types and your API calls match what the actual DIGIT cluster expects and returns.

### Why

The OpenAPI spec (from `api_catalog`) is maintained manually and may have inaccuracies. Integration tests are the ground truth. They catch:
- Required params the spec forgot to mark as required (e.g. HRMS `offset`)
- Request body shapes that differ from the spec (e.g. `assignes` objects vs strings)
- Response shapes that changed between DIGIT versions
- Auth/role requirements not documented in the spec

### Test Structure

Create a test file (e.g. `src/__tests__/digit-api.integration.test.ts`) covering every DIGIT service the UI calls:

```typescript
// digit-api.integration.test.ts
// Run against a real DIGIT cluster via the same proxy the UI uses

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.DIGIT_API_BASE || 'http://localhost:3000/digit-api';
const TENANT_ID = process.env.DIGIT_TENANT_ID || 'pg.citya';
const ROOT_TENANT = TENANT_ID.split('.')[0];

let employeeToken: string;
let citizenToken: string;
let serviceRequestId: string;

describe('DIGIT API Integration Tests', () => {

  // --- Auth ---
  describe('Auth', () => {
    it('should login as EMPLOYEE', async () => {
      const res = await login('ADMIN', 'eGov@123', 'EMPLOYEE');
      expect(res.access_token).toBeDefined();
      employeeToken = res.access_token;
    });

    it('should login as CITIZEN', async () => {
      const res = await login('9876543210', 'eGov@123', 'CITIZEN');
      expect(res.access_token).toBeDefined();
      citizenToken = res.access_token;
    });
  });

  // --- HRMS ---
  describe('HRMS', () => {
    it('should search employees with required offset/limit', async () => {
      // BUG CAUGHT: offset is required, omitting it returns 400
      const res = await digitPost('/egov-hrms/employees/_search', {
        params: { tenantId: TENANT_ID, limit: '100', offset: '0' },
        token: employeeToken,
      });
      expect(res.Employees).toBeDefined();
      expect(Array.isArray(res.Employees)).toBe(true);
    });
  });

  // --- MDMS ---
  describe('MDMS', () => {
    it('should fetch service definitions', async () => {
      const res = await digitPost('/mdms-v2/v2/_search', {
        token: employeeToken,
        body: {
          MdmsCriteria: {
            tenantId: ROOT_TENANT,
            schemaCode: 'RAINMAKER-PGR.ServiceDefs',
            limit: 100,
          },
        },
      });
      expect(res.mdms?.length).toBeGreaterThan(0);
    });

    it('should fetch departments', async () => {
      const res = await digitPost('/mdms-v2/v2/_search', {
        token: employeeToken,
        body: {
          MdmsCriteria: {
            tenantId: ROOT_TENANT,
            schemaCode: 'common-masters.Department',
            limit: 100,
          },
        },
      });
      expect(res.mdms?.length).toBeGreaterThan(0);
    });
  });

  // --- Boundary ---
  describe('Boundary', () => {
    it('should fetch localities', async () => {
      const res = await digitPost('/boundary-service/boundary-relationships/_search', {
        token: employeeToken,
        body: {
          BoundaryRelationship: {
            tenantId: TENANT_ID,
            hierarchyType: 'ADMIN',
            boundaryType: 'Locality',
          },
        },
      });
      expect(res.TenantBoundary).toBeDefined();
    });
  });

  // --- PGR Lifecycle ---
  describe('PGR Lifecycle', () => {
    it('should create a complaint', async () => {
      const res = await digitPost('/pgr-services/v2/request/_create', {
        params: { tenantId: TENANT_ID },
        token: employeeToken,
        body: {
          service: {
            tenantId: TENANT_ID,
            serviceCode: 'StreetLightNotWorking',
            description: 'Integration test complaint',
            address: { locality: { code: 'SUN04' } },
            citizen: { name: 'Test Citizen', mobileNumber: '9000000001' },
            source: 'web',
          },
          workflow: { action: 'APPLY' },
        },
      });
      serviceRequestId = res.ServiceWrappers[0].service.serviceRequestId;
      expect(serviceRequestId).toBeDefined();
    });

    it('should assign the complaint', async () => {
      // BUG CAUGHT: assignes must be [{uuid: "..."}], not ["..."]
      const res = await digitPost('/pgr-services/v2/request/_update', {
        params: { tenantId: TENANT_ID },
        token: employeeToken,
        body: {
          service: { serviceRequestId, tenantId: TENANT_ID },
          workflow: { action: 'ASSIGN', comments: 'Integration test assign' },
        },
      });
      expect(res.ServiceWrappers[0].service.applicationStatus).toBe('PENDINGATLME');
    });

    it('should resolve the complaint', async () => {
      const res = await digitPost('/pgr-services/v2/request/_update', {
        params: { tenantId: TENANT_ID },
        token: employeeToken,
        body: {
          service: { serviceRequestId, tenantId: TENANT_ID },
          workflow: { action: 'RESOLVE', comments: 'Integration test resolve' },
        },
      });
      expect(res.ServiceWrappers[0].service.applicationStatus).toBe('RESOLVED');
    });

    it('should rate and close the complaint', async () => {
      const res = await digitPost('/pgr-services/v2/request/_update', {
        params: { tenantId: TENANT_ID },
        token: citizenToken,
        body: {
          service: { serviceRequestId, tenantId: TENANT_ID },
          workflow: { action: 'RATE', rating: 5, comments: 'Great job' },
        },
      });
      expect(res.ServiceWrappers[0].service.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
    });
  });

  // --- Workflow ---
  describe('Workflow', () => {
    it('should fetch audit trail for a complaint', async () => {
      const res = await digitPost('/egov-workflow-v2/egov-wf/process/_search', {
        token: employeeToken,
        body: {
          criteria: {
            tenantId: TENANT_ID,
            businessIds: [serviceRequestId],
            limit: 50,
            offset: 0,
          },
        },
      });
      expect(res.ProcessInstances?.length).toBeGreaterThan(0);
    });
  });

  // --- Localization ---
  describe('Localization', () => {
    it('should fetch PGR UI labels', async () => {
      const res = await digitPost('/localization/messages/v1/_search', {
        params: { tenantId: ROOT_TENANT, locale: 'en_IN', module: 'rainmaker-pgr' },
        token: employeeToken,
      });
      expect(res.messages?.length).toBeGreaterThan(0);
    });
  });
});

// --- Helpers ---
async function login(username: string, password: string, userType: string) {
  const body = new URLSearchParams({
    username, password, userType,
    tenantId: TENANT_ID, grant_type: 'password', scope: 'read',
  });
  const res = await fetch(`${API_BASE}/user/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
    },
    body,
  });
  return res.json();
}

async function digitPost(url: string, opts: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  token: string;
}) {
  const queryString = opts.params
    ? '?' + new URLSearchParams(opts.params).toString()
    : '';
  const res = await fetch(`${API_BASE}${url}${queryString}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: {
        apiId: 'Rainmaker', ver: '1.0', ts: Date.now(),
        action: '', did: '', key: '',
        msgId: `${Date.now()}|en_IN`,
        authToken: opts.token,
      },
      ...opts.body,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}
```

### How to Run

**Via Next.js rewrite proxy** (same as the UI uses):
```bash
# Assumes next.config.js has a /digit-api/* rewrite to the DIGIT cluster
DIGIT_API_BASE=http://localhost:3000/digit-api npx vitest run src/__tests__/digit-api.integration.test.ts
```

**Via direct API calls** (for CI):
```bash
DIGIT_API_BASE=https://api.egov.theflywheel.in npx vitest run src/__tests__/digit-api.integration.test.ts
```

### When to Run

- After every build, before deploy
- After generating or re-generating the SDK
- After adding new API calls to the UI
- In CI as a gate before merge

### Failure Protocol

When an integration test fails:

1. **Determine the cause**: Is it a code bug or a spec bug?
   - **Code bug**: Your API call has wrong params/shape → fix the code
   - **Spec bug**: The OpenAPI spec in `api-catalog.ts` doesn't match the real API → fix the spec, re-generate SDK
2. **Fix both**: If the spec is wrong, update `api-catalog.ts` in the MCP server AND fix your code
3. **Re-run**: All tests must pass before proceeding

---

## UI Review Checklist

Before considering a PGR UI "done", review every screen against this checklist. These are real issues found in production-quality builds — easy to miss, hard to ignore once noticed.

### Data Display — Never Show Raw Codes

| Check | What to look for | Fix |
|-------|-----------------|-----|
| Locality names | Boundary codes like `LOC_86796233` or `MZ-CHIMOIO-LOC-CENTRO` shown to users | Strip prefixes to human names (e.g. `MZ-CHIMOIO-LOC-CENTRO` → "Centro") or fetch localization labels via `localization_search` with module `rainmaker-boundary-mz.chimoio` |
| Department names | Raw codes like `DEPT_4` in complaint detail | Map via MDMS `common-masters.Department` — you already fetch these, wire them to the detail view |
| Service type casing | Inconsistent casing: "Damaged road" vs "Flooding or Waterlogged Street" | Apply consistent title-casing in the display layer, or use the `name` field from `RAINMAKER-PGR.ServiceDefs` consistently |
| Complaint IDs | Long IDs like `PG-PGR-2026-02-28-004379` wrapping on mobile | Truncate display or use shorter format; keep full ID in detail view |
| SLA on terminal states | "6d" shown in green on a Closed complaint — misleading | Hide SLA column/badge entirely for `RESOLVED`, `REJECTED`, `CLOSEDAFTERRESOLUTION` statuses |

### Wizard / Multi-Step Forms

| Check | What to look for | Fix |
|-------|-----------------|-----|
| Empty steps | Single input field floating in vast white space (description, location steps) | Add contextual help text ("Be specific — mention landmarks, street names"), show the selected complaint type as a reminder header, or add a visual aside |
| Step labels lack names | "Step 2 of 4" tells position but not purpose | Use "Step 2 of 4 — Describe the Issue" format |
| No confirmation screen | Wizard submits and jumps straight to detail page | Add a success screen: large checkmark, complaint number prominently displayed, "Your complaint has been filed!" message, then a link to view details |
| Complaint type grid | Categories are just uppercase text labels with no visual separation | Add subtle dividers, cards per category, or collapsible category headers for long lists |
| Location dropdown | Shows raw boundary codes instead of human-readable names | Same as locality fix above — strip prefixes or use localization |

### Employee Inbox

| Check | What to look for | Fix |
|-------|-----------------|-----|
| Filter sidebar has no counts | "Pending Assignment" checkbox without indication of how many | Show counts: "Pending Assignment (3)" — fetch totals per status or count from loaded data |
| No active filter indication | After checking a filter, hard to tell what's applied | Show dismissible chips above the table (already done in some implementations) and ensure they're visible |
| Table row hover | No visual feedback on hover | Add subtle background highlight on row hover |
| Empty state | "No complaints found." as plain text | Add an illustration or icon, suggest clearing filters or broadening search |

### Complaint Detail Page

| Check | What to look for | Fix |
|-------|-----------------|-----|
| Department shows raw code | `DEPT_4` instead of "Roads & Footpaths" | Map department codes to names from MDMS |
| "No activity yet." | Bare text under Activity Timeline for new complaints | Add a subtle icon or illustration, explain "This complaint hasn't been acted on yet" |
| Take Action menu backdrop | Dropdown appears but page remains fully interactive behind it | Add a subtle overlay or ensure click-outside behavior is obvious |
| Summary sidebar duplicates | Detail table and sidebar both show Status and SLA | Sidebar is for at-a-glance on desktop — acceptable, but consider removing duplicates from the main table on large screens |

### Navigation & Layout

| Check | What to look for | Fix |
|-------|-----------------|-----|
| No active nav tab highlight | Citizen "File" and "My Complaints" tabs all look the same | Add `border-b-2 border-[#f47738] text-[#f47738]` to the active tab based on current route |
| Single-item bottom nav | Employee mobile nav has only "Inbox" tab sitting alone | Either add more items (Dashboard, Profile) or hide bottom nav when there's only one item |
| Top bar role label | "(EMPLOYEE)" is developer jargon | Show the functional role instead: "GRO", "Field Worker", or omit entirely |
| Login page user type dropdown | "User Type: Employee/Citizen" adds cognitive overhead | For demo/quick-login flows, auto-detect or hide. For production, keep but style as secondary |

### Mobile Responsive

| Check | What to look for | Fix |
|-------|-----------------|-----|
| Long IDs wrapping | `PG-PGR-2026-02-28-004379` breaks across two lines on mobile cards | Truncate with ellipsis or use smaller font; full ID visible on tap/detail |
| Filter UX | Filter panel takes up valuable screen space when open | Use a slide-up bottom sheet or modal for mobile filters instead of inline expansion |
| Touch targets | Small checkboxes, tiny "×" close buttons | Ensure minimum 44×44px touch targets per WCAG guidelines |
| Card density | Cards may be too sparse or too dense | Test with 10+ complaints to verify scroll performance and readability |

### API Contract

| Check | What to look for | Fix |
|-------|-----------------|-----|
| No hand-written fetch | `api.ts` uses raw fetch with guessed params | Replace with SDK client generated from OpenAPI spec (Section 3.5) |
| Required params present | API returns 400 with NPE or validation error | Check OpenAPI spec for required params; add missing ones (e.g. HRMS `offset`) |
| Request body shapes correct | API returns 400 on workflow actions | Run integration tests (Section 13.5); fix spec if wrong, fix code if spec is right |
| Integration tests pass | All contract tests green before deploy | Fix failing call or update spec |

### General Polish

| Check | What to look for | Fix |
|-------|-----------------|-----|
| Loading states | Spinner with no context ("Loading...") | Add context: "Loading complaints...", "Fetching complaint types..." |
| Error states | Silent failures (API errors swallowed, empty screen) | Show inline error messages with retry buttons, not just empty lists |
| Optimistic UI | Actions feel slow (assign, resolve) with no immediate feedback | Show optimistic state update + toast, then sync with server response |
| Toast positioning | Toasts overlapping with fixed bottom action bar | Position toasts above the action bar (bottom-16) or use top-right |
| Accessibility | No ARIA labels, no keyboard navigation | Add `aria-label` to icon-only buttons, ensure tab order, use semantic HTML |

### Before Shipping

- [ ] All boundary codes display as human-readable names
- [ ] All department codes display as human-readable names
- [ ] SLA hidden on terminal statuses (Resolved, Rejected, Closed)
- [ ] Wizard steps have step names, not just numbers
- [ ] Filing a complaint shows a success confirmation screen
- [ ] Mobile tested with 10+ complaints in the list
- [ ] Empty states have helpful messages (not just "No data")
- [ ] Error states show retry options (not blank screens)
- [ ] Active nav tab is visually highlighted
- [ ] Top bar shows role name, not "(EMPLOYEE)"
- [ ] SDK generated from latest OpenAPI spec (`api_catalog`)
- [ ] All API calls go through typed SDK client (no raw fetch)
- [ ] Integration tests pass against real cluster
- [ ] Any spec discrepancies found are documented for MCP server fix

---

## Further Reading

- [DIGIT Platform Documentation](https://docs.digit.org/platform)
- [PGR Workflows](https://docs.digit.org/local-governance/v2.8/products/modules/public-grievances-and-redressal/pgr-workflows)
- [MDMS v2 Setup](https://docs.digit.org/platform/platform/core-services/mdms-v2-master-data-management-service)
- [DIGIT Frontend Repo](https://github.com/egovernments/DIGIT-Frontend)
- Use `api_catalog` MCP tool for the full OpenAPI 3.0 spec of all 37 endpoints
- Use `docs_search` MCP tool to search docs.digit.org for specific topics

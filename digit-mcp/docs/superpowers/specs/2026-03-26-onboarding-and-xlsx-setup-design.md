# Design: Arbitrary URL Onboarding + xlsx-Based Tenant Setup

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Two features for DIGIT MCP server

---

## Feature 1: Extend `configure` with Arbitrary Base URL

### Problem

The `configure` tool only works with named environments hardcoded in `src/config/environments.ts`. Users who want to connect to a new DIGIT instance must edit source code to add it. There is no way to verify which services are available on an unknown instance.

### Solution

Extend `configure` with three optional params: `base_url`, `username`, `password`. When `base_url` is provided, skip the named environment lookup and create an ad-hoc `Environment` at runtime. After OAuth2 login, probe DIGIT services to build an availability report.

### Input Schema Changes

New optional params on `configure`:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `base_url` | string | no | DIGIT instance base URL (e.g., `https://unified-dev.digit.org`) |
| `username` | string | no | Admin username. Falls back to `CRS_USERNAME` env var |
| `password` | string | no | Admin password. Falls back to `CRS_PASSWORD` env var |

When `base_url` is provided, `environment` becomes optional. When neither `base_url` nor `environment` is provided, fall back to `CRS_ENVIRONMENT` env var (existing behavior).

### Service Probing

After successful OAuth2 login, probe services in two waves:

**Wave 1 — MDMS endpoint detection (sequential, blocks other probes):**
- Try `POST /mdms-v2/v2/_search` with minimal body
- Fall back to `POST /egov-mdms-service/v2/_search`
- Determines `MDMS_SEARCH`, `MDMS_CREATE`, `MDMS_UPDATE` endpoint overrides

**Wave 2 — Service probes (parallel):**

| Service | Method | Probe Path |
|---------|--------|------------|
| PGR | POST | `/pgr-services/v2/_search` |
| HRMS | POST | `/egov-hrms/employees/_search` |
| Boundary | POST | `/boundary-service/boundary-hierarchy/_search` |
| Workflow | POST | `/egov-workflow-v2/egov-wf/businessservice/_search` |
| Localization | POST | `/localization/messages/v1/_search` |
| Filestore | GET | `/filestore/v1/files/ping` |
| IDGen | POST | `/egov-idgen/id/_generate` |
| User | POST | `/user/_search` |
| Encryption | POST | `/egov-enc-service/crypto/v1/_sign` |
| Inbox | POST | `/inbox/v2/_search` |

Each probe sends a minimal valid request with auth token. Classification:
- **2xx or 400** (bad request but service exists) → `available`
- **404** → `not_found`
- **Connection refused / timeout** → `unreachable`

### State Management

- `DigitApiClient` gets a new method: `setAdHocEnvironment(baseUrl, endpointOverrides?)`
- Creates an `Environment` object: `{ name: "<hostname> (ad-hoc)", url: baseUrl, stateTenantId: <from login response>, endpointOverrides: <from probing> }`
- Discovered endpoint overrides are stored so subsequent tool calls use the correct paths
- Existing cross-tenant role provisioning logic applies unchanged

### Response Structure

```json
{
  "success": true,
  "message": "Connected to https://unified-dev.digit.org as ADMIN",
  "environment": {
    "name": "unified-dev.digit.org (ad-hoc)",
    "url": "https://unified-dev.digit.org",
    "source": "base_url"
  },
  "auth": {
    "username": "ADMIN",
    "tenantId": "pg",
    "roles": ["CITIZEN", "EMPLOYEE", "SUPERUSER"]
  },
  "services": {
    "mdms": { "status": "available", "endpoint": "/mdms-v2" },
    "pgr": { "status": "available", "endpoint": "/pgr-services" },
    "hrms": { "status": "available", "endpoint": "/egov-hrms" },
    "boundary": { "status": "available", "endpoint": "/boundary-service" },
    "workflow": { "status": "available", "endpoint": "/egov-workflow-v2" },
    "localization": { "status": "available", "endpoint": "/localization" },
    "filestore": { "status": "not_found" },
    "idgen": { "status": "available", "endpoint": "/egov-idgen" },
    "user": { "status": "available", "endpoint": "/user" },
    "encryption": { "status": "unreachable" },
    "inbox": { "status": "not_found" }
  },
  "stateTenantId": "pg",
  "detectedEndpointOverrides": {
    "MDMS_SEARCH": "/mdms-v2/v2/_search",
    "MDMS_CREATE": "/mdms-v2/v2/_create",
    "MDMS_UPDATE": "/mdms-v2/v2/_update"
  }
}
```

### New Files

| File | Purpose |
|------|---------|
| `src/utils/probe.ts` | `probeServices(baseUrl, authToken)` — parallel service probing, returns availability map |

### Modified Files

| File | Change |
|------|--------|
| `src/tools/mdms-tenant.ts` | Add `base_url`, `username`, `password` to `configure` input schema and handler |
| `src/services/digit-api.ts` | Add `setAdHocEnvironment(baseUrl, overrides?)` method |

---

## Feature 2: xlsx-Based Tenant Setup

### Problem

The current `city_setup` tool creates tenants with auto-generated boundaries and minimal configuration. Setting up a production-ready city requires manually calling many tools (departments, designations, complaint types, employees). The CCRS project has a Python-based xlsx dataloader that handles this, but it's separate from the MCP server.

### Solution

New MCP tool `city_setup_from_xlsx` that accepts xlsx files in the same format as the CCRS dataloader. Processes 4 phases in dependency order: Tenant, Boundaries, Common Masters, Employees. Returns structured JSON with per-row status.

### Tool Definition

**Name:** `city_setup_from_xlsx`
**Group:** `mdms`
**Category:** `setup`
**Risk:** `write`

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `tenant_id` | string | yes | Target city tenant (e.g., `pg.newcity`). Must contain a dot. |
| `tenant_file` | string | no | Local path or fileStoreId for Tenant & Branding xlsx |
| `boundary_file` | string | no | Local path or fileStoreId for Boundary xlsx |
| `masters_file` | string | no | Local path or fileStoreId for Common & Complaint Masters xlsx |
| `employee_file` | string | no | Local path or fileStoreId for Employee xlsx |

At least one file param must be provided. Phases only run if their corresponding file is provided.

### File Resolution

Auto-detect based on format:
- Starts with `/` or `./` → local filesystem path → `fs.readFileSync()`
- UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) → DIGIT fileStoreId → download via `filestore_get_urls` + HTTP GET

### Phase 1: Tenant (from `tenant_file`)

**Sheet:** `Tenant Info`

| Column | Required | Maps to |
|--------|----------|---------|
| `Tenant Display Name*` | yes | `name` |
| `Tenant Code*` | yes | `code` (lowercase, no dots) |
| `Tenant Type*` | yes | type (STATE/CITY) |
| `Logo File Path*` | no | stored as string reference (actual upload out of scope) |
| `City Name` | no | `city.name` |
| `District Name` | no | `city.districtName` |
| `Latitude` | no | `city.latitude` (float) |
| `Longitude` | no | `city.longitude` (float) |
| `Tenant Website` | no | `domainUrl` |

**Actions:**
1. Create `tenant.tenants` MDMS record under derived root tenant
2. Upsert localization keys for tenant name (`en_IN` locale)

**Optional sheet:** `Tenant Branding Details`

| Column | Maps to |
|--------|---------|
| `Banner URL` | `bannerUrl` |
| `Logo URL` | `logoUrl` |
| `Logo URL (White)` | `logoUrlWhite` |
| `State Logo` | `statelogo` |

**Action:** Create `tenant.citymodule` MDMS record.

### Phase 2: Boundaries (from `boundary_file`)

**Sheet:** `Boundary` or `Boundary Data`

**Actions:**
1. Upload xlsx to DIGIT filestore via existing `DigitApiClient` filestore methods
2. Call boundary management process API (`/egov-bndry-mgmnt/boundary-service/boundary-v1-data/process`)
3. Poll boundary management status until complete or failed

This reuses the existing DIGIT boundary management service — same flow as CCRS dataloader and the existing `boundary_mgmt_process` MCP tool.

### Phase 3: Common Masters (from `masters_file`)

**Sheet 1:** `Department And Designation Master`

| Column | Required | Maps to |
|--------|----------|---------|
| `Department Name*` | yes | `name`, auto-code `DEPT_1`, `DEPT_2`... |
| `Designation Name*` | yes | `name`, auto-code `DESIG_01`, `DESIG_02`... |
| `Jurisdiction` | no | scope metadata |

**Actions:**
1. Create `common-masters.Department` MDMS records with auto-generated codes
2. Create `common-masters.Designation` MDMS records with auto-generated codes
3. Upsert localization keys for each department and designation name
4. Build `deptNameToCode` map (e.g., `"Public Works" → "DEPT_1"`) — passed to Phase 4

**Sheet 2:** `Complaint Type Master`

Hierarchical: rows alternate between parent (complaint type) and children (sub-types).

| Column | Required | Context | Maps to |
|--------|----------|---------|---------|
| `Complaint Type*` | yes | parent row | parent service name |
| `Complaint sub type*` | yes | child row | child service name |
| `Department Name*` | yes | parent row | mapped to dept code via `deptNameToCode` |
| `Resolution Time (Hours)*` | yes | parent row | `slaHours` (children inherit) |
| `Search Words*` | yes | parent row | `keywords` comma-separated |
| `Priority` | no | parent row | priority level |

**Actions:**
1. Parse parent-child hierarchy (child inherits department, SLA, keywords from parent if not specified)
2. Auto-generate service codes: `"Road Pothole" → "RoadPothole"` (PascalCase, no spaces)
3. Create `RAINMAKER-PGR.ServiceDefs` MDMS records
4. Upsert localization keys for each complaint type and sub-type

### Phase 4: Employees (from `employee_file`)

**Sheet:** `Employee Master`

| Column | Required | Maps to |
|--------|----------|---------|
| `User Name*` | yes | `name`, auto-code `JOHN_SMITH` |
| `Mobile Number*` | yes | `mobileNumber` (validated: 10 digits) |
| `Department Name*` | yes | resolved to code via MDMS lookup or `deptNameToCode` |
| `Designation Name*` | yes | resolved to code via MDMS lookup |
| `Role Names*` | yes | comma-separated, resolved to role codes via access control MDMS |
| `Date of Appointment*` | yes | Excel date → Unix timestamp (ms) |
| `Assignment From Date*` | yes | Excel date → Unix timestamp (ms) |
| `Password` | no | defaults to `eGov@123` |

**Actions:**
1. If `deptNameToCode` not available from Phase 3, fetch existing departments from MDMS
2. Fetch existing designations from MDMS to build `desigNameToCode` map
3. Fetch access control roles to validate role names
4. Convert Excel dates to Unix timestamps (handles Date objects, ISO string dates, Excel serial numbers)
5. Create employees via `egov-hrms/employees/_create`

### Cross-Phase Dependencies

```
Phase 1 (Tenant) ──→ Phase 2 (Boundaries) ──→ Phase 3 (Masters) ──→ Phase 4 (Employees)
                                                    │                        ↑
                                                    └── deptNameToCode ──────┘
```

- Phase 3 produces `deptNameToCode` mapping used by Phase 4
- If Phase 3 is skipped, Phase 4 fetches existing department/designation codes from MDMS
- Each phase is independently skippable (provide only the files you need)

### Response Structure

```json
{
  "success": true,
  "tenant_id": "pg.newcity",
  "phases": {
    "tenant": {
      "status": "completed",
      "created": 1,
      "skipped": 0,
      "failed": 0,
      "localization_keys": 2
    },
    "boundaries": {
      "status": "completed",
      "message": "Boundary file processed via boundary management service",
      "entities_created": 12
    },
    "masters": {
      "status": "completed",
      "departments": { "created": 5, "exists": 0, "failed": 0 },
      "designations": { "created": 8, "exists": 0, "failed": 0 },
      "complaint_types": { "created": 12, "exists": 0, "failed": 0 },
      "localization_keys": 50
    },
    "employees": {
      "status": "completed",
      "rows": [
        { "name": "John Smith", "code": "JOHN_SMITH", "status": "created" },
        { "name": "Jane Doe", "code": "JANE_DOE", "status": "created" },
        { "name": "Bob Wilson", "code": "BOB_WILSON", "status": "failed", "error": "Mobile number already registered" }
      ],
      "created": 2,
      "failed": 1
    }
  }
}
```

### Error Handling

| Error | Handling |
|-------|----------|
| Auth not configured | Fail fast: "Must call configure first" |
| Invalid tenant_id format | Fail fast: "tenant_id must contain a dot (e.g., pg.newcity)" |
| File not found (local path) | Fail fast per-phase with clear message |
| FileStoreId download fails | Fail fast per-phase |
| Sheet not found in xlsx | Fail fast per-phase: "Expected sheet 'Tenant Info' not found in file" |
| Missing required column | Fail fast per-phase: "Required column 'Department Name*' not found" |
| Row-level API error (duplicate) | Mark row as `exists`, continue processing |
| Row-level API error (validation) | Mark row as `failed` with extracted error message, continue |
| Row-level API error (auth/500) | Mark row as `failed`, continue (don't abort entire phase) |
| Phase failure | Report phase status as `failed`, continue to next phase if independent |

### Code Organization

| File | Purpose |
|------|---------|
| `src/utils/xlsx-reader.ts` | TypeScript port of CCRS `UnifiedExcelReader`. Sheet parsing, code auto-generation, date conversion, name→code mapping. |
| `src/utils/xlsx-loader.ts` | Phase orchestrator. Sequences phases, manages cross-phase state (`deptNameToCode`), calls `DigitApiClient` methods. |
| `src/tools/mdms-tenant.ts` | Tool registration for `city_setup_from_xlsx`. Calls into xlsx-loader. |

### npm Dependency

- `exceljs` — xlsx parsing library. Well-maintained, no native deps, supports streaming for large files. Already widely used in Node.js ecosystem.

---

## Scope Boundaries

**In scope:**
- Feature 1: `base_url`/`username`/`password` on `configure`, service probing, ad-hoc environment
- Feature 2: `city_setup_from_xlsx` tool with 4-phase xlsx processing, CCRS-compatible format

**Out of scope:**
- Persisting discovered environments across sessions (can be added later)
- Writing status columns back to xlsx files
- New xlsx template format (CCRS format only)
- Boundary hierarchy creation (Phase 2 delegates to existing boundary management service)
- Logo file upload in Phase 1 (requires separate file handling; logo path stored as-is)

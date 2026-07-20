# pgr_create

> Create a new PGR complaint/service request for a tenant, with citizen details and locality.

**Group:** `pgr` | **Risk:** `write` | **DIGIT Service:** `pgr-services`

## Description

Creates a new complaint in the PGR (Public Grievance Redressal) system. The complaint is filed against a city-level tenant (e.g. `"pg.citya"`) with a service code identifying the complaint type, a free-text description, an address containing a boundary locality code, and the citizen's name and mobile number.

Any user with an `EMPLOYEE`, `CITIZEN`, or `CSR` role can create complaints -- you do not need to re-authenticate as a citizen. The ADMIN user created by `tenant_bootstrap` already has the `EMPLOYEE` role and can create complaints on any tenant. The tool pre-creates the citizen user with password-based authentication (type `EMPLOYEE` with `CITIZEN` role) so they can later log in for REOPEN and RATE actions. If a user with the given mobile number already exists, it reuses that user. The response includes `citizenLogin` credentials for the citizen.

When creation fails, the tool provides targeted diagnostic hints. A missing workflow definition produces a suggestion to call `workflow_create`. Role or authorization errors include cross-tenant analysis and suggest `user_role_add` or `employee_create`. Generic failures include a checklist covering workflow, service codes, locality codes, and tenant level.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | City-level tenant ID (e.g. `"pg.citya"`, `"tenant.coimbatore"`) |
| `service_code` | string | yes | -- | Complaint type code (e.g. `"StreetLightNotWorking"`). Use `validate_complaint_types` to list valid codes. |
| `description` | string | yes | -- | Free-text description of the complaint |
| `address` | object | yes | -- | Address object (see schema below) |
| `citizen_name` | string | yes | -- | Full name of the citizen filing the complaint |
| `citizen_mobile` | string | yes | -- | Mobile number (10 digits) of the citizen |

### Address Object Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `locality` | object | yes | Must contain a `code` field with a valid boundary locality code (use `validate_boundary` to find codes) |
| `locality.code` | string | yes | Boundary locality code (e.g. `"LOC_CITYA_1"`) |
| `city` | string | no | City name (informational) |

## Response

```json
{
  "success": true,
  "message": "Complaint created: PB-PGR-2026-01-15-000123",
  "complaint": {
    "serviceRequestId": "PB-PGR-2026-01-15-000123",
    "serviceCode": "StreetLightNotWorking",
    "status": "PENDINGFORASSIGNMENT",
    "tenantId": "pg.citya"
  },
  "citizenLogin": {
    "username": "9876543210",
    "password": "eGov@123",
    "loginTenantId": "pg",
    "note": "Use these credentials with configure to authenticate as the citizen for RATE or REOPEN actions."
  }
}
```

Error response with diagnostic hint:

```json
{
  "success": false,
  "error": "BusinessService not found for PGR",
  "hint": "PGR workflow is not registered for tenant \"tenant.city1\". FIX: Call workflow_create with tenant_id=\"tenant.city1\" and copy_from_tenant=\"pg.citya\" to register the PGR state machine. Then retry pgr_create.",
  "alternatives": [
    { "tool": "workflow_create", "purpose": "Register PGR workflow for tenant.city1" }
  ]
}
```

## Examples

### Basic Usage

Create a street light complaint:

```
pgr_create({
  tenant_id: "pg.citya",
  service_code: "StreetLightNotWorking",
  description: "Street light outside Block 5 has been off for two weeks",
  address: {
    locality: { code: "LOC_CITYA_1" },
    city: "citya"
  },
  citizen_name: "Ramesh Kumar",
  citizen_mobile: "9876543210"
})
```

### Pre-flight Validation

Verify complaint types and boundaries before creating:

```
// Step 1: Check valid service codes
validate_complaint_types({ tenant_id: "pg.citya" })

// Step 2: Check valid locality codes
validate_boundary({ tenant_id: "pg.citya" })

// Step 3: Create the complaint
pgr_create({
  tenant_id: "pg.citya",
  service_code: "GarbageNotCollected",
  description: "Garbage has not been collected for three days on Main Street",
  address: { locality: { code: "LOC_CITYA_1" } },
  citizen_name: "Priya Sharma",
  citizen_mobile: "9988776655"
})
```

### Full Lifecycle Setup

After creating a complaint, use the returned citizenLogin for citizen actions:

```
// Step 1: Create the complaint (as ADMIN)
pgr_create({ ... })
// Returns: citizenLogin: { username: "9876543210", password: "eGov@123", loginTenantId: "pg" }

// Step 2: ASSIGN the complaint (as GRO employee)
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "ASSIGN",
  assignees: ["employee-uuid-here"]
})

// Step 3: RESOLVE the complaint (as LME employee)
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "RESOLVE",
  comment: "Fixed the street light"
})

// Step 4: RATE the complaint (as citizen -- re-authenticate first)
configure({ username: "9876543210", password: "eGov@123", tenant_id: "pg" })
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "RATE",
  rating: 5,
  comment: "Good service"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `BusinessService not found` | PGR workflow not registered for this tenant | Call `workflow_create` with `copy_from_tenant: "pg"` to register the state machine |
| Role / authorization error (same tenant) | User lacks EMPLOYEE/CITIZEN/CSR role | Call `user_role_add` to add missing roles, then re-authenticate with `configure` |
| Role / authorization error (cross-tenant) | User authenticated on different tenant root | Create an employee on the target tenant with `employee_create`, then `configure` as that employee |
| Invalid service code | Service code not in MDMS | Verify with `validate_complaint_types` |
| Invalid locality code | Boundary code not found | Verify with `validate_boundary` |
| Tenant-level mismatch | Using root tenant (e.g. `"pg"`) instead of city-level | Use city tenant like `"pg.citya"` |

## See Also

- [validate_complaint_types](validate_complaint_types.md) -- list valid service codes for PGR complaints
- [validate_boundary](validate_boundary.md) -- find valid locality boundary codes for the address
- [pgr_update](pgr_update.md) -- advance a complaint through its workflow (ASSIGN, RESOLVE, RATE, etc.)
- [configure](configure.md) -- authenticate or re-authenticate (needed for citizen actions like RATE)
- [Guide: PGR Lifecycle](../../guides/pgr-lifecycle.md) -- end-to-end walkthrough of the complaint lifecycle

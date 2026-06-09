# mdms_search

> Search MDMS v2 records by schema code, returning the data field of each matching record.

**Group:** `mdms` | **Risk:** `read` | **DIGIT Service:** `egov-mdms-service`

## Description

Queries the MDMS v2 API for records under a specific schema code and tenant. Returns the `data` payload, `uniqueIdentifier`, and `isActive` flag for each record. Supports pagination via `limit` and `offset`, and filtering by specific unique identifiers.

This is the primary read tool for all master data in DIGIT. Every configurable entity -- departments, designations, complaint types, roles, employee statuses, ID formats, tenant records -- is stored as an MDMS record under a schema code. The schema code follows the pattern `"module.MasterName"` (e.g. `"common-masters.Department"`).

MDMS records are scoped to a tenant root. A city-level tenant like `"pg.citya"` inherits records from its state root `"pg"`. When searching, use the state root tenant ID to find shared master data, or the city tenant ID if records are city-specific.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search in (e.g. `"pg"`, `"pg.citya"`) |
| `schema_code` | string | yes | -- | MDMS schema code (see common schemas below) |
| `unique_identifiers` | string[] | no | -- | Filter to specific record identifiers |
| `limit` | number | no | `100` | Maximum records to return |
| `offset` | number | no | `0` | Pagination offset |

### Common Schema Codes

| Alias | Schema Code | Contains |
|-------|-------------|----------|
| DEPARTMENT | `common-masters.Department` | Department codes and names |
| DESIGNATION | `common-masters.Designation` | Designation codes and names |
| GENDER_TYPE | `common-masters.GenderType` | Gender options (MALE, FEMALE, TRANSGENDER) |
| EMPLOYEE_STATUS | `egov-hrms.EmployeeStatus` | EMPLOYED, RETIRED, etc. |
| EMPLOYEE_TYPE | `egov-hrms.EmployeeType` | PERMANENT, TEMPORARY, etc. |
| ROLES | `ACCESSCONTROL-ROLES.roles` | All platform role definitions |
| PGR_SERVICE_DEFS | `RAINMAKER-PGR.ServiceDefs` | PGR complaint type definitions |
| TENANT | `tenant.tenants` | Tenant registrations |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "schemaCode": "common-masters.Department",
  "count": 3,
  "records": [
    {
      "uniqueIdentifier": "DEPT_1",
      "data": {
        "code": "DEPT_1",
        "name": "Street Lighting Department",
        "active": true
      },
      "isActive": true
    },
    {
      "uniqueIdentifier": "DEPT_2",
      "data": {
        "code": "DEPT_2",
        "name": "Building & Roads Department",
        "active": true
      },
      "isActive": true
    },
    {
      "uniqueIdentifier": "DEPT_25",
      "data": {
        "code": "DEPT_25",
        "name": "Health & Sanitation",
        "active": true
      },
      "isActive": true
    }
  ]
}
```

## Examples

### Basic Usage

List all departments for a tenant:

```
mdms_search({
  tenant_id: "pg",
  schema_code: "common-masters.Department"
})
```

### Filter by Specific Identifiers

Look up a single complaint type by its unique identifier:

```
mdms_search({
  tenant_id: "pg",
  schema_code: "RAINMAKER-PGR.ServiceDefs",
  unique_identifiers: ["StreetLightNotWorking"]
})
```

### Paginated Search

Fetch roles in pages of 50:

```
mdms_search({
  tenant_id: "pg",
  schema_code: "ACCESSCONTROL-ROLES.roles",
  limit: 50,
  offset: 0
})
```

### Advanced Usage

Verify a record exists before creating it (used internally by `mdms_create`):

```
mdms_search({
  tenant_id: "tenant",
  schema_code: "common-masters.IdFormat",
  unique_identifiers: ["pgr.servicerequestid"]
})
// If count is 0, safe to create
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| Empty `records` array | No data for this schema/tenant | Check the tenant root has data -- use `tenant_bootstrap` to copy from `"pg"` |
| `count: 0` with valid schema | Schema exists but has no records | Create records with `mdms_create` or run `tenant_bootstrap` |

## See Also

- [mdms_create](mdms_create.md) -- create a new MDMS record (verify with `mdms_search` first)
- [mdms_schema_search](mdms_schema_search.md) -- list registered schema definitions for a tenant

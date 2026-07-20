# mdms_schema_search

> Search MDMS v2 schema definitions registered for a tenant, showing what schemas are available.

**Group:** `mdms` | **Risk:** `read` | **DIGIT Service:** `egov-mdms-service`

## Description

Queries the MDMS v2 schema definition API to list all schemas registered under a given tenant. Schema definitions live at the state-level root tenant (e.g. `"pg"`, `"tenant"`) and define the JSON Schema structure that data records must conform to. City-level tenants inherit schemas from their root.

This tool is essential for diagnosing `"Schema definition not found"` errors from `mdms_create`. If a create operation fails with this error, use `mdms_schema_search` to check whether the schema is registered under the correct tenant root. You can then copy the missing schema from a working tenant using `mdms_schema_create` with the `copy_from_tenant` parameter.

Each schema entry includes the code (e.g. `"common-masters.Department"`), a human-readable description, the tenant it belongs to, and its active status. You can optionally filter by specific schema codes.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search schemas for (typically the state-level root, e.g. `"pg"`, `"statea"`, `"tenant"`) |
| `codes` | string[] | no | -- | Filter to specific schema codes (e.g. `["RAINMAKER-PGR.ServiceDefs"]`) |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "count": 25,
  "schemas": [
    {
      "code": "common-masters.Department",
      "description": "common-masters.Department",
      "tenantId": "pg",
      "isActive": true
    },
    {
      "code": "common-masters.Designation",
      "description": "common-masters.Designation",
      "tenantId": "pg",
      "isActive": true
    },
    {
      "code": "RAINMAKER-PGR.ServiceDefs",
      "description": "RAINMAKER-PGR.ServiceDefs",
      "tenantId": "pg",
      "isActive": true
    }
  ]
}
```

## Examples

### Basic Usage

List all schemas on the default root tenant:

```
mdms_schema_search({ tenant_id: "pg" })
```

### Filter by Specific Schema

Check if PGR service definitions schema exists on a new tenant:

```
mdms_schema_search({
  tenant_id: "tenant",
  codes: ["RAINMAKER-PGR.ServiceDefs"]
})
// If count is 0, the schema needs to be created before PGR data can be added
```

### Advanced Usage

Compare schemas between two tenant roots to find what is missing:

```
// Step 1: Get schemas from the source
mdms_schema_search({ tenant_id: "pg" })
// Returns 25 schemas

// Step 2: Get schemas from the target
mdms_schema_search({ tenant_id: "tenant" })
// Returns 10 schemas -- 15 are missing

// Step 3: Copy missing schemas with mdms_schema_create
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `count: 0` | No schemas registered for this tenant | Run `tenant_bootstrap` to copy all schemas from `"pg"` |
| API error | MDMS service unreachable | Check service health with `health_check` |

## See Also

- [mdms_schema_create](mdms_schema_create.md) -- register a new schema definition (or copy one from another tenant)

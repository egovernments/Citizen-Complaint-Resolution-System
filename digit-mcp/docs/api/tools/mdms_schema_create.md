# mdms_schema_create

> Register a new MDMS v2 schema definition at a state-level root tenant.

**Group:** `mdms` | **Risk:** `write` | **DIGIT Service:** `egov-mdms-service`

## Description

Registers a JSON Schema definition for a given schema code under a tenant root. Schema definitions must exist at the state-level root (e.g. `"pg"`, `"tenant"`) before any data records can be created with `mdms_create`. City-level tenants (e.g. `"pg.citya"`) inherit schemas from their root automatically.

The easiest way to create a schema is to copy it from an existing tenant using the `copy_from_tenant` parameter. This fetches the full JSON Schema definition from the source tenant and registers it on the target. If `copy_from_tenant` is provided, the `definition` parameter is ignored.

Alternatively, you can provide a custom JSON Schema `definition` object directly. The definition must include `"type"` and `"properties"`, and optionally `"required"` and `"x-unique"` (which controls the unique identifier for deduplication).

If the schema already exists (duplicate), the tool returns a success response with `alreadyExists: true` instead of throwing an error. This makes it safe for idempotent operations.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to register the schema under (state-level root, e.g. `"tenant"`, `"statea"`) |
| `code` | string | yes | -- | Schema code (e.g. `"RAINMAKER-PGR.ServiceDefs"`, `"common-masters.Department"`) |
| `description` | string | no | same as `code` | Human-readable description of the schema |
| `definition` | object | no | -- | JSON Schema definition object. Required if `copy_from_tenant` is not provided |
| `copy_from_tenant` | string | no | -- | Copy the schema definition from this tenant (e.g. `"pg"`). Overrides `definition` |

## Response

Newly created schema:

```json
{
  "success": true,
  "message": "Schema \"RAINMAKER-PGR.ServiceDefs\" registered for tenant \"tenant\"",
  "schema": {
    "id": "a1b2c3d4-...",
    "tenantId": "tenant",
    "code": "RAINMAKER-PGR.ServiceDefs",
    "isActive": true
  }
}
```

Already exists:

```json
{
  "success": true,
  "message": "Schema \"RAINMAKER-PGR.ServiceDefs\" already exists for tenant \"tenant\"",
  "alreadyExists": true
}
```

## Examples

### Basic Usage

Copy a schema from the reference tenant `"pg"`:

```
mdms_schema_create({
  tenant_id: "tenant",
  code: "common-masters.Department",
  copy_from_tenant: "pg"
})
```

### Copy PGR Service Definitions

Enable PGR complaint types on a new tenant root:

```
mdms_schema_create({
  tenant_id: "ke",
  code: "RAINMAKER-PGR.ServiceDefs",
  copy_from_tenant: "pg"
})
```

### Advanced Usage

Register a custom schema with a JSON Schema definition:

```
mdms_schema_create({
  tenant_id: "tenant",
  code: "custom-module.MyMaster",
  description: "Custom master data for my module",
  definition: {
    "type": "object",
    "properties": {
      "code": { "type": "string" },
      "name": { "type": "string" },
      "active": { "type": "boolean" }
    },
    "required": ["code", "name"],
    "x-unique": ["code"]
  }
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Schema "X" not found in tenant "Y"` | Source tenant does not have this schema (when using `copy_from_tenant`) | Use `mdms_schema_search` on the source tenant to list available schemas |
| `Either "definition" or "copy_from_tenant" must be provided` | Neither parameter was given | Provide a `definition` object or set `copy_from_tenant` to an existing tenant like `"pg"` |
| `Not authenticated` | No active session | Call `configure` first |
| `DUPLICATE` / `already exists` | Schema already registered | Handled gracefully -- returns `alreadyExists: true` |

## See Also

- [tenant_bootstrap](tenant_bootstrap.md) -- copies ALL schemas and essential data in one call (recommended for new tenant roots)
- [mdms_schema_search](mdms_schema_search.md) -- list registered schemas to verify what exists

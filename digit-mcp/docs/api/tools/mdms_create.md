# mdms_create

> Create a new MDMS v2 record under a specific schema code and tenant.

**Group:** `mdms` | **Risk:** `write` | **DIGIT Service:** `egov-mdms-service`

## Description

Creates a new master data record in MDMS v2. Each record belongs to a schema code (e.g. `"common-masters.Department"`) and is identified by a unique identifier (typically the `code` field of the data payload). The schema definition must already exist at the state-level root tenant before records can be created.

Before creating, the tool checks whether a record with the same unique identifier already exists. If an active record is found, it returns a success response with `alreadyExisted: true` instead of throwing a duplicate error. If an inactive record is found (e.g. previously soft-deleted by `tenant_cleanup`), it reactivates the record via the MDMS v2 `_update` API and returns `reactivated: true`. This makes the tool safe for idempotent operations.

When creation fails because the schema definition is missing, the error response includes a specific hint directing you to either run `tenant_bootstrap` (to copy all schemas from `"pg"`) or use `mdms_schema_create` to register the individual schema.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to create the record in (e.g. `"pg"`, `"tenant"`) |
| `schema_code` | string | yes | -- | MDMS schema code (e.g. `"common-masters.Department"`) |
| `unique_identifier` | string | yes | -- | Unique identifier for the record (usually the `code` field value) |
| `data` | object | yes | -- | The data payload matching the schema definition |

## Response

Newly created record:

```json
{
  "success": true,
  "message": "Created MDMS record: DEPT_99",
  "record": {
    "id": "a1b2c3d4-...",
    "tenantId": "pg",
    "schemaCode": "common-masters.Department",
    "uniqueIdentifier": "DEPT_99",
    "data": {
      "code": "DEPT_99",
      "name": "Parks Department",
      "active": true
    },
    "isActive": true
  }
}
```

Duplicate (already active):

```json
{
  "success": true,
  "message": "Record already exists and is active: DEPT_1",
  "alreadyExisted": true,
  "record": { ... }
}
```

Reactivated (was inactive):

```json
{
  "success": true,
  "message": "Reactivated inactive record: DEPT_1",
  "reactivated": true,
  "record": { ... }
}
```

## Examples

### Basic Usage

Create a new department:

```
mdms_create({
  tenant_id: "pg",
  schema_code: "common-masters.Department",
  unique_identifier: "DEPT_99",
  data: {
    "code": "DEPT_99",
    "name": "Parks Department",
    "active": true
  }
})
```

### Create a PGR Complaint Type

Add a new service definition for PGR complaints:

```
mdms_create({
  tenant_id: "pg",
  schema_code: "RAINMAKER-PGR.ServiceDefs",
  unique_identifier: "PotholeOnRoad",
  data: {
    "serviceCode": "PotholeOnRoad",
    "serviceName": "Pothole on Road",
    "department": "DEPT_2",
    "slaHours": 72,
    "menuPath": "Complaints",
    "active": true
  }
})
```

### Advanced Usage

Create a tenant record for a new city (normally done by `city_setup`):

```
mdms_create({
  tenant_id: "pg",
  schema_code: "tenant.tenants",
  unique_identifier: "Tenant.pg.newcity",
  data: {
    "code": "pg.newcity",
    "name": "New City",
    "tenantId": "pg.newcity",
    "parent": "pg",
    "city": {
      "code": "NEWCITY",
      "name": "New City",
      "districtName": "pg"
    }
  }
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Schema definition ... not found` | Schema not registered for this tenant root | Run `tenant_bootstrap` with `target_tenant` set to the root, or call `mdms_schema_create` with `copy_from_tenant: "pg"` |
| `NON_UNIQUE` / `DUPLICATE` | Record already exists | The tool handles this gracefully -- you should see `alreadyExisted: true` |
| `Not authenticated` | No active session | Call `configure` first |
| `MDMS create failed` | Generic failure | Check that the tenant root has all required schemas via `mdms_schema_search` |

## See Also

- [mdms_search](mdms_search.md) -- verify a record does not already exist before creating
- [tenant_bootstrap](tenant_bootstrap.md) -- pre-creates all essential MDMS data and schemas for a new tenant root

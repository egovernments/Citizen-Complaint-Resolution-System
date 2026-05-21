# city_setup

> Set up a city-level tenant under an existing root with everything needed for PGR: tenant record, ADMIN user, workflows, and boundary hierarchy.

**Group:** `mdms` | **Risk:** `write` | **DIGIT Service:** multiple (egov-mdms-service, user-otp, egov-workflow-v2, boundary-service)

## Description

Creates a fully operational city-level tenant in a single call. This is the second step after `tenant_bootstrap` -- the root must already exist with schemas and master data before cities can be added. The tool validates the city tenant ID format (must contain a dot, e.g. `"pg.newcity"`), then executes five steps:

1. **Validate root tenant** -- confirms the state root (e.g. `"pg"`) exists in MDMS. If not, returns an error directing you to run `tenant_bootstrap` first.

2. **Create city tenant record** -- registers the city in MDMS under `tenant.tenants` with city metadata (code, name, district). Handles duplicates and reactivates inactive records.

3. **Provision dual-scoped ADMIN user** -- ensures the ADMIN user has roles scoped to both the root tenant and the city tenant. Creates a new user on the city tenant if needed, or adds missing roles to an existing user. Standard roles provisioned: EMPLOYEE, CITIZEN, CSR, GRO, PGR_LME, DGRO, SUPERUSER, INTERNAL_MICROSERVICE_ROLE.

4. **Copy workflow definitions** -- copies PGR and other workflow state machines to the root tenant (workflows are stored at the root level). Falls back to copying from `"pg"` if the root has no workflows yet.

5. **Create boundary hierarchy** (optional, default: true) -- creates a full ADMIN boundary hierarchy (Country > State > District > City > Ward > Locality) on both the root and city tenants, then creates boundary entities and parent-child relationships. Generates one Ward and one Locality per locality code.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | City tenant ID, must contain a dot (e.g. `"pg.newcity"`, `"ke.nairobi"`) |
| `city_name` | string | yes | -- | Human-readable city name (e.g. `"New City"`, `"Nairobi"`) |
| `source_tenant` | string | no | root tenant, falls back to `"pg"` | Source tenant for workflow definition copy |
| `create_boundaries` | boolean | no | `true` | Whether to create the default boundary hierarchy and entities |
| `locality_codes` | string[] | no | auto-generated `["LOC_<CITYCODE>_1"]` | Custom locality boundary codes |

## Response

```json
{
  "success": true,
  "cityTenant": "pg.newcity",
  "root": "pg",
  "steps": {
    "tenantRecord": "created",
    "adminUser": {
      "provisioned": true,
      "dualScoped": true,
      "rolesAdded": 16
    },
    "workflow": {
      "created": [],
      "skipped": ["PGR", "PT.CREATE"],
      "failed": []
    },
    "boundaries": {
      "hierarchyReused": true,
      "entitiesCreated": 6,
      "localityCodes": ["LOC_NEWCITY_1"]
    }
  },
  "nextSteps": [
    "Create employees: employee_create with tenant_id=\"pg.newcity\"",
    "Verify setup: validate_complaint_types, validate_employees with tenant_id=\"pg.newcity\"",
    "Create complaints: pgr_create with tenant_id=\"pg.newcity\""
  ]
}
```

## Examples

### Basic Usage

Create a city with default boundaries:

```
city_setup({
  tenant_id: "pg.newcity",
  city_name: "New City"
})
```

### Custom Locality Codes

Provide specific locality codes for the boundary hierarchy:

```
city_setup({
  tenant_id: "pg.downtown",
  city_name: "Downtown",
  locality_codes: ["LOC_DT_NORTH", "LOC_DT_SOUTH", "LOC_DT_CENTRAL"]
})
// Creates 3 wards and 3 localities
```

### Skip Boundary Creation

Set up only the tenant record, user, and workflows (boundaries will be created separately):

```
city_setup({
  tenant_id: "mz.chimoio",
  city_name: "Chimoio",
  create_boundaries: false
})
// Then use boundary_create with real-world boundary data
```

### Advanced Usage

Full setup under a non-default root with explicit workflow source:

```
// Step 1: Bootstrap the root (if not done already)
tenant_bootstrap({ target_tenant: "mz" })

// Step 2: Set up the city
city_setup({
  tenant_id: "mz.chimoio",
  city_name: "Chimoio",
  source_tenant: "pg",
  locality_codes: ["LOC_CHIMOIO_CENTRO", "LOC_CHIMOIO_NORTE"]
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `tenant_id "X" must be a city-level ID containing a dot` | Root-level tenant ID passed | Use `tenant_bootstrap` for state roots; `city_setup` requires a dot (e.g. `"pg.newcity"`) |
| `Root tenant "X" not found` | Root has not been bootstrapped | Run `tenant_bootstrap` with `target_tenant` set to the root first |
| `Failed to create city tenant record` | MDMS create error | Check that the root has the `tenant.tenants` schema via `mdms_schema_search` |
| `adminUser.error` | User provisioning failed | Use `user_create` or `user_role_add` manually |
| `boundaries.error` | Boundary API failure | Use `boundary_create` manually to set up boundaries |

## See Also

- [tenant_bootstrap](tenant_bootstrap.md) -- required first step: bootstrap the state-level root tenant
- [validate_boundary](validate_boundary.md) -- verify the boundary hierarchy was created correctly
- [tenant_cleanup](tenant_cleanup.md) -- tear down a test city tenant

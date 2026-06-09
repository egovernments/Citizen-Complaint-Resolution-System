# validate_boundary

> Validate boundary setup for a tenant by checking that a boundary hierarchy exists and boundaries are defined.

**Group:** `boundary` | **Risk:** `read` | **DIGIT Service:** `boundary-service`

## Description

The `validate_boundary` tool checks whether a tenant has a properly configured boundary hierarchy. It is the primary read-only tool for inspecting boundary data and is available in all DIGIT environments (unlike the `boundary_mgmt_*` tools which depend on the `egov-bndry-mgmnt` service).

Internally, the tool first calls `boundaryRelationshipTreeSearch` to fetch the full parent-child boundary tree. If no tree is found, it falls back to `boundarySearch` to check whether flat boundary entities exist without relationships. The response counts nodes recursively through the tree and issues a warning if fewer than 2 nodes are found, since a typical setup includes multiple levels (state, district, city, ward, locality).

Use this tool before creating PGR complaints (to find locality codes for the address), before creating employees (to find jurisdiction boundary codes), and as a general health check after running `boundary_create` or `city_setup`.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to validate boundaries for (e.g. `"pg.citya"`). |
| `hierarchy_type` | string | no | `"ADMIN"` | Boundary hierarchy type to check. Most DIGIT setups use `"ADMIN"`. |

## Response

Returns a JSON object containing a `ValidationResult` with errors, warnings, and a summary.

```json
{
  "success": true,
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": [],
    "summary": "Found 1 boundary tree(s) with 8 total node(s) for hierarchy \"ADMIN\""
  }
}
```

When boundaries are missing entirely:

```json
{
  "success": true,
  "validation": {
    "valid": false,
    "errors": [
      {
        "field": "boundary",
        "message": "No boundaries found for tenant \"pg.citya\" with hierarchy type \"ADMIN\"",
        "code": "BOUNDARY_MISSING"
      }
    ],
    "warnings": [],
    "summary": ""
  }
}
```

When flat entities exist but no relationship tree has been created:

```json
{
  "success": true,
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": [
      {
        "field": "boundary",
        "message": "Found 5 boundary entities but no relationship tree. Boundaries may need relationships created."
      }
    ],
    "summary": "Found 5 boundary entity/entities but no relationship tree for hierarchy \"ADMIN\""
  }
}
```

## Examples

### Basic Usage

Validate boundaries for a city tenant using the default ADMIN hierarchy:

```
Tool: validate_boundary
Args: {
  "tenant_id": "pg.citya"
}
```

### Advanced Usage -- custom hierarchy type

Check a revenue hierarchy instead of the default admin hierarchy:

```
Tool: validate_boundary
Args: {
  "tenant_id": "pg.citya",
  "hierarchy_type": "REVENUE"
}
```

### Workflow: verify after creating boundaries

After running `boundary_create`, confirm the boundaries are visible:

```
Tool: boundary_create
Args: { "tenant_id": "pg.citya", "boundaries": [...] }

Tool: validate_boundary
Args: { "tenant_id": "pg.citya" }
// Expect: "Found 1 boundary tree(s) with N total node(s)"
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `BOUNDARY_MISSING` | No boundaries found for the tenant and hierarchy type. | Create boundaries with `boundary_create` or `city_setup`. |
| `BOUNDARY_API_ERROR` | The boundary-service API call failed (network, auth, or service down). | Check that DIGIT services are running and you are authenticated via `configure`. |
| Warning: `Only N boundary node(s) found` | Fewer than 2 nodes in the tree. | A minimal setup needs at least a city and one locality. Use `boundary_create` to add more levels. |
| Warning: `Found N boundary entities but no relationship tree` | Entities exist but parent-child relationships were not created. | Run `boundary_create` with the same boundaries to create the relationships. |

## See Also

- [boundary_hierarchy_search](boundary_hierarchy_search.md) -- view hierarchy level definitions (Country > State > City, etc.)
- [boundary_create](boundary_create.md) -- create boundary hierarchy, entities, and relationships
- [Guide: City Setup](../../guides/city-setup.md) -- end-to-end guide for setting up a new city tenant

# boundary_hierarchy_search

> Search boundary hierarchy definitions for a tenant to see what boundary levels exist.

**Group:** `boundary` | **Risk:** `read` | **DIGIT Service:** `boundary-service`

## Description

The `boundary_hierarchy_search` tool queries the boundary-service for hierarchy type definitions. A hierarchy definition describes the levels (types) of boundaries and their nesting order -- for example, Country > State > District > City > Ward > Locality. Each level has a `boundaryType` and a `parentBoundaryType` that together form a linked chain from root to leaf.

This tool is useful for understanding the boundary structure before creating new boundaries or validating existing ones. It answers the question "what levels of boundaries does this tenant support?" without returning any actual boundary data. To see the boundary data itself (codes, parent-child tree), use `validate_boundary` instead.

If the hierarchy does not exist yet for the tenant, the tool returns an empty list. You can create a hierarchy definition by passing the `hierarchy_definition` parameter to `boundary_create`, or by using `city_setup` which creates one automatically.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search hierarchy for (e.g. `"pg.citya"` or `"pg"`). |
| `hierarchy_type` | string | no | -- | Filter by hierarchy type (e.g. `"ADMIN"`). Omit to list all hierarchies defined for the tenant. |

## Response

Returns a JSON object with the list of hierarchy definitions found.

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "count": 1,
  "hierarchies": [
    {
      "id": "some-uuid",
      "tenantId": "pg.citya",
      "hierarchyType": "ADMIN",
      "boundaryHierarchy": [
        {
          "boundaryType": "Country",
          "parentBoundaryType": null,
          "active": true
        },
        {
          "boundaryType": "State",
          "parentBoundaryType": "Country",
          "active": true
        },
        {
          "boundaryType": "District",
          "parentBoundaryType": "State",
          "active": true
        },
        {
          "boundaryType": "City",
          "parentBoundaryType": "District",
          "active": true
        },
        {
          "boundaryType": "Ward",
          "parentBoundaryType": "City",
          "active": true
        },
        {
          "boundaryType": "Locality",
          "parentBoundaryType": "Ward",
          "active": true
        }
      ]
    }
  ]
}
```

When no hierarchy exists:

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "count": 0,
  "hierarchies": []
}
```

On failure:

```json
{
  "success": false,
  "error": "Request failed with status 500: Internal Server Error",
  "hint": "Boundary hierarchy search failed. Use validate_boundary as an alternative to see the boundary tree for a tenant.",
  "alternatives": [
    {
      "tool": "validate_boundary",
      "purpose": "Validate and view boundary tree for a tenant"
    }
  ]
}
```

## Examples

### Basic Usage

Search for the ADMIN hierarchy on a specific tenant:

```
Tool: boundary_hierarchy_search
Args: {
  "tenant_id": "pg.citya",
  "hierarchy_type": "ADMIN"
}
```

### Advanced Usage -- list all hierarchies

Omit the `hierarchy_type` to discover all hierarchy types defined for a tenant:

```
Tool: boundary_hierarchy_search
Args: {
  "tenant_id": "pg.citya"
}
```

This is useful when you are unsure whether the tenant uses "ADMIN", "REVENUE", or another hierarchy type.

### Workflow: check before creating boundaries

Before calling `boundary_create`, verify whether a hierarchy already exists so you know whether to pass `hierarchy_definition`:

```
Tool: boundary_hierarchy_search
Args: { "tenant_id": "pg.citya", "hierarchy_type": "ADMIN" }
// If count is 0, you must provide hierarchy_definition to boundary_create
// If count is 1, boundary_create can reuse the existing hierarchy
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| API error / 500 | The boundary-service failed to process the request. | Verify the DIGIT environment is running. Use `validate_boundary` as a fallback. |
| Empty result (count: 0) | No hierarchy has been defined for this tenant/hierarchy type combination. | Create one via `boundary_create` with the `hierarchy_definition` parameter, or use `city_setup`. |
| Not authenticated | `configure` was not called before this tool. | Call `configure` to log in first. |

## See Also

- [validate_boundary](validate_boundary.md) -- validate and view the actual boundary tree (nodes, parent-child relationships)
- [boundary_create](boundary_create.md) -- create hierarchy definitions and boundary entities

# location_search

> Search geographic boundaries using the legacy egov-location service.

**Group:** `location` | **Risk:** `read` | **DIGIT Service:** `egov-location`

## Description

Queries the legacy `egov-location` service for geographic boundary records. This service predates the newer boundary-service and is not available in all DIGIT environments. It returns boundary entities filtered by type and hierarchy.

For most use cases, `validate_boundary` (which queries `boundary-service`) is the recommended alternative. The boundary-service is available in all environments, provides richer hierarchy information, and is the service used by PGR and other modern DIGIT modules. Use `location_search` only when you specifically need to interact with the legacy location service or when troubleshooting environments that still rely on it.

The legacy location service organizes boundaries by hierarchy type (e.g. `ADMIN`, `REVENUE`) and boundary type (e.g. `City`, `Ward`, `Block`). Results include boundary codes, names, and parent-child relationships.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search boundaries for (e.g. `"pg.citya"`) |
| `boundary_type` | string | no | -- | Filter by boundary type (e.g. `"City"`, `"Ward"`, `"Block"`) |
| `hierarchy_type` | string | no | -- | Filter by hierarchy type (e.g. `"ADMIN"`, `"REVENUE"`) |

## Response

Returns boundary records matching the search criteria.

```json
{
  "TenantBoundary": [
    {
      "hierarchyType": {
        "code": "ADMIN",
        "name": "ADMIN"
      },
      "boundary": {
        "id": "1",
        "boundaryNum": 1,
        "name": "City A",
        "code": "pg.citya",
        "children": [
          {
            "name": "Ward 1",
            "code": "WARD_1",
            "boundaryType": "Ward",
            "children": []
          }
        ]
      }
    }
  ]
}
```

## Examples

### Basic Usage

Search all boundaries for a tenant:

```
location_search({
  tenant_id: "pg.citya"
})
```

### Filter by Type

Search only ward-level boundaries:

```
location_search({
  tenant_id: "pg.citya",
  boundary_type: "Ward",
  hierarchy_type: "ADMIN"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Authentication required | Not logged in | Call `configure` first |
| Service unavailable | `egov-location` is not deployed in this environment | Use `validate_boundary` instead, which queries the newer boundary-service |
| No boundaries found | Tenant has no boundary data in the legacy service | Boundaries may exist in boundary-service but not in egov-location; check with `validate_boundary` |

## See Also

- [validate_boundary](validate_boundary.md) -- recommended alternative using the modern boundary-service (available in all environments)

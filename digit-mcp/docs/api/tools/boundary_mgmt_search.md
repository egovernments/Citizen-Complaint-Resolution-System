# boundary_mgmt_search

> Search for previously processed boundary data uploads in the boundary management service.

**Group:** `boundary` | **Risk:** `read` | **DIGIT Service:** `egov-bndry-mgmnt`

## Description

The `boundary_mgmt_search` tool queries the `egov-bndry-mgmnt` service for resource details of boundary data that has been previously uploaded and processed via `boundary_mgmt_process`. It returns metadata about past boundary processing operations for a tenant, including file store IDs, action types, hierarchy types, and processing status.

This tool is part of the Excel-based boundary management pipeline. It does not return actual boundary hierarchy data (codes, parent-child trees). If you need to read the boundary tree for a tenant -- which is the more common use case -- use `validate_boundary` instead. The `validate_boundary` tool queries the boundary-service directly and is available in all DIGIT environments.

The `egov-bndry-mgmnt` service is not deployed in all environments. If it is unavailable, this tool will return an error with a hint suggesting `validate_boundary` as the alternative.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search boundary processes for (e.g. `"pg.citya"`). |

## Response

Returns a list of resource details for processed boundary uploads.

```json
{
  "success": true,
  "count": 1,
  "resources": [
    {
      "id": "some-uuid",
      "type": "boundary",
      "fileStoreId": "abc-123-def-456",
      "action": "create",
      "hierarchyType": "ADMIN",
      "tenantId": "pg.citya",
      "status": "completed"
    }
  ],
  "tenantId": "pg.citya"
}
```

When no processed data exists:

```json
{
  "success": true,
  "count": 0,
  "resources": [],
  "tenantId": "pg.citya"
}
```

On failure:

```json
{
  "success": false,
  "error": "Request failed with status 400: invalid path",
  "hint": "The egov-bndry-mgmnt service returned an error for this tenant. This typically means no boundary data has been uploaded/processed for this tenant via egov-bndry-mgmnt. To read existing boundary hierarchy data, use \"validate_boundary\" with the correct tenant ID instead. Use \"mdms_get_tenants\" to list tenants and find the correct tenant ID (e.g. pg.citya, statea.f).",
  "alternatives": [
    { "tool": "validate_boundary", "purpose": "Read boundary hierarchy from boundary-service (recommended)" },
    { "tool": "mdms_get_tenants", "purpose": "List available tenants to find correct tenant IDs" }
  ]
}
```

## Examples

### Basic Usage

Check whether any boundary data has been processed for a tenant:

```
Tool: boundary_mgmt_search
Args: {
  "tenant_id": "pg.citya"
}
```

### Workflow: verify processing before generating codes

Use this tool to confirm that `boundary_mgmt_process` completed successfully before calling `boundary_mgmt_generate`:

```
// Step 1: Check for processed data
Tool: boundary_mgmt_search
Args: { "tenant_id": "pg.citya" }
// Expect: count >= 1, status "completed"

// Step 2: If found, generate codes
Tool: boundary_mgmt_generate
Args: {
  "tenant_id": "pg.citya",
  "resource_details": {
    "type": "boundary",
    "hierarchyType": "ADMIN",
    "tenantId": "pg.citya"
  }
}
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid path` | The `egov-bndry-mgmnt` service is not available or the tenant has no processed data. | Use `validate_boundary` to read boundary data from boundary-service instead. |
| Service unavailable / 500 | The `egov-bndry-mgmnt` container is not running. | Check Docker container status. |
| Not authenticated | `configure` was not called. | Call `configure` to log in first. |

## See Also

- [validate_boundary](validate_boundary.md) -- recommended tool for reading boundary hierarchy data (works in all environments)
- [boundary_mgmt_process](boundary_mgmt_process.md) -- upload/process boundary data (the step before search)
- [boundary_mgmt_generate](boundary_mgmt_generate.md) -- generate boundary codes from processed data

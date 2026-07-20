# boundary_mgmt_download

> Download generated boundary code mappings from the boundary management service.

**Group:** `boundary` | **Risk:** `read` | **DIGIT Service:** `egov-bndry-mgmnt`

## Description

The `boundary_mgmt_download` tool retrieves the results of boundary code generation from the `egov-bndry-mgmnt` service. It is the final step in the Excel-based boundary management pipeline, called after `boundary_mgmt_generate` has completed. The tool returns resource details including file store IDs that can be used with `filestore_get_urls` to download the actual generated files.

This tool queries the boundary management service, not the boundary-service. It returns metadata about generated boundary code files, not the actual boundary tree. If you need to read the boundary hierarchy for a tenant (codes, parent-child relationships, levels), use `validate_boundary` instead -- it queries the boundary-service directly and is available in all DIGIT environments.

The `egov-bndry-mgmnt` service is not deployed in all environments. If it is unavailable, the tool returns an error with a hint suggesting `validate_boundary` as the alternative.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search generated boundaries for (e.g. `"pg.citya"`). |

## Response

Returns resource details of boundary code generation results.

```json
{
  "success": true,
  "count": 1,
  "resources": [
    {
      "id": "some-uuid",
      "type": "boundary",
      "fileStoreId": "generated-file-store-id",
      "hierarchyType": "ADMIN",
      "tenantId": "pg.citya",
      "status": "completed"
    }
  ],
  "tenantId": "pg.citya"
}
```

When no generated data exists:

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
  "hint": "No generated boundary data found for this tenant in egov-bndry-mgmnt. To read existing boundary hierarchy, use \"validate_boundary\" with the correct tenant ID. Use \"mdms_get_tenants\" to list available tenants.",
  "alternatives": [
    { "tool": "validate_boundary", "purpose": "Read boundary hierarchy from boundary-service (recommended)" },
    { "tool": "mdms_get_tenants", "purpose": "List available tenants to find correct tenant IDs" }
  ]
}
```

## Examples

### Basic Usage

Download generated boundary codes for a tenant:

```
Tool: boundary_mgmt_download
Args: {
  "tenant_id": "pg.citya"
}
```

### Workflow: download and retrieve the generated file

After generating boundary codes, download the resource details and fetch the file:

```
// Step 1: Download resource details
Tool: boundary_mgmt_download
Args: { "tenant_id": "pg.citya" }
// Returns: resources[0].fileStoreId = "generated-file-store-id"

// Step 2: Get the download URL for the generated file
Tool: filestore_get_urls
Args: {
  "tenant_id": "pg.citya",
  "file_store_ids": ["generated-file-store-id"]
}
// Returns a signed download URL
```

### Full pipeline context

This tool is the final step in the four-step boundary management workflow:

```
filestore_upload -> boundary_mgmt_process -> boundary_mgmt_generate -> boundary_mgmt_download
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid path` | No generated boundary data exists for this tenant. The generate step may not have been run. | Run `boundary_mgmt_generate` first after processing boundary data. |
| Service unavailable / 500 | The `egov-bndry-mgmnt` container is not running. | Check Docker container status. |
| Empty result (count: 0) | No boundary codes have been generated for this tenant. | Run the full pipeline: `filestore_upload` -> `boundary_mgmt_process` -> `boundary_mgmt_generate`. |
| Not authenticated | `configure` was not called. | Call `configure` to log in first. |

## See Also

- [boundary_mgmt_generate](boundary_mgmt_generate.md) -- the prerequisite step: generate boundary codes
- [boundary_mgmt_search](boundary_mgmt_search.md) -- search for processed (not generated) boundary data
- [filestore_get_urls](filestore_get_urls.md) -- get download URLs for generated boundary files
- [validate_boundary](validate_boundary.md) -- recommended tool for reading boundary hierarchy data directly

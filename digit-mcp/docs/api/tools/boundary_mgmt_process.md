# boundary_mgmt_process

> Process uploaded boundary data via the boundary management service.

**Group:** `boundary` | **Risk:** `write` | **DIGIT Service:** `egov-bndry-mgmnt`

## Description

The `boundary_mgmt_process` tool submits boundary data for processing through the `egov-bndry-mgmnt` service. This is the Excel-based legacy workflow for boundary provisioning -- you first upload a boundary data file (typically an `.xlsx` spreadsheet) to the filestore via `filestore_upload`, then pass the resulting `fileStoreId` to this tool along with resource details describing the boundary type, hierarchy, and action.

This tool is part of the four-step boundary management pipeline: upload file (`filestore_upload`) -> process (`boundary_mgmt_process`) -> generate codes (`boundary_mgmt_generate`) -> download results (`boundary_mgmt_download`). The `egov-bndry-mgmnt` service is not available in all DIGIT environments, so this pipeline may not work everywhere.

For most use cases, the `boundary_create` tool is the recommended alternative. It accepts boundaries as JSON directly, requires no file upload, and calls the boundary-service APIs which are available in all environments. Use `boundary_mgmt_process` only when you specifically need the Excel-based boundary management workflow or when working with environments that require it.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for boundary processing (e.g. `"pg.citya"`). |
| `resource_details` | object | yes | -- | Resource details object describing the boundary data to process. See properties below. |

### resource_details properties

| Property | Type | Description |
|----------|------|-------------|
| `type` | string | Resource type. Use `"boundary"` for boundary data. |
| `fileStoreId` | string | Filestore ID of the uploaded boundary file (from `filestore_upload`). |
| `action` | string | Action to perform: `"create"` for new boundaries, `"update"` for modifications. |
| `hierarchyType` | string | Hierarchy type (e.g. `"ADMIN"`). |
| `tenantId` | string | Tenant ID for the boundary data (usually same as the top-level `tenant_id`). |

## Response

Returns the processing result from `egov-bndry-mgmnt`.

```json
{
  "success": true,
  "result": {
    "ResourceDetails": {
      "id": "some-uuid",
      "type": "boundary",
      "fileStoreId": "abc-123-def-456",
      "action": "create",
      "hierarchyType": "ADMIN",
      "tenantId": "pg.citya",
      "status": "completed"
    }
  },
  "tenantId": "pg.citya"
}
```

On failure:

```json
{
  "success": false,
  "error": "Request failed with status 400: invalid path",
  "hint": "The egov-bndry-mgmnt service returned an error. This service manages boundary data uploads/processing. If you get \"invalid path\", this tenant has no processed boundary data in egov-bndry-mgmnt. To read existing boundaries, use \"validate_boundary\" (boundary-service) instead. Available tenants with boundaries can be found via \"mdms_get_tenants\".",
  "alternatives": [
    { "tool": "validate_boundary", "purpose": "Read boundary hierarchy from boundary-service (most environments)" },
    { "tool": "mdms_get_tenants", "purpose": "List available tenants to find correct tenant IDs" }
  ]
}
```

## Examples

### Basic Usage

Upload a boundary Excel file and process it:

```
// Step 1: Upload the file
Tool: filestore_upload
Args: {
  "tenant_id": "pg.citya",
  "module": "boundary",
  "file_name": "boundaries.xlsx",
  "file_content_base64": "UEsDBBQAAAAIAA..."
}
// Returns: { "fileStoreId": "abc-123-def-456" }

// Step 2: Process the uploaded file
Tool: boundary_mgmt_process
Args: {
  "tenant_id": "pg.citya",
  "resource_details": {
    "type": "boundary",
    "fileStoreId": "abc-123-def-456",
    "action": "create",
    "hierarchyType": "ADMIN",
    "tenantId": "pg.citya"
  }
}
```

### Advanced Usage -- update existing boundaries

To modify already-processed boundary data, use the `"update"` action:

```
Tool: boundary_mgmt_process
Args: {
  "tenant_id": "pg.citya",
  "resource_details": {
    "type": "boundary",
    "fileStoreId": "xyz-789-updated",
    "action": "update",
    "hierarchyType": "ADMIN",
    "tenantId": "pg.citya"
  }
}
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid path` | The `egov-bndry-mgmnt` service is not available or the tenant has no data. | Use `boundary_create` instead, which calls boundary-service directly. |
| `fileStoreId not found` | The referenced file does not exist in filestore. | Upload the file first with `filestore_upload` and use the returned ID. |
| Service unavailable / 500 | The `egov-bndry-mgmnt` container is not running. | Check Docker container status. Consider using `boundary_create` as an alternative. |
| Not authenticated | `configure` was not called. | Call `configure` to log in first. |

## See Also

- [boundary_create](boundary_create.md) -- recommended alternative: create boundaries from JSON without file upload
- [filestore_upload](filestore_upload.md) -- upload boundary data file before processing
- [boundary_mgmt_search](boundary_mgmt_search.md) -- search for previously processed boundary data
- [boundary_mgmt_generate](boundary_mgmt_generate.md) -- generate boundary codes after processing

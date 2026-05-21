# boundary_mgmt_generate

> Generate boundary code mappings from previously processed boundary data.

**Group:** `boundary` | **Risk:** `write` | **DIGIT Service:** `egov-bndry-mgmnt`

## Description

The `boundary_mgmt_generate` tool creates boundary code mappings through the `egov-bndry-mgmnt` service. It is typically called after `boundary_mgmt_process` has successfully uploaded and processed a boundary data file. The generation step transforms the processed boundary data into standardized code mappings that can then be downloaded via `boundary_mgmt_download`.

This tool is part of the four-step Excel-based boundary management pipeline: upload (`filestore_upload`) -> process (`boundary_mgmt_process`) -> generate codes (`boundary_mgmt_generate`) -> download results (`boundary_mgmt_download`). You must complete the process step before calling generate.

The `egov-bndry-mgmnt` service is not available in all DIGIT environments. For most use cases, `boundary_create` is the recommended alternative -- it creates boundaries directly via the boundary-service API without requiring file uploads or code generation steps.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for boundary code generation (e.g. `"pg.citya"`). |
| `resource_details` | object | yes | -- | Resource details identifying the boundary data to generate codes for. See properties below. |

### resource_details properties

| Property | Type | Description |
|----------|------|-------------|
| `type` | string | Resource type. Use `"boundary"` for boundary data. |
| `hierarchyType` | string | Hierarchy type (e.g. `"ADMIN"`). |
| `tenantId` | string | Tenant ID for the boundary data (usually same as the top-level `tenant_id`). |

## Response

Returns the generation result from `egov-bndry-mgmnt`.

```json
{
  "success": true,
  "result": {
    "ResourceDetails": {
      "id": "some-uuid",
      "type": "boundary",
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
  "hint": "Boundary code generation failed. Ensure boundary data was first processed via \"boundary_mgmt_process\". If you get \"invalid path\", this tenant has no data in egov-bndry-mgmnt. To read existing boundaries, use \"validate_boundary\" instead.",
  "alternatives": [
    { "tool": "validate_boundary", "purpose": "Read existing boundary hierarchy from boundary-service" },
    { "tool": "boundary_mgmt_process", "purpose": "Upload/process boundary data first before generating codes" }
  ]
}
```

## Examples

### Basic Usage

Generate boundary codes after processing boundary data:

```
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

### Full pipeline example

The complete four-step boundary management workflow:

```
// Step 1: Upload boundary Excel file
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

// Step 3: Generate boundary codes
Tool: boundary_mgmt_generate
Args: {
  "tenant_id": "pg.citya",
  "resource_details": {
    "type": "boundary",
    "hierarchyType": "ADMIN",
    "tenantId": "pg.citya"
  }
}

// Step 4: Download the generated codes
Tool: boundary_mgmt_download
Args: { "tenant_id": "pg.citya" }
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `invalid path` | No processed boundary data exists for this tenant in `egov-bndry-mgmnt`. | Run `boundary_mgmt_process` first to upload and process boundary data. |
| Service unavailable / 500 | The `egov-bndry-mgmnt` container is not running. | Check Docker container status. Consider using `boundary_create` as an alternative. |
| Not authenticated | `configure` was not called. | Call `configure` to log in first. |

## See Also

- [boundary_mgmt_process](boundary_mgmt_process.md) -- the prerequisite step: upload/process boundary data
- [boundary_mgmt_download](boundary_mgmt_download.md) -- download the generated boundary codes
- [boundary_create](boundary_create.md) -- recommended alternative: create boundaries directly from JSON
- [validate_boundary](validate_boundary.md) -- read existing boundary data from boundary-service

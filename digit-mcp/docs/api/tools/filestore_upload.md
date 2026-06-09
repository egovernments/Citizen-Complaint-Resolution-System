# filestore_upload

> Upload a file to DIGIT filestore and receive a file store ID for use with other tools.

**Group:** `admin` | **Risk:** `write` | **DIGIT Service:** `egov-filestore`

## Description

Uploads a file to the DIGIT filestore service. The file content must be provided as a base64-encoded string along with a filename and module identifier. On success, a `fileStoreId` is returned that can be referenced by other DIGIT services.

Common use cases include uploading boundary data spreadsheets for `boundary_mgmt_process`, attaching photos to PGR complaints, and uploading employee documents for HRMS. The `module` parameter categorizes the file within the filestore and should match the consuming service.

The filestore service handles storage, deduplication, and retrieval. Files are associated with the specified tenant and can later be retrieved using `filestore_get_urls`.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for the upload context (e.g. `"pg.citya"`) |
| `module` | string | yes | -- | Module name categorizing the file. Common values: `"PGR"`, `"HRMS"`, `"boundary"`, `"rainmaker-pgr"` |
| `file_name` | string | yes | -- | File name with extension (e.g. `"boundaries.xlsx"`, `"photo.jpg"`) |
| `file_content_base64` | string | yes | -- | Base64-encoded file content |
| `content_type` | string | no | `"application/octet-stream"` | MIME type of the file (e.g. `"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`, `"image/jpeg"`) |

## Response

Returns an object containing the generated file store ID.

```json
{
  "files": [
    {
      "fileStoreId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    }
  ]
}
```

## Examples

### Basic Usage

Upload a JPEG image for PGR:

```
filestore_upload({
  tenant_id: "pg.citya",
  module: "PGR",
  file_name: "pothole-photo.jpg",
  file_content_base64: "/9j/4AAQSkZJRg...",
  content_type: "image/jpeg"
})
```

### Upload Boundary Data Spreadsheet

Upload an Excel file for boundary management processing:

```
filestore_upload({
  tenant_id: "pg.citya",
  module: "boundary",
  file_name: "boundaries.xlsx",
  file_content_base64: "UEsDBBQAAAAI...",
  content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
})
```

The returned `fileStoreId` can then be passed to `boundary_mgmt_process`.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Authentication required | Not logged in | Call `configure` first |
| Invalid base64 | `file_content_base64` is not valid base64 | Re-encode the file content |
| File too large | File exceeds the filestore size limit | Reduce file size or split into multiple uploads |

## See Also

- [filestore_get_urls](filestore_get_urls.md) -- retrieve download URLs for uploaded files
- [boundary_mgmt_process](boundary_mgmt_process.md) -- process boundary data using an uploaded file

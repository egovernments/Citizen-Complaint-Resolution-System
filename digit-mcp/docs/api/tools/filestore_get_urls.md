# filestore_get_urls

> Get signed download URLs for files stored in DIGIT filestore by their file store IDs.

**Group:** `admin` | **Risk:** `read` | **DIGIT Service:** `egov-filestore`

## Description

Retrieves download URLs for files previously uploaded to the DIGIT filestore service. Takes one or more file store IDs and returns signed URLs that can be used to download the files directly.

File store IDs are returned by various DIGIT operations -- for example, `filestore_upload` returns a `fileStoreId` after uploading, and tenant logo configurations in MDMS contain file store references. This tool resolves those opaque IDs into usable download URLs.

The returned URLs are signed and time-limited. They should be used promptly after retrieval rather than cached for long periods.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for the filestore context (e.g. `"pg.citya"`) |
| `file_store_ids` | array of strings | yes | -- | One or more file store IDs to resolve into download URLs |

## Response

Returns an object with signed URLs mapped to each requested file store ID.

```json
{
  "fileStoreIds": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "url": "https://host/filestore/v1/files/id?tenantId=pg.citya&sig=..."
    }
  ]
}
```

## Examples

### Basic Usage

Retrieve the download URL for a single file:

```
filestore_get_urls({
  tenant_id: "pg.citya",
  file_store_ids: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
})
```

### Multiple Files

Retrieve URLs for several files at once:

```
filestore_get_urls({
  tenant_id: "pg.citya",
  file_store_ids: [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "f9e8d7c6-b5a4-3210-fedc-ba0987654321"
  ]
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Authentication required | Not logged in | Call `configure` first |
| Invalid file store ID | ID does not exist or has been deleted | Verify the ID came from a valid upload or MDMS record |
| Tenant mismatch | File was uploaded under a different tenant | Use the same `tenant_id` that was used during upload |

## See Also

- [filestore_upload](filestore_upload.md) -- upload files and obtain file store IDs

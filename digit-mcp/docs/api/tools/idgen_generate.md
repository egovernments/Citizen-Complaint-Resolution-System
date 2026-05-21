# idgen_generate

> Generate unique formatted IDs using the DIGIT ID generation service.

**Group:** `idgen` | **Risk:** `write` | **DIGIT Service:** `egov-idgen`

## Description

Generates one or more unique IDs based on pre-configured ID format definitions. The DIGIT ID generation service maintains sequence counters and produces formatted identifiers used throughout the platform -- complaint numbers, application IDs, employee codes, and more.

Each ID format is identified by an `id_name` that maps to a format definition stored in MDMS (schema `format-config.IdFormat`). The format string supports placeholders like `[cy:yyyy-MM-dd]` for date components and `[SEQ_NAME]` for auto-incrementing sequence numbers. For example, the PGR complaint format `PG-PGR-[cy:yyyy-MM-dd]-[SEQ_PGR]` produces IDs like `PG-PGR-2026-02-28-000042`.

In most cases, you do not need to call this tool directly. Services like `pgr_create` automatically generate IDs as part of their workflow. This tool is useful for testing ID format configurations, pre-generating IDs for batch operations, or verifying that ID formats are correctly set up on a new tenant.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for ID generation context (e.g. `"pg.citya"`) |
| `id_name` | string | yes | -- | ID format name matching a configured format. Common values: `"pgr.servicerequestid"`, `"rainmaker.pgr.count"` |
| `id_format` | string | no | -- | Custom ID format string overriding the configured format (e.g. `"PG-PGR-[cy:yyyy-MM-dd]-[SEQ_PGR]"`) |
| `count` | number | no | `1` | Number of IDs to generate in a single call |

## Response

Returns an array of generated ID strings.

```json
{
  "idResponses": [
    { "id": "PG-PGR-2026-02-28-000042" }
  ]
}
```

When `count` is greater than 1:

```json
{
  "idResponses": [
    { "id": "PG-PGR-2026-02-28-000042" },
    { "id": "PG-PGR-2026-02-28-000043" },
    { "id": "PG-PGR-2026-02-28-000044" }
  ]
}
```

## Examples

### Basic Usage

Generate a single PGR service request ID:

```
idgen_generate({
  tenant_id: "pg.citya",
  id_name: "pgr.servicerequestid"
})
```

### Generate Multiple IDs

Pre-generate 5 IDs for a batch operation:

```
idgen_generate({
  tenant_id: "pg.citya",
  id_name: "pgr.servicerequestid",
  count: 5
})
```

### Custom Format

Generate an ID with a custom format string:

```
idgen_generate({
  tenant_id: "pg.citya",
  id_name: "pgr.servicerequestid",
  id_format: "TEST-PGR-[cy:yyyy-MM-dd]-[SEQ_TEST_PGR]"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Authentication required | Not logged in | Call `configure` first |
| ID format not found | `id_name` does not match any configured format in MDMS | Check `IdFormat` records with `mdms_search` using schema `"format-config.IdFormat"`. Run `tenant_bootstrap` if formats are missing. |
| Sequence error | Database sequence issue | Typically transient; retry the request |

## See Also

- [pgr_create](pgr_create.md) -- creates PGR complaints and auto-generates service request IDs

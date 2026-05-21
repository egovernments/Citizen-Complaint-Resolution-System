# mdms_get_tenants

> List all tenant records from MDMS across all state tenant roots.

**Group:** `core` | **Risk:** `read` | **DIGIT Service:** `egov-mdms-service`

## Description

The `mdms_get_tenants` tool fetches tenant records from the MDMS v2 `tenant.tenants` schema. Unlike a simple single-tenant search, this tool automatically discovers and queries multiple state tenant roots to build a complete picture.

The discovery process works in three stages: (1) query the default state tenant (e.g. `"pg"`) for all tenant records, (2) extract additional root codes from the tenant codes found (e.g. `"statea.f"` reveals root `"statea"`), and (3) check the logged-in user's roles for any other tenant roots they have access to. Each discovered root is queried and results are deduplicated by tenant code.

If not already authenticated, the tool attempts auto-login using the `CRS_USERNAME` and `CRS_PASSWORD` environment variables. You can filter results to a specific state tenant root by passing `state_tenant_id`.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `state_tenant_id` | string | No | -- | Filter to a specific state tenant root (e.g. `"pg"`, `"statea"`). When provided, only that root is queried. When omitted, all discoverable roots are queried. |

## Response

Returns the environment name, total count, and an array of tenant objects.

```json
{
  "success": true,
  "environment": "Chakshu Dev",
  "count": 5,
  "tenants": [
    {
      "code": "pg",
      "name": "Punjab",
      "description": "State tenant root: pg",
      "city": {
        "code": "PG",
        "name": "Punjab",
        "districtCode": "PG",
        "districtName": "pg"
      }
    },
    {
      "code": "pg.citya",
      "name": "City A",
      "description": null,
      "city": {
        "code": "CITYA",
        "name": "City A",
        "districtName": "pg"
      }
    },
    {
      "code": "statea",
      "name": "statea",
      "description": "State tenant root: statea",
      "city": {
        "code": "STATEA",
        "name": "statea"
      }
    },
    {
      "code": "statea.f",
      "name": "City F",
      "description": null,
      "city": {
        "code": "F",
        "name": "City F"
      }
    },
    {
      "code": "pg.cityb",
      "name": "City B",
      "description": null,
      "city": {
        "code": "CITYB",
        "name": "City B"
      }
    }
  ]
}
```

## Examples

### Basic Usage -- list all tenants

```
Tool: mdms_get_tenants
Args: {}
```

### Filter to a specific state root

```
Tool: mdms_get_tenants
Args: {
  "state_tenant_id": "pg"
}
```

Returns only tenants registered under the `"pg"` root (e.g. `"pg"`, `"pg.citya"`, `"pg.cityb"`).

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `"Not authenticated"` | No auth token and auto-login failed (missing env vars). | Call `configure` first, or set `CRS_USERNAME`/`CRS_PASSWORD` environment variables. |
| MDMS API errors | The MDMS service returned an error for one or more state roots. | Check `health_check` to verify MDMS is healthy. Unreachable roots are silently skipped; only the default root failure causes an error. |

## See Also

- [configure](configure.md) -- authenticate before querying tenants
- [health_check](health_check.md) -- verify MDMS service is healthy

# validate_tenant

> Validate that a tenant code exists in the MDMS tenant list across all state tenants.

**Group:** `mdms` | **Risk:** `read` | **DIGIT Service:** `egov-mdms-service`

## Description

Checks whether a given tenant code is registered in MDMS by searching the `tenant.tenants` schema across all discovered state tenant roots. This is a cross-tenant search: the tool first queries the default state tenant, discovers additional roots from tenant codes and user roles, then queries each root to build a complete picture.

If the tenant is found, the tool returns its full details including code, name, description, and city information. If not found, it returns partial-match suggestions based on substring matching against all known tenants, along with the total count of available tenants.

Use this tool as a prerequisite check before running other validations (boundary, employees, complaint types) that require a valid tenant ID.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant code to validate (e.g. `"pg.citya"`, `"statea.f"`, `"tenant"`) |

## Response

```json
{
  "success": true,
  "valid": true,
  "tenant": {
    "code": "pg.citya",
    "name": "City A",
    "description": "City A under state pg",
    "city": {
      "code": "CITYA",
      "name": "City A",
      "districtCode": "DISTA",
      "districtName": "District A"
    }
  }
}
```

When the tenant is not found:

```json
{
  "success": true,
  "valid": false,
  "error": "Tenant \"pg.cityxyz\" not found",
  "suggestions": ["pg.citya", "pg.cityb"],
  "availableCount": 12
}
```

## Examples

### Basic Usage

Validate a city-level tenant before creating employees or complaints:

```
validate_tenant({ tenant_id: "pg.citya" })
```

### Checking a Root Tenant

Validate a state-level root before running `city_setup`:

```
validate_tenant({ tenant_id: "pg" })
```

### Handling Not Found

When a tenant does not exist, the response includes suggestions:

```
validate_tenant({ tenant_id: "pg.xyz" })

// Response:
// {
//   "success": true,
//   "valid": false,
//   "error": "Tenant \"pg.xyz\" not found",
//   "suggestions": [],
//   "availableCount": 5
// }
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first or set `CRS_USERNAME`/`CRS_PASSWORD` env vars |
| `valid: false` with suggestions | Tenant code is close but not exact | Use one of the suggested tenant codes |
| `valid: false` with `availableCount: 0` | No tenants registered at all | Run `tenant_bootstrap` to set up the tenant root, then `city_setup` for cities |

## See Also

- [mdms_get_tenants](mdms_get_tenants.md) -- list all tenants across all state roots (core group, always available)
- [mdms_search](mdms_search.md) -- search MDMS records by schema code, including `tenant.tenants`

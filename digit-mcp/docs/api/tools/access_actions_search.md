# access_actions_search

> Search permissions and API actions available to specific roles.

**Group:** `admin` | **Risk:** `read` | **DIGIT Service:** `egov-accesscontrol`

## Description

Returns the API endpoints and UI actions that specific roles are authorized to access. Each action includes the URL pattern, display name, service name, and whether it is currently enabled. This is the primary tool for debugging permission issues when a user receives "not authorized" errors.

When a PGR operation fails with an authorization error, use this tool to verify that the acting user's role actually has permission for the required endpoint. For example, if a GRO cannot assign a complaint, searching actions for the `GRO` role will reveal whether the PGR assignment endpoint is in their permission set.

The tool returns the first 100 actions matching the specified roles. If no `role_codes` filter is provided, it returns actions across all roles (which can be a large result set).

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search actions for (e.g. `"pg"`) |
| `role_codes` | array of strings | no | -- | Role codes to look up actions for (e.g. `["GRO", "PGR_LME"]`). Omit to search all roles. |

## Response

Returns an array of action objects associated with the queried roles.

```json
{
  "actions": [
    {
      "url": "/pgr-services/v2/request/_create",
      "displayName": "Create PGR Complaint",
      "serviceName": "pgr-services",
      "enabled": true,
      "roles": ["CITIZEN", "EMPLOYEE", "CSR"]
    },
    {
      "url": "/pgr-services/v2/request/_update",
      "displayName": "Update PGR Complaint",
      "serviceName": "pgr-services",
      "enabled": true,
      "roles": ["GRO", "PGR_LME", "DGRO"]
    }
  ]
}
```

## Examples

### Basic Usage

Check what actions the GRO role can perform:

```
access_actions_search({
  tenant_id: "pg",
  role_codes: ["GRO"]
})
```

### Debug Permission Issue

When a PGR_LME employee cannot resolve complaints, verify their permissions:

```
access_actions_search({
  tenant_id: "pg",
  role_codes: ["PGR_LME"]
})
```

Look for the `/pgr-services/v2/request/_update` endpoint in the results. If missing, the role lacks the required permission.

### Compare Multiple Roles

See the combined permissions for GRO and PGR_LME:

```
access_actions_search({
  tenant_id: "pg",
  role_codes: ["GRO", "PGR_LME"]
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Authentication required | Not logged in | Call `configure` first |
| No actions found | Role code does not exist or has no permissions assigned | Verify role codes with `access_roles_search` |

## See Also

- [access_roles_search](access_roles_search.md) -- list all available role codes and their descriptions

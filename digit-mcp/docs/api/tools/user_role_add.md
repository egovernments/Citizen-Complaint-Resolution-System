# user_role_add

> Add cross-tenant roles to an existing user, fixing "User is not authorized" errors in cross-tenant PGR operations.

**Group:** `admin` | **Risk:** `write` | **DIGIT Service:** `egov-user`

## Description

Adds roles to an existing user for a specific tenant context. This is critical for cross-tenant operations in DIGIT. The platform checks that a user's roles are tagged to the target tenant root before allowing API calls. If an admin authenticated on tenant `"pg"` tries to create PGR complaints on `"tenant.coimbatore"`, the call fails with "User is not authorized" because the user's roles are scoped to `"pg"`, not `"tenant"`.

This tool resolves that by fetching the user, adding the specified roles tagged to the target tenant root, and updating the user record. By default, the tenant ID is resolved to its state root (e.g. `"tenant.live"` becomes `"tenant"`), since DIGIT role checks happen at the root level. Use `city_level: true` when roles need to be scoped to a specific city tenant instead.

After adding roles, the user must re-authenticate (call `configure` again) for the new roles to take effect in the session token. The tool returns a hint reminding you to do this.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Target tenant ID. Auto-resolved to state root (e.g. `"tenant.live"` becomes `"tenant"`) unless `city_level` is true |
| `username` | string | no | current logged-in user | Username of the user to update |
| `role_codes` | string[] | no | `["CITIZEN", "EMPLOYEE", "CSR", "GRO", "PGR_LME", "DGRO", "SUPERUSER"]` | Role codes to add (standard PGR roles by default) |
| `city_level` | boolean | no | `false` | If true, tag roles to the exact tenant ID passed (e.g. `"mz.chimoio"`) instead of auto-resolving to the state root (`"mz"`) |

## Response

```json
{
  "success": true,
  "message": "Added 7 roles for \"tenant\" to user \"ADMIN\": CITIZEN, EMPLOYEE, CSR, GRO, PGR_LME, DGRO, SUPERUSER",
  "user": "ADMIN",
  "targetTenant": "tenant",
  "rolesAdded": ["CITIZEN", "EMPLOYEE", "CSR", "GRO", "PGR_LME", "DGRO", "SUPERUSER"],
  "hint": "Roles added. You may need to call configure again to refresh the auth token with the new roles."
}
```

When some roles already exist:

```json
{
  "success": true,
  "message": "Added 2 roles for \"tenant\" to user \"ADMIN\": PGR_LME, DGRO",
  "user": "ADMIN",
  "targetTenant": "tenant",
  "rolesAdded": ["PGR_LME", "DGRO"],
  "hint": "Roles added. You may need to call configure again to refresh the auth token with the new roles."
}
```

## Examples

### Basic Usage

Add standard PGR roles for the current user on a new tenant:

```
user_role_add({ tenant_id: "tenant" })
```

### Fix Cross-Tenant Authorization

Resolve "User is not authorized" when creating complaints on a different tenant:

```
// Step 1: Add roles for the target tenant
user_role_add({ tenant_id: "tenant.coimbatore" })
// Resolves to root "tenant" automatically

// Step 2: Re-authenticate to pick up new roles
configure({ environment: "chakshu-digit" })

// Step 3: Now PGR operations work on the new tenant
pgr_create({
  tenant_id: "tenant.coimbatore",
  service_code: "StreetLightNotWorking",
  ...
})
```

### Add Roles for a Specific User

Grant PGR roles to a different user (not the current session user):

```
user_role_add({
  tenant_id: "tenant",
  username: "EMP-0001"
})
```

### Add Custom Roles

Add only specific roles instead of the full default set:

```
user_role_add({
  tenant_id: "tenant",
  role_codes: ["CITIZEN", "EMPLOYEE"]
})
```

### City-Level Role Scoping

Tag roles to a specific city tenant instead of the state root:

```
user_role_add({
  tenant_id: "mz.chimoio",
  city_level: true,
  role_codes: ["EMPLOYEE", "GRO", "PGR_LME"]
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `User not found` | No user with the given username exists | Use `user_search` to verify the username, or create the user with `user_create` first |
| `Still getting "not authorized" after adding roles` | Session token has stale roles | Call `configure` again to re-authenticate and refresh the token |
| `Roles added but PGR still fails` | Roles may need to be at city level, not root | Retry with `city_level: true` targeting the specific city tenant |

## See Also

- [configure](configure.md) -- re-authenticate after adding roles to refresh the session token
- [user_search](user_search.md) -- verify a user exists and check their current roles before adding more
- [pgr_create](pgr_create.md) -- create PGR complaints (may require cross-tenant roles)
- [pgr_update](pgr_update.md) -- update PGR complaints (may require cross-tenant roles)

# tenant_cleanup

> Soft-delete all MDMS data and deactivate users for a tenant, following the DIGIT dataloader pattern.

**Group:** `mdms` | **Risk:** `write` | **DIGIT Service:** `egov-mdms-service`

## Description

Tears down a tenant by deactivating all of its MDMS records and optionally deactivating all users. This is the reverse operation of `tenant_bootstrap` and is designed for cleaning up test tenants.

MDMS records are not hard-deleted. Instead, each active record is set to `isActive: false` via the MDMS v2 `_update` API. This follows the DIGIT dataloader pattern where records are never physically removed from the database. Schema definitions are intentionally left in place since they are harmless without data and avoid the need to re-register them if the tenant is bootstrapped again.

The tool paginates through all records in batches of 500 to handle tenants with large amounts of data. You can optionally limit cleanup to specific schema codes using the `schemas` parameter. After MDMS cleanup, the tool searches for all active users on the tenant and deactivates them (sets `active: false`).

The response includes per-schema counts showing how many records were deleted, skipped (already inactive), or failed, making it easy to verify the cleanup was thorough.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to clean up (e.g. `"testroot"`, `"ke"`, `"pg.testcity"`) |
| `deactivate_users` | boolean | no | `true` | Also deactivate all users on this tenant |
| `schemas` | string[] | no | all schemas | Only clean up specific schema codes. If omitted, cleans everything |

## Response

```json
{
  "success": true,
  "tenantId": "testroot",
  "summary": {
    "mdms_records_found": 87,
    "mdms_deleted": 85,
    "mdms_already_inactive": 2,
    "mdms_failed": 0,
    "users_deactivated": 1,
    "users_failed": 0
  },
  "schemas_affected": {
    "ACCESSCONTROL-ROLES.roles": 15,
    "common-masters.Department": 8,
    "common-masters.Designation": 6,
    "common-masters.IdFormat": 4,
    "RAINMAKER-PGR.ServiceDefs": 12,
    "tenant.tenants": 2,
    "common-masters.StateInfo": 1,
    "common-masters.GenderType": 3,
    "egov-hrms.EmployeeStatus": 3,
    "egov-hrms.EmployeeType": 2,
    "DataSecurity.DecryptionABAC": 5,
    "DataSecurity.EncryptionPolicy": 4,
    "DataSecurity.SecurityPolicy": 10,
    "DataSecurity.MaskingPatterns": 4,
    "INBOX.InboxQueryConfiguration": 6
  },
  "note": "MDMS records soft-deleted (isActive=false). Schema definitions are left in place. Users deactivated."
}
```

## Examples

### Basic Usage

Clean up a test tenant completely:

```
tenant_cleanup({ tenant_id: "testroot" })
```

### Keep Users Active

Remove MDMS data but leave users intact (useful for re-bootstrapping):

```
tenant_cleanup({
  tenant_id: "testroot",
  deactivate_users: false
})
```

### Clean Up Specific Schemas Only

Remove only PGR-related data:

```
tenant_cleanup({
  tenant_id: "pg",
  schemas: ["RAINMAKER-PGR.ServiceDefs"],
  deactivate_users: false
})
```

### Advanced Usage

Full test cycle -- bootstrap, test, clean up:

```
// Step 1: Create
tenant_bootstrap({ target_tenant: "testroot" })
city_setup({ tenant_id: "testroot.testcity", city_name: "Test City" })

// Step 2: Test PGR, employees, etc.
// ...

// Step 3: Clean up
tenant_cleanup({ tenant_id: "testroot" })
// Schemas are left in place, so re-bootstrapping is faster next time
// (tenant_bootstrap will skip existing schemas and re-create data)
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `mdms_failed > 0` | Some records could not be deactivated | Check server logs; individual records may have update constraints |
| `users_failed > 0` | Some users could not be deactivated | Use `user_search` and manually deactivate via the DIGIT user API |
| `success: false` | At least one operation failed | Review the `summary` counts for `mdms_failed` and `users_failed` |

## See Also

- [tenant_bootstrap](tenant_bootstrap.md) -- the setup counterpart: creates schemas, data, users, and workflows for a new tenant root

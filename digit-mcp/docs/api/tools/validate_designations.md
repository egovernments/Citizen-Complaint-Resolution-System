# validate_designations

> Validate that required designations exist in MDMS for a tenant, flagging any that are inactive or missing.

**Group:** `masters` | **Risk:** `read` | **DIGIT Service:** `egov-mdms-service`

## Description

Queries the `common-masters.Designation` schema in MDMS v2 for the given tenant and returns all registered designations. Each designation record includes its code, name, and active status. Inactive designations are flagged separately in the response summary.

When the optional `required_designations` parameter is provided, the tool checks that every listed designation code exists and is active. Missing or inactive designations are reported as validation failures. This is a common prerequisite check before calling `employee_create`, which requires a valid designation code for the employee assignment.

Designations are stored at the state tenant root level. City-level tenants (e.g. `"pg.citya"`) inherit designations from their root (`"pg"`), so the tool resolves the root automatically.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to validate designations for (e.g. `"pg"`, `"statea"`) |
| `required_designations` | string[] | no | -- | Designation codes that must exist and be active (e.g. `["DESIG_1", "DESIG_5"]`) |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "totalDesignations": 8,
  "activeDesignations": 8,
  "inactiveDesignations": 0,
  "designations": [
    { "code": "DESIG_1", "name": "Commissioner", "active": true },
    { "code": "DESIG_2", "name": "Deputy Commissioner", "active": true },
    { "code": "DESIG_5", "name": "Junior Engineer", "active": true }
  ],
  "validation": {
    "passed": true,
    "required": ["DESIG_1"],
    "found": ["DESIG_1"],
    "missing": [],
    "inactive": []
  }
}
```

When required designations are missing:

```json
{
  "success": true,
  "tenantId": "pg",
  "totalDesignations": 3,
  "activeDesignations": 3,
  "inactiveDesignations": 0,
  "designations": [
    { "code": "DESIG_1", "name": "Commissioner", "active": true }
  ],
  "validation": {
    "passed": false,
    "required": ["DESIG_1", "DESIG_99"],
    "found": ["DESIG_1"],
    "missing": ["DESIG_99"],
    "inactive": []
  }
}
```

## Examples

### Basic Usage

List all designations for a tenant:

```
validate_designations({ tenant_id: "pg" })
```

### Check Required Designations

Verify that specific designation codes exist before creating employees:

```
validate_designations({
  tenant_id: "pg",
  required_designations: ["DESIG_1", "DESIG_5"]
})
```

### Combined Validation with Departments

Run both validations before employee creation:

```
// Check departments and designations in parallel
validate_departments({ tenant_id: "pg", required_departments: ["DEPT_1"] })
validate_designations({ tenant_id: "pg", required_designations: ["DESIG_1"] })
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `totalDesignations: 0` | No designations registered for tenant | Run `tenant_bootstrap` to copy master data from `"pg"` |
| `validation.passed: false` with `missing` entries | Required designation codes not found | Create missing designations with `mdms_create` using schema `common-masters.Designation` |
| `validation.passed: false` with `inactive` entries | Designation exists but is soft-deleted | Re-activate or create a replacement record |

## See Also

- [validate_departments](validate_departments.md) -- validate department codes (typically checked alongside designations)
- [employee_create](employee_create.md) -- create an employee requiring valid designation codes
- [mdms_search](mdms_search.md) -- raw MDMS query for `common-masters.Designation` schema

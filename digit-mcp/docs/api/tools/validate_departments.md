# validate_departments

> Validate that required departments exist in MDMS for a tenant, flagging any that are inactive or missing.

**Group:** `masters` | **Risk:** `read` | **DIGIT Service:** `egov-mdms-service`

## Description

Queries the `common-masters.Department` schema in MDMS v2 for the given tenant and returns all registered departments. Each department record includes its code, name, and active status. If any departments are inactive (soft-deleted), they are flagged in the response.

When the optional `required_departments` parameter is provided, the tool checks that every listed department code exists and is active. Missing or inactive departments are reported as validation failures. This is useful as a prerequisite check before creating employees or complaint types that reference specific departments.

Departments are stored at the state tenant root level (e.g. `"pg"`, `"tenant"`). City-level tenants inherit from their root, so passing `"pg.citya"` will resolve and search the `"pg"` root automatically.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to validate departments for (e.g. `"pg"`, `"pg.citya"`) |
| `required_departments` | string[] | no | -- | Department codes that must exist and be active (e.g. `["DEPT_1", "DEPT_25"]`) |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "totalDepartments": 5,
  "activeDepartments": 5,
  "inactiveDepartments": 0,
  "departments": [
    { "code": "DEPT_1", "name": "Street Lighting Department", "active": true },
    { "code": "DEPT_2", "name": "Building & Roads Department", "active": true },
    { "code": "DEPT_25", "name": "Health & Sanitation", "active": true }
  ],
  "validation": {
    "passed": true,
    "required": ["DEPT_1", "DEPT_25"],
    "found": ["DEPT_1", "DEPT_25"],
    "missing": [],
    "inactive": []
  }
}
```

When required departments are missing:

```json
{
  "success": true,
  "tenantId": "pg",
  "totalDepartments": 3,
  "activeDepartments": 3,
  "inactiveDepartments": 0,
  "departments": [
    { "code": "DEPT_1", "name": "Street Lighting Department", "active": true }
  ],
  "validation": {
    "passed": false,
    "required": ["DEPT_1", "DEPT_99"],
    "found": ["DEPT_1"],
    "missing": ["DEPT_99"],
    "inactive": []
  }
}
```

## Examples

### Basic Usage

List all departments for a tenant without any required checks:

```
validate_departments({ tenant_id: "pg" })
```

### Check Required Departments

Verify specific departments exist before creating employees:

```
validate_departments({
  tenant_id: "pg",
  required_departments: ["DEPT_1", "DEPT_2", "DEPT_25"]
})
```

### Pre-flight for Employee Creation

Confirm department and designation codes are valid before calling `employee_create`:

```
// Step 1: Validate departments
validate_departments({ tenant_id: "pg", required_departments: ["DEPT_1"] })

// Step 2: Validate designations
validate_designations({ tenant_id: "pg", required_designations: ["DESIG_1"] })

// Step 3: Create employee with validated codes
employee_create({
  tenant_id: "pg.citya",
  name: "Jane Doe",
  mobile_number: "9876543210",
  department: "DEPT_1",
  designation: "DESIG_1",
  ...
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `totalDepartments: 0` | No departments registered for tenant | Run `tenant_bootstrap` to copy master data from `"pg"` |
| `validation.passed: false` with `missing` entries | Required department codes not found in MDMS | Create missing departments with `mdms_create` using schema `common-masters.Department` |
| `validation.passed: false` with `inactive` entries | Department exists but is soft-deleted | Re-activate via `mdms_create` or create a new record |

## See Also

- [validate_designations](validate_designations.md) -- validate designation codes (typically checked alongside departments)
- [employee_create](employee_create.md) -- create an employee requiring valid department and designation codes
- [mdms_create](mdms_create.md) -- create new MDMS records including department definitions
- [mdms_search](mdms_search.md) -- raw MDMS query for `common-masters.Department` schema

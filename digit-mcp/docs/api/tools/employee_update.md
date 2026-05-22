# employee_update

> Update an existing HRMS employee's roles, assignment, or active status.

**Group:** `employees` | **Risk:** `write` | **DIGIT Service:** `egov-hrms`

## Description

Modifies an existing employee record in DIGIT HRMS. The tool fetches the current employee data by employee code, applies the requested changes, and submits the update. This is a partial-update pattern: you specify only the fields to change, and the tool handles merging with the existing record.

Common update operations include: adding or removing roles (e.g. granting a PGR_LME role to an existing employee), changing the department/designation assignment (which ends the previous assignment and creates a new one), deactivating an employee (soft delete), and reactivating a previously deactivated employee.

Use `validate_employees` first to find the employee code and review their current state before making changes. The employee code (e.g. `"EMP-0001"`) is the unique identifier -- not the mobile number or UUID.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID of the employee (city-level, e.g. `"pg.citya"`) |
| `employee_code` | string | yes | -- | Employee code to update (e.g. `"EMP-0001"`). Use `validate_employees` to find codes |
| `add_roles` | object[] | no | -- | Roles to add. Each object has `code` (string) and `name` (string) |
| `remove_roles` | string[] | no | -- | Role codes to remove (e.g. `["PGR_LME"]`) |
| `new_assignment` | object | no | -- | New assignment with `department` (string) and/or `designation` (string). Ends the current assignment and creates a new one |
| `deactivate` | boolean | no | -- | Set to `true` to deactivate the employee |
| `reactivate` | boolean | no | -- | Set to `true` to reactivate a deactivated employee |

## Response

```json
{
  "success": true,
  "message": "Employee EMP-0001 updated",
  "employee": {
    "code": "EMP-0001",
    "name": "Rajesh Kumar",
    "employeeStatus": "EMPLOYED",
    "roles": ["EMPLOYEE", "GRO", "PGR_LME"],
    "assignments": [
      { "department": "DEPT_1", "designation": "DESIG_1" }
    ]
  }
}
```

## Examples

### Basic Usage

Add the PGR_LME role to an existing employee:

```
employee_update({
  tenant_id: "pg.citya",
  employee_code: "EMP-0001",
  add_roles: [
    { code: "PGR_LME", name: "PGR Last Mile Employee" }
  ]
})
```

### Remove a Role

Remove the GRO role from an employee:

```
employee_update({
  tenant_id: "pg.citya",
  employee_code: "EMP-0001",
  remove_roles: ["GRO"]
})
```

### Change Department Assignment

Move an employee to a different department:

```
employee_update({
  tenant_id: "pg.citya",
  employee_code: "EMP-0002",
  new_assignment: {
    department: "DEPT_25",
    designation: "DESIG_5"
  }
})
```

### Deactivate an Employee

Soft-delete an employee who has left the organization:

```
employee_update({
  tenant_id: "pg.citya",
  employee_code: "EMP-0003",
  deactivate: true
})
```

### Reactivate a Deactivated Employee

Bring back a previously deactivated employee:

```
employee_update({
  tenant_id: "pg.citya",
  employee_code: "EMP-0003",
  reactivate: true
})
```

### Combined Changes

Add a role and change assignment in one call:

```
employee_update({
  tenant_id: "pg.citya",
  employee_code: "EMP-0001",
  add_roles: [
    { code: "DGRO", name: "Department GRO" }
  ],
  new_assignment: {
    department: "DEPT_2",
    designation: "DESIG_1"
  }
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `Employee not found` | No employee with the given code exists on this tenant | Use `validate_employees` to list employees and find the correct code |
| `Cannot remove EMPLOYEE role` | Attempted to remove the base EMPLOYEE role | The EMPLOYEE role is mandatory and cannot be removed |
| `Department not found` | New assignment references an invalid department code | Use `validate_departments` to find valid codes |
| `Designation not found` | New assignment references an invalid designation code | Use `validate_designations` to find valid codes |
| `Employee already deactivated` | Attempted to deactivate an already-inactive employee | Use `reactivate: true` if you want to restore the employee |

## See Also

- [validate_employees](validate_employees.md) -- find employee codes and review current state before updating
- [employee_create](employee_create.md) -- create a new employee if one does not exist
- [access_roles_search](access_roles_search.md) -- list all available role codes to add

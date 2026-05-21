# validate_employees

> Validate employee setup for a tenant, checking that employees exist with valid assignments and required PGR roles.

**Group:** `employees` | **Risk:** `read` | **DIGIT Service:** `egov-hrms`

## Description

Queries the HRMS (Human Resource Management System) for all employees registered under the given tenant. Returns up to 20 employees with their code, UUID, name, mobile number, active status, department/designation assignment, and assigned roles. This provides a quick overview of the employee roster for a city tenant.

When `required_roles` is provided, the tool checks that at least one active employee holds each specified role. This is critical for PGR workflow validation: complaints require a GRO (Grievance Routing Officer) to assign them and a PGR_LME (Last Mile Employee) to resolve them. If no employee has a required role, the validation fails with details about which roles are uncovered.

The tool also cross-references employee assignments against MDMS to flag employees with invalid department or designation codes. Employee UUIDs returned by this tool are used as assignee identifiers in `pgr_update` for the ASSIGN and REASSIGN actions.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to validate employees for (city-level, e.g. `"pg.citya"`) |
| `required_roles` | string[] | no | -- | Role codes that at least one employee must have (e.g. `["GRO", "PGR_LME"]`) |

## Response

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "totalEmployees": 3,
  "activeEmployees": 3,
  "employees": [
    {
      "code": "EMP-0001",
      "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Rajesh Kumar",
      "mobile": "9876543210",
      "status": "EMPLOYED",
      "department": "DEPT_1",
      "designation": "DESIG_1",
      "roles": ["EMPLOYEE", "GRO", "DGRO"]
    },
    {
      "code": "EMP-0002",
      "uuid": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "name": "Priya Sharma",
      "mobile": "9876543211",
      "status": "EMPLOYED",
      "department": "DEPT_1",
      "designation": "DESIG_5",
      "roles": ["EMPLOYEE", "PGR_LME"]
    }
  ],
  "roleValidation": {
    "passed": true,
    "required": ["GRO", "PGR_LME"],
    "covered": {
      "GRO": ["EMP-0001"],
      "PGR_LME": ["EMP-0002"]
    },
    "missing": []
  }
}
```

When required roles are missing:

```json
{
  "success": true,
  "tenantId": "pg.citya",
  "totalEmployees": 1,
  "activeEmployees": 1,
  "employees": [
    {
      "code": "EMP-0001",
      "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Rajesh Kumar",
      "mobile": "9876543210",
      "status": "EMPLOYED",
      "department": "DEPT_1",
      "designation": "DESIG_1",
      "roles": ["EMPLOYEE", "GRO"]
    }
  ],
  "roleValidation": {
    "passed": false,
    "required": ["GRO", "PGR_LME"],
    "covered": {
      "GRO": ["EMP-0001"]
    },
    "missing": ["PGR_LME"]
  }
}
```

## Examples

### Basic Usage

List all employees for a city tenant:

```
validate_employees({ tenant_id: "pg.citya" })
```

### Check PGR Role Coverage

Verify that the city has employees covering the key PGR workflow roles:

```
validate_employees({
  tenant_id: "pg.citya",
  required_roles: ["GRO", "PGR_LME"]
})
```

### Find Employee UUID for PGR Assignment

Use this tool to find an employee's UUID, then assign a complaint to them:

```
// Step 1: Find LME employees
validate_employees({
  tenant_id: "pg.citya",
  required_roles: ["PGR_LME"]
})
// Response includes uuid: "b2c3d4e5-f6a7-8901-bcde-f12345678901"

// Step 2: Assign complaint to that employee
pgr_update({
  tenant_id: "pg.citya",
  service_request_id: "PB-PGR-2026-01-15-000123",
  action: "ASSIGN",
  assignees: ["b2c3d4e5-f6a7-8901-bcde-f12345678901"],
  comment: "Assigning to field engineer"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `totalEmployees: 0` | No employees registered for this tenant | Create employees with `employee_create` |
| `roleValidation.passed: false` | No employee holds a required role | Create a new employee with the missing role, or use `employee_update` to add the role to an existing employee |
| Invalid department/designation flags | Employee references a department or designation code not found in MDMS | Fix the MDMS data with `mdms_create` or update the employee assignment with `employee_update` |

## See Also

- [employee_create](employee_create.md) -- create a new employee with roles, department, and designation
- [employee_update](employee_update.md) -- add roles or change assignments for an existing employee
- [pgr_update](pgr_update.md) -- assign complaints to employees using their UUIDs from this tool
- [access_roles_search](access_roles_search.md) -- list all available role codes in the platform

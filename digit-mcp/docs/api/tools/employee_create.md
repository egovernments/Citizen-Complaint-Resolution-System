# employee_create

> Create a new employee in DIGIT HRMS with roles, department/designation assignment, and jurisdiction.

**Group:** `employees` | **Risk:** `write` | **DIGIT Service:** `egov-hrms`

## Description

Creates a new employee record in the DIGIT Human Resource Management System (HRMS). The employee is created with a user account, role assignments, a department/designation assignment, and a jurisdiction scope. The HRMS service auto-generates an employee code (e.g. `"EMP-0001"`) which becomes the employee's username for login -- this is NOT the mobile number.

The tool creates both the HRMS employee record and the underlying platform user in a single call. The employee's roles determine what actions they can perform in the system. For PGR (Public Grievance Redressal), the key roles are: `GRO` (Grievance Routing Officer -- assigns complaints), `PGR_LME` (Last Mile Employee -- resolves complaints in the field), and `DGRO` (Department GRO -- routes within a department). Every employee must include the `EMPLOYEE` base role.

Before calling this tool, validate that the department code, designation code, and boundary code all exist using `validate_departments`, `validate_designations`, and `validate_boundary` respectively. Invalid codes will cause the creation to fail.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | City-level tenant ID (e.g. `"pg.citya"`, `"tenant.stage3"`) |
| `name` | string | yes | -- | Full name of the employee |
| `mobile_number` | string | yes | -- | 10-digit mobile number |
| `roles` | object[] | yes | -- | Roles to assign. Each object has `code` (string) and `name` (string). Must include `EMPLOYEE` role |
| `department` | string | yes | -- | Department code for assignment (e.g. `"DEPT_1"`). Use `validate_departments` to find valid codes |
| `designation` | string | yes | -- | Designation code for assignment (e.g. `"DESIG_1"`). Use `validate_designations` to find valid codes |
| `jurisdiction_boundary_type` | string | yes | -- | Boundary type for jurisdiction scope (e.g. `"City"`, `"Ward"`, `"Locality"`) |
| `jurisdiction_boundary` | string | yes | -- | Boundary code for jurisdiction (e.g. `"pg.citya"`). Use `validate_boundary` to find codes |
| `jurisdiction_hierarchy` | string | no | `"ADMIN"` | Jurisdiction hierarchy type |
| `employee_type` | string | no | `"PERMANENT"` | Employee type. Use `mdms_search` with schema `"egov-hrms.EmployeeType"` to list valid types |
| `date_of_appointment` | number | no | current time | Date of appointment as epoch timestamp in milliseconds |
| `email` | string | no | -- | Email address |
| `gender` | string | no | -- | Gender: `"MALE"`, `"FEMALE"`, or `"TRANSGENDER"` |

## Response

```json
{
  "success": true,
  "message": "Employee created: EMP-0001",
  "employee": {
    "code": "EMP-0001",
    "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Rajesh Kumar",
    "mobileNumber": "9876543210",
    "employeeStatus": "EMPLOYED",
    "employeeType": "PERMANENT",
    "tenantId": "pg.citya",
    "roles": ["EMPLOYEE", "GRO", "PGR_LME"]
  },
  "loginCredentials": {
    "username": "EMP-0001",
    "password": "eGov@123",
    "loginTenantId": "pg",
    "note": "To authenticate as this employee, use the employee CODE as the username (not mobile number)."
  }
}
```

## Examples

### Basic Usage

Create a GRO employee for a city:

```
employee_create({
  tenant_id: "pg.citya",
  name: "Rajesh Kumar",
  mobile_number: "9876543210",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "GRO", name: "Grievance Routing Officer" }
  ],
  department: "DEPT_1",
  designation: "DESIG_1",
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "pg.citya"
})
```

### Create a Last Mile Employee

Create a field worker who resolves complaints:

```
employee_create({
  tenant_id: "pg.citya",
  name: "Priya Sharma",
  mobile_number: "9876543211",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "PGR_LME", name: "PGR Last Mile Employee" }
  ],
  department: "DEPT_1",
  designation: "DESIG_5",
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "pg.citya",
  gender: "FEMALE"
})
```

### Full PGR Setup

Create both GRO and LME employees after validating master data:

```
// Step 1: Validate prerequisites
validate_departments({ tenant_id: "pg", required_departments: ["DEPT_1"] })
validate_designations({ tenant_id: "pg", required_designations: ["DESIG_1", "DESIG_5"] })
validate_boundary({ tenant_id: "pg.citya" })

// Step 2: Create GRO
employee_create({
  tenant_id: "pg.citya",
  name: "GRO Officer",
  mobile_number: "9000000001",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "GRO", name: "Grievance Routing Officer" },
    { code: "DGRO", name: "Department GRO" }
  ],
  department: "DEPT_1",
  designation: "DESIG_1",
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "pg.citya"
})

// Step 3: Create LME
employee_create({
  tenant_id: "pg.citya",
  name: "Field Engineer",
  mobile_number: "9000000002",
  roles: [
    { code: "EMPLOYEE", name: "Employee" },
    { code: "PGR_LME", name: "PGR Last Mile Employee" }
  ],
  department: "DEPT_1",
  designation: "DESIG_5",
  jurisdiction_boundary_type: "City",
  jurisdiction_boundary: "pg.citya"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `Department not found` | Invalid department code | Use `validate_departments` to find valid codes |
| `Designation not found` | Invalid designation code | Use `validate_designations` to find valid codes |
| `Boundary not found` | Invalid jurisdiction boundary code | Use `validate_boundary` to find valid boundary codes |
| `Mobile number already exists` | Another employee has this mobile number | Use a different mobile number or search for the existing employee with `validate_employees` |
| `userName=null` in HRMS response | Known HRMS bug in some versions | The employee may still be created -- check with `validate_employees` |
| `EMPLOYEE role is required` | Roles array missing the base EMPLOYEE role | Always include `{ code: "EMPLOYEE", name: "Employee" }` in the roles array |

## See Also

- [validate_departments](validate_departments.md) -- validate department codes before creating employees
- [validate_designations](validate_designations.md) -- validate designation codes before creating employees
- [validate_boundary](validate_boundary.md) -- validate boundary codes for jurisdiction assignment
- [access_roles_search](access_roles_search.md) -- list all available role codes in the platform
- [employee_update](employee_update.md) -- modify roles or assignments after creation
- [Guide: City Setup](../../guides/city-setup.md) -- end-to-end guide including employee provisioning

# access_roles_search

> Search all defined roles in the DIGIT access control system.

**Group:** `admin` | **Risk:** `read` | **DIGIT Service:** `egov-accesscontrol`

## Description

Returns the complete list of roles defined in the DIGIT access control system for a given tenant. Each role includes its code, display name, and description. This is the authoritative source for valid role codes that can be assigned to employees and users.

Understanding the available roles is essential before creating employees with `employee_create` or adding roles with `user_role_add`. Role codes are referenced throughout the DIGIT platform -- in workflow state machines, MDMS configurations, and API authorization checks.

Common PGR-related roles include: `CITIZEN` (files complaints), `EMPLOYEE` (base role for all staff), `GRO` (Grievance Routing Officer -- assigns complaints), `PGR_LME` (Last Mile Employee -- resolves complaints), `DGRO` (Department GRO), `CSR` (Customer Service Representative), and `SUPERUSER` (full administrative access).

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search roles for (e.g. `"pg"`, `"pg.citya"`) |

## Response

Returns an array of role objects with code, name, and description.

```json
{
  "roles": [
    {
      "code": "GRO",
      "name": "Grievance Routing Officer",
      "description": "Routes and assigns PGR complaints"
    },
    {
      "code": "PGR_LME",
      "name": "PGR Last Mile Employee",
      "description": "Resolves PGR complaints on the ground"
    },
    {
      "code": "CITIZEN",
      "name": "Citizen",
      "description": "Citizen who can file complaints"
    }
  ]
}
```

## Examples

### Basic Usage

List all roles available in the system:

```
access_roles_search({
  tenant_id: "pg"
})
```

### Verify Role Before Employee Creation

Before creating an employee with specific roles, confirm the role codes exist:

```
// Step 1: Search roles
access_roles_search({ tenant_id: "pg" })

// Step 2: Confirm GRO and PGR_LME exist in results, then create employee
employee_create({
  tenant_id: "pg.citya",
  name: "Jane Smith",
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

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Authentication required | Not logged in | Call `configure` first |
| No roles found | Tenant has no role definitions | Verify the tenant exists with `validate_tenant`; roles are typically defined at the state root level |

## See Also

- [employee_create](employee_create.md) -- create employees with role assignments
- [access_actions_search](access_actions_search.md) -- see what permissions each role grants

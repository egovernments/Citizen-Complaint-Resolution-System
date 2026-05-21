# user_search

> Search platform users by username, mobile number, UUID, role, or user type.

**Group:** `admin` | **Risk:** `read` | **DIGIT Service:** `egov-user`

## Description

Searches the DIGIT user service for user accounts matching the provided filters. Returns user details including ID, UUID, username, display name, mobile number, email, user type, active status, tenant ID, and assigned roles. Supports pagination for large result sets.

Users in DIGIT fall into three types: `CITIZEN` (public users who file complaints), `EMPLOYEE` (government staff created via HRMS), and `SYSTEM` (service accounts). Each user has roles scoped to one or more tenants. A single person may have both a CITIZEN user (identified by mobile number) and an EMPLOYEE user (identified by employee code) as separate accounts.

This tool is useful for verifying whether a user exists before creating them, checking what roles a user has on a given tenant, and finding user UUIDs for cross-referencing with other services. For employee-specific data (department, designation, jurisdiction), use `validate_employees` instead.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID to search users in (e.g. `"pg"`, `"pg.citya"`) |
| `user_name` | string | no | -- | Filter by username (exact match) |
| `mobile_number` | string | no | -- | Filter by mobile number (exact match) |
| `uuid` | string[] | no | -- | Filter by one or more user UUIDs |
| `role_codes` | string[] | no | -- | Filter by role codes (e.g. `["CITIZEN", "GRO"]`) |
| `user_type` | string | no | -- | Filter by user type: `"CITIZEN"`, `"EMPLOYEE"`, or `"SYSTEM"` |
| `limit` | number | no | `100` | Maximum results to return |
| `offset` | number | no | `0` | Pagination offset |

## Response

```json
{
  "success": true,
  "tenantId": "pg",
  "count": 2,
  "users": [
    {
      "id": 101,
      "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "userName": "9876543210",
      "name": "John Doe",
      "mobileNumber": "9876543210",
      "emailId": null,
      "type": "CITIZEN",
      "active": true,
      "tenantId": "pg",
      "roles": [
        { "code": "CITIZEN", "name": "Citizen", "tenantId": "pg" }
      ]
    },
    {
      "id": 102,
      "uuid": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "userName": "EMP-0001",
      "name": "Rajesh Kumar",
      "mobileNumber": "9876543211",
      "emailId": "rajesh@example.com",
      "type": "EMPLOYEE",
      "active": true,
      "tenantId": "pg.citya",
      "roles": [
        { "code": "EMPLOYEE", "name": "Employee", "tenantId": "pg" },
        { "code": "GRO", "name": "Grievance Routing Officer", "tenantId": "pg" }
      ]
    }
  ],
  "truncated": false
}
```

## Examples

### Basic Usage

List all users for a tenant:

```
user_search({ tenant_id: "pg" })
```

### Search by Mobile Number

Check if a citizen user already exists:

```
user_search({
  tenant_id: "pg",
  mobile_number: "9876543210"
})
```

### Search by User Type

Find all employee users:

```
user_search({
  tenant_id: "pg",
  user_type: "EMPLOYEE"
})
```

### Search by Role

Find all users with the GRO role:

```
user_search({
  tenant_id: "pg",
  role_codes: ["GRO"]
})
```

### Search by UUID

Look up specific users by their UUIDs:

```
user_search({
  tenant_id: "pg",
  uuid: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"]
})
```

### Paginated Search

Fetch users in batches:

```
user_search({ tenant_id: "pg", limit: 50, offset: 0 })
user_search({ tenant_id: "pg", limit: 50, offset: 50 })
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `totalUsers: 0` | No users match the filter criteria | Broaden the search filters or check the tenant ID |
| Empty response with valid tenant | Users may exist on the city tenant but not the root | Try searching with the city-level tenant ID (e.g. `"pg.citya"` instead of `"pg"`) |

## See Also

- [user_create](user_create.md) -- create a new user account (CITIZEN or EMPLOYEE)
- [user_role_add](user_role_add.md) -- add roles to an existing user for cross-tenant operations
- [validate_employees](validate_employees.md) -- search employees with department/designation details (HRMS-level)

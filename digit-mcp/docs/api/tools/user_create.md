# user_create

> Create a new platform user without OTP validation, typically for citizen accounts or test users.

**Group:** `admin` | **Risk:** `write` | **DIGIT Service:** `egov-user`

## Description

Creates a new user account in the DIGIT platform without requiring OTP (one-time password) verification. This is an admin-level operation primarily used for creating `CITIZEN` users who will file PGR complaints, or for provisioning test accounts in development environments.

For CITIZEN users, the mobile number is used as the username by default. The `CITIZEN` role is automatically added even if not explicitly included in the roles array. The default password is `"eGov@123"` unless overridden.

For creating EMPLOYEE users with department assignments, designation, jurisdiction, and HRMS-level metadata, use `employee_create` instead. That tool creates both the platform user and the HRMS record in a single call. The `user_create` tool only creates the base platform user without any HRMS association.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for the user (e.g. `"pg"`, `"pg.citya"`) |
| `name` | string | yes | -- | Full name of the user |
| `mobile_number` | string | yes | -- | 10-digit mobile number |
| `user_type` | string | no | `"CITIZEN"` | User type: `"CITIZEN"` or `"EMPLOYEE"` |
| `roles` | object[] | no | -- | Roles to assign. Each object has `code` (string) and `name` (string). `CITIZEN` role is auto-added for citizen users |
| `email` | string | no | -- | Email address |
| `gender` | string | no | -- | Gender: `"MALE"`, `"FEMALE"`, or `"TRANSGENDER"` |
| `username` | string | no | mobile number (for CITIZEN) | Username for login. Defaults to mobile number for CITIZEN users. Required for EMPLOYEE users |
| `password` | string | no | `"eGov@123"` | Password for the account |

## Response

```json
{
  "success": true,
  "message": "User created: 9876543210",
  "user": {
    "id": 201,
    "uuid": "c3d4e5f6-a7b8-9012-cdef-123456789012",
    "userName": "9876543210",
    "name": "Amit Patel",
    "mobileNumber": "9876543210",
    "type": "CITIZEN",
    "active": true,
    "tenantId": "pg",
    "roles": ["CITIZEN"]
  }
}
```

## Examples

### Basic Usage

Create a citizen user for filing complaints:

```
user_create({
  tenant_id: "pg",
  name: "Amit Patel",
  mobile_number: "9876543210"
})
```

### Create with Additional Roles

Create a citizen who also has the CSR (Customer Service Representative) role:

```
user_create({
  tenant_id: "pg",
  name: "Sunita Verma",
  mobile_number: "9876543211",
  roles: [
    { code: "CITIZEN", name: "Citizen" },
    { code: "CSR", name: "Customer Service Representative" }
  ]
})
```

### Create with Full Details

Create a user with all optional fields:

```
user_create({
  tenant_id: "pg",
  name: "Kavita Reddy",
  mobile_number: "9876543212",
  email: "kavita@example.com",
  gender: "FEMALE",
  password: "SecurePass@456"
})
```

### Check Before Creating

Avoid duplicates by searching first:

```
// Step 1: Check if user exists
user_search({ tenant_id: "pg", mobile_number: "9876543210" })

// Step 2: Only create if not found
user_create({
  tenant_id: "pg",
  name: "Amit Patel",
  mobile_number: "9876543210"
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Not authenticated` | No active session | Call `configure` first |
| `User already exists` | A user with this mobile number or username already exists on the tenant | Use `user_search` to find the existing user, or use a different mobile number |
| `Invalid mobile number` | Mobile number is not exactly 10 digits | Provide a valid 10-digit mobile number |
| `username is required for EMPLOYEE type` | Creating an EMPLOYEE user without specifying a username | Provide a `username` parameter, or use `employee_create` which handles this automatically |

## See Also

- [user_search](user_search.md) -- search for existing users before creating (avoid duplicates)
- [employee_create](employee_create.md) -- create an EMPLOYEE user with HRMS metadata (preferred for government staff)
- [user_role_add](user_role_add.md) -- add roles to an existing user for cross-tenant access

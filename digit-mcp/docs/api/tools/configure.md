# configure

> Authenticate with a DIGIT environment using OAuth2 credentials.

**Group:** `core` | **Risk:** `read` | **DIGIT Service:** `egov-user`

## Description

The `configure` tool connects to a DIGIT environment by performing an OAuth2 password-grant login against the `/user/oauth/token` endpoint. This must be called before any tool that queries the DIGIT API (MDMS, PGR, HRMS, etc.). Most other core tools like `discover_tools` and `enable_tools` work without authentication.

The tool supports multi-tenant login with automatic fallback. When a `tenant_id` or `state_tenant` is provided, the tool resolves it to a state root (e.g. `"statea.f"` becomes `"statea"`) and attempts login there. If login fails on the target tenant, it falls back to other candidates including the environment default (`"pg"`). After a successful fallback login, the tool auto-provisions cross-tenant roles on the target root so that subsequent direct logins work.

Credentials can be passed as parameters or via the `CRS_USERNAME` and `CRS_PASSWORD` environment variables. The environment variable approach is recommended for automated/CI usage.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `environment` | string | No | `CRS_ENVIRONMENT` env var, or `"chakshu-digit"` | Environment key to connect to. Available: `chakshu-digit`. |
| `username` | string | No | `CRS_USERNAME` env var | DIGIT username (e.g. `"ADMIN"`). For HRMS employees, use the employee code (e.g. `"EMP-CITYA-000001"`), not the mobile number. |
| `password` | string | No | `CRS_PASSWORD` env var | DIGIT password. Default for bootstrapped users: `"eGov@123"`. |
| `tenant_id` | string | No | `CRS_TENANT_ID` env var, or env default | Operational state tenant (e.g. `"statea"`, `"pg"`). Controls which tenant context is used for MDMS queries, role assignments, and API operations. Login uses the user's home tenant to preserve the full role set. |
| `state_tenant` | string | No | -- | Explicitly override the root state tenant for all subsequent operations. This overrides the environment default (e.g. switch from `"pg"` to `"statea"`). |

## Response

Returns authentication status, environment info, and user details.

```json
{
  "success": true,
  "message": "Authenticated as \"ADMIN\" on Chakshu Dev",
  "environment": {
    "name": "Chakshu Dev",
    "url": "https://api.egov.theflywheel.in"
  },
  "stateTenantId": "pg",
  "loginTenantId": "pg",
  "user": {
    "userName": "ADMIN",
    "name": "Admin",
    "tenantId": "pg",
    "roles": ["EMPLOYEE", "CITIZEN", "CSR", "GRO", "PGR_LME", "DGRO", "SUPERUSER"]
  }
}
```

### With cross-tenant role provisioning

When the user is found on a fallback tenant and roles are provisioned for the target:

```json
{
  "success": true,
  "message": "Authenticated as \"ADMIN\" on Chakshu Dev",
  "environment": {
    "name": "Chakshu Dev",
    "url": "https://api.egov.theflywheel.in"
  },
  "stateTenantId": "statea",
  "loginTenantId": "statea",
  "rolesProvisioned": {
    "tenant": "statea",
    "roles": ["CITIZEN", "EMPLOYEE", "CSR", "GRO", "PGR_LME", "DGRO", "SUPERUSER"],
    "note": "Added roles for \"statea\" so direct API login with this tenant now works."
  },
  "user": {
    "userName": "ADMIN",
    "name": "Admin",
    "tenantId": "pg",
    "roles": ["EMPLOYEE", "CITIZEN", "CSR", "GRO", "PGR_LME", "DGRO", "SUPERUSER"]
  }
}
```

## Examples

### Basic Usage -- default environment with env vars

If `CRS_USERNAME` and `CRS_PASSWORD` are set:

```
Tool: configure
Args: {}
```

### Explicit credentials

```
Tool: configure
Args: {
  "environment": "chakshu-digit",
  "username": "ADMIN",
  "password": "eGov@123"
}
```

### Switch to a different state tenant

```
Tool: configure
Args: {
  "username": "ADMIN",
  "password": "eGov@123",
  "state_tenant": "statea"
}
```

This logs in with the `"statea"` root and sets all subsequent MDMS queries, role lookups, and tenant operations to use `"statea"` as the state root.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `"Username and password are required"` | No credentials provided and env vars not set. | Pass `username`/`password` or set `CRS_USERNAME`/`CRS_PASSWORD`. |
| `"Invalid login credentials"` | OAuth2 login failed on all candidate tenants. | Verify the username and password. For HRMS employees, the username is the employee code (e.g. `"EMP-CITYA-000001"`), not the mobile number. Default password: `"eGov@123"`. |
| `"Unknown environment: xyz"` | The `environment` value is not a recognized key. | Use a valid environment key. Currently available: `chakshu-digit`. |

## See Also

- [get_environment_info](get_environment_info.md) -- view current environment and auth status without re-authenticating
- [health_check](health_check.md) -- verify DIGIT services are reachable after authenticating

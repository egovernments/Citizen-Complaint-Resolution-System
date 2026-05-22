# get_environment_info

> Show the current DIGIT environment configuration, authentication status, and available environments.

**Group:** `core` | **Risk:** `read` | **DIGIT Service:** --

## Description

The `get_environment_info` tool returns the current environment's name, API URL, and state tenant ID, along with the authentication status and a list of all available environments. It does not make any API calls to DIGIT -- it reads from the in-memory configuration.

This tool can also switch the active environment or override the state tenant. Switching the environment clears any existing authentication, so you will need to call `configure` again after switching. Overriding the state tenant changes the root context for all subsequent MDMS queries, role assignments, and tenant lookups without requiring re-authentication.

Use this tool to verify your current connection state, to inspect what environments are available, or to switch context between different DIGIT deployments.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `switch_to` | string | No | -- | Switch to a different environment before returning info. Available keys: `chakshu-digit`. Clears authentication state. |
| `state_tenant` | string | No | -- | Override the root state tenant (e.g. switch from `"pg"` to `"statea"`). Does not require re-authentication. |

## Response

Returns the current environment details, auth status, and all available environments.

```json
{
  "success": true,
  "current": {
    "name": "Chakshu Dev",
    "url": "https://api.egov.theflywheel.in",
    "stateTenantId": "pg"
  },
  "authenticated": true,
  "user": {
    "userName": "ADMIN",
    "tenantId": "pg"
  },
  "available": [
    {
      "key": "chakshu-digit",
      "name": "Chakshu Dev",
      "url": "https://api.egov.theflywheel.in",
      "defaultStateTenantId": "pg"
    }
  ]
}
```

### When not authenticated

```json
{
  "success": true,
  "current": {
    "name": "Chakshu Dev",
    "url": "https://api.egov.theflywheel.in",
    "stateTenantId": "pg"
  },
  "authenticated": false,
  "user": null,
  "available": [
    {
      "key": "chakshu-digit",
      "name": "Chakshu Dev",
      "url": "https://api.egov.theflywheel.in",
      "defaultStateTenantId": "pg"
    }
  ]
}
```

## Examples

### Basic Usage -- check current state

```
Tool: get_environment_info
Args: {}
```

### Override the state tenant

```
Tool: get_environment_info
Args: {
  "state_tenant": "statea"
}
```

After this call, all MDMS queries and tenant lookups will use `"statea"` as the root instead of the environment default.

### Switch environment

```
Tool: get_environment_info
Args: {
  "switch_to": "chakshu-digit"
}
```

Switches the active environment. Authentication is cleared -- call `configure` next.

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `"Unknown environment: xyz"` | The `switch_to` value is not a recognized environment key. | Use a valid environment key. Currently available: `chakshu-digit`. |

This tool does not make any network calls, so network errors do not apply.

## See Also

- [configure](configure.md) -- authenticate with the current or a new environment
- [health_check](health_check.md) -- verify DIGIT services are reachable

# discover_tools

> List all available tool groups showing which are enabled and what tools each group contains.

**Group:** `core` | **Risk:** `read` | **DIGIT Service:** --

## Description

The `discover_tools` tool provides a complete inventory of all tools registered in the MCP server, organized by group. It shows which groups are currently enabled and which are disabled, along with the tools in each group. This is the primary way to understand what capabilities are available before deciding which groups to enable.

The server uses progressive disclosure: only the `core` group (and `docs` after `init`) is enabled by default. All other groups start disabled. Calling `discover_tools` shows the full catalog without enabling anything. Use `enable_tools` to activate groups you need.

This tool takes no parameters and does not require authentication. It works immediately, even before connecting to a DIGIT environment.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| *(none)* | -- | -- | -- | This tool accepts no parameters. |

## Response

Returns tool counts (enabled vs. total), and a groups object with each group's status, description, and tool list.

```json
{
  "success": true,
  "message": "8 of 59 tools enabled",
  "groups": {
    "core": {
      "enabled": true,
      "tools": [
        "init",
        "session_checkpoint",
        "discover_tools",
        "enable_tools",
        "configure",
        "get_environment_info",
        "mdms_get_tenants",
        "health_check"
      ]
    },
    "mdms": {
      "enabled": false,
      "tools": [
        "validate_tenant",
        "mdms_search",
        "mdms_schema_search",
        "mdms_schema_create",
        "mdms_create",
        "tenant_bootstrap",
        "city_setup",
        "tenant_cleanup"
      ]
    },
    "pgr": {
      "enabled": false,
      "tools": [
        "pgr_search",
        "pgr_create",
        "pgr_update",
        "workflow_business_services",
        "workflow_process_search",
        "workflow_create"
      ]
    }
  },
  "usage": "Call enable_tools with group names to load more tools. Groups: mdms (...), boundary (...), masters (...), employees (...), localization (...), pgr (...), admin (...), idgen (...), location (...), encryption (...), docs (...), monitoring (...), tracing (...)."
}
```

*(The response includes all 14 groups; the example above is abbreviated.)*

## Examples

### Basic Usage

```
Tool: discover_tools
Args: {}
```

Returns the full group inventory. Review the output to decide which groups to enable.

### Typical workflow

1. Call `discover_tools` to see what is available.
2. Call `enable_tools` with the groups you need (e.g. `["pgr", "masters"]`).
3. The MCP client re-fetches the tool list automatically (server sends `tools/list_changed`).

## Errors

This tool has no failure modes. It always succeeds and returns the current tool registry state.

## See Also

- [enable_tools](enable_tools.md) -- enable or disable tool groups after reviewing what is available
- [init](init.md) -- auto-enable groups based on intent (alternative to manual discovery)

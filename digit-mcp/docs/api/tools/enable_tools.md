# enable_tools

> Enable or disable tool groups on demand to control which capabilities are visible.

**Group:** `core` | **Risk:** `read` | **DIGIT Service:** --

## Description

The `enable_tools` tool controls which tool groups are active in the MCP server. The DIGIT MCP server uses progressive disclosure -- it starts with only the `core` group enabled (8 tools). Enabling a group makes its tools visible to the MCP client; disabling a group hides them.

When groups are enabled or disabled, the server sends a `tools/list_changed` MCP notification so the client (e.g. Claude Code) automatically re-fetches the updated tool list. This means newly enabled tools become immediately available for use.

The `core` group cannot be disabled. Attempting to disable it will be silently ignored. You can enable and disable groups in the same call.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `enable` | string[] | No | -- | Group names to enable. Valid values: `core`, `mdms`, `boundary`, `masters`, `employees`, `localization`, `pgr`, `admin`, `idgen`, `location`, `encryption`, `docs`, `monitoring`, `tracing`. |
| `disable` | string[] | No | -- | Group names to disable. Cannot include `core`. Valid values: `mdms`, `boundary`, `masters`, `employees`, `localization`, `pgr`, `admin`, `idgen`, `location`, `encryption`, `docs`, `monitoring`, `tracing`. |

### Available groups

| Group | Tools | Description |
|-------|-------|-------------|
| `core` | 8 | Always enabled. Session management, environment config, health check, tenant listing. |
| `mdms` | 8 | Tenant validation, MDMS search/create, schema management, tenant bootstrap/cleanup. |
| `boundary` | 7 | Boundary hierarchy definitions, boundary entity CRUD, boundary management service. |
| `masters` | 3 | Department, designation, and complaint type validators. |
| `employees` | 3 | HRMS employee create, update, and validation. |
| `localization` | 2 | Search and upsert UI label translations. |
| `pgr` | 6 | PGR complaint search/create/update, workflow business services, workflow process search. |
| `admin` | 7 | Filestore upload/download, access control roles/actions, user search/create/role-add. |
| `idgen` | 1 | ID generation using configured formats. |
| `location` | 1 | Legacy egov-location boundary search. |
| `encryption` | 2 | Encrypt and decrypt data via egov-enc-service. |
| `docs` | 3 | Search DIGIT documentation, fetch doc pages, OpenAPI API catalog. |
| `monitoring` | 4 | Kafka lag, persister errors, DB row counts, composite persister health monitor. |
| `tracing` | 5 | Distributed trace search, trace detail, debug, slow trace finder, tracing health. |

## Response

Returns the result of enable/disable operations, the list of currently active groups, and updated tool counts.

```json
{
  "success": true,
  "enabled": {
    "pgr": ["pgr_search", "pgr_create", "pgr_update", "workflow_business_services", "workflow_process_search", "workflow_create"],
    "masters": ["validate_departments", "validate_designations", "validate_complaint_types"]
  },
  "disabled": null,
  "activeGroups": ["core", "docs", "pgr", "masters"],
  "toolCount": "19 of 59 tools now enabled"
}
```

## Examples

### Enable PGR and employee groups

```
Tool: enable_tools
Args: {
  "enable": ["pgr", "employees", "masters"]
}
```

### Disable a group you no longer need

```
Tool: enable_tools
Args: {
  "disable": ["tracing", "monitoring"]
}
```

### Enable and disable in one call

```
Tool: enable_tools
Args: {
  "enable": ["boundary", "mdms"],
  "disable": ["localization"]
}
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Invalid group name | A string in `enable` or `disable` is not a recognized group. | Use one of the 14 valid group names listed above. |

Attempting to disable `core` is silently ignored (not an error). Enabling an already-enabled group or disabling an already-disabled group are no-ops.

## See Also

- [discover_tools](discover_tools.md) -- view all groups and their tools before enabling
- [init](init.md) -- auto-enable groups based on user intent (alternative to manual enable)

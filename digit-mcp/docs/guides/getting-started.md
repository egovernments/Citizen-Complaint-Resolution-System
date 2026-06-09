# Getting Started

> Connect to the DIGIT platform, authenticate, and run your first queries in under 5 minutes.

---

## Prerequisites

- **Node.js 22+** installed (`node --version` to check)
- A running DIGIT environment, or access to the remote `chakshu-digit` environment
- The MCP server built and ready:

```bash
cd /path/to/DIGIT-MCP
npm install
npm run build
```

This compiles TypeScript to `dist/index.js`, which is the entry point for all transport modes.

---

## Step 1: Configure Your MCP Client

### Claude Code (stdio transport)

Add the server to `~/.claude/settings.json` (global) or `.mcp.json` (per-project):

```json
{
  "mcpServers": {
    "digit-mcp": {
      "command": "node",
      "args": ["/path/to/DIGIT-MCP/dist/index.js"],
      "env": {
        "CRS_ENVIRONMENT": "chakshu-digit",
        "CRS_USERNAME": "ADMIN",
        "CRS_PASSWORD": "eGov@123"
      }
    }
  }
}
```

When credentials are set via environment variables, the server auto-authenticates on the first API call -- no manual login step needed.

### HTTP transport (Docker, Kubernetes, remote clients)

Set `MCP_TRANSPORT=http` to start the server as an HTTP endpoint instead of stdio:

```bash
MCP_TRANSPORT=http MCP_PORT=3000 node dist/index.js
```

The server listens on `/mcp` (MCP JSON-RPC), `/healthz` (liveness probe), and `/` (session viewer UI). See [Architecture -- Dual Transport](../architecture.md#3-dual-transport) for details.

---

## Step 2: Authenticate

Call [`configure`](../api/tools/configure.md) to log in to a DIGIT environment:

```
Tool: configure
Args: {
  "environment": "chakshu-digit",
  "username": "ADMIN",
  "password": "eGov@123"
}
```

Response:

```json
{
  "success": true,
  "message": "Authenticated as \"ADMIN\" on Chakshu Dev",
  "environment": {
    "name": "Chakshu Dev",
    "url": "https://api.egov.theflywheel.in"
  },
  "stateTenantId": "pg",
  "user": {
    "userName": "ADMIN",
    "name": "Admin",
    "roles": ["EMPLOYEE", "CITIZEN", "CSR", "GRO", "PGR_LME", "DGRO", "SUPERUSER"]
  }
}
```

If you set `CRS_USERNAME` and `CRS_PASSWORD` as environment variables in Step 1, the server auto-authenticates on the first API call and you can skip this step entirely.

---

## Step 3: Discover Available Tools

Call [`discover_tools`](../api/tools/discover_tools.md) with no parameters to see the full tool catalog:

```
Tool: discover_tools
Args: {}
```

Response (abbreviated):

```json
{
  "success": true,
  "message": "8 of 59 tools enabled",
  "groups": {
    "core": {
      "enabled": true,
      "tools": ["init", "session_checkpoint", "discover_tools", "enable_tools",
                "configure", "get_environment_info", "mdms_get_tenants", "health_check"]
    },
    "mdms": {
      "enabled": false,
      "tools": ["validate_tenant", "mdms_search", "mdms_create", "tenant_bootstrap", "..."]
    },
    "pgr": {
      "enabled": false,
      "tools": ["pgr_search", "pgr_create", "pgr_update", "..."]
    }
  }
}
```

The server uses **progressive disclosure**: only the `core` group (8 tools) is enabled at startup. This keeps the LLM's context window clean. You unlock additional groups as needed.

---

## Step 4: Enable Tool Groups

Call [`enable_tools`](../api/tools/enable_tools.md) to activate the groups you need:

```
Tool: enable_tools
Args: {
  "enable": ["pgr", "masters", "mdms"]
}
```

Response:

```json
{
  "success": true,
  "enabled": {
    "pgr": ["pgr_search", "pgr_create", "pgr_update", "workflow_business_services", "..."],
    "masters": ["validate_departments", "validate_designations", "validate_complaint_types"],
    "mdms": ["validate_tenant", "mdms_search", "mdms_create", "tenant_bootstrap", "..."]
  },
  "activeGroups": ["core", "docs", "pgr", "masters", "mdms"],
  "toolCount": "25 of 59 tools now enabled"
}
```

The MCP client automatically re-fetches the tool list when groups change (the server sends a `tools/list_changed` notification).

**Shortcut:** Instead of manually discovering and enabling groups, call [`init`](../api/tools/init.md) with a description of your intent. It auto-enables the relevant groups:

```
Tool: init
Args: {
  "user_name": "chakshu",
  "purpose": "set up PGR complaints for a new city"
}
```

This enables `core`, `pgr`, `masters`, `admin`, `boundary`, and `docs` in one call.

---

## Step 5: List Tenants

Call [`mdms_get_tenants`](../api/tools/mdms_get_tenants.md) to see the available tenants:

```
Tool: mdms_get_tenants
Args: {}
```

Response (abbreviated):

```json
{
  "success": true,
  "environment": "Chakshu Dev",
  "count": 5,
  "tenants": [
    { "code": "pg",        "name": "Punjab" },
    { "code": "pg.citya",  "name": "City A" },
    { "code": "pg.cityb",  "name": "City B" },
    { "code": "statea",    "name": "statea" },
    { "code": "statea.f",  "name": "City F" }
  ]
}
```

DIGIT uses a two-level tenant hierarchy:

- **State tenants** (roots): `pg`, `statea` -- store master data, schemas, workflow definitions
- **City tenants** (leaves): `pg.citya`, `statea.f` -- store complaints, employees, boundaries

Most operational tools (PGR, HRMS, boundaries) operate at the city-tenant level.

---

## Step 6: Check System Health

Call [`health_check`](../api/tools/health_check.md) to verify all DIGIT services are running:

```
Tool: health_check
Args: {}
```

Response (abbreviated):

```json
{
  "success": true,
  "environment": "Chakshu Dev",
  "summary": {
    "total": 11,
    "healthy": 11,
    "unhealthy": 0,
    "skipped": 0
  },
  "services": [
    { "service": "egov-mdms-service",  "status": "healthy", "responseTimeMs": 142 },
    { "service": "pgr-services",       "status": "healthy", "responseTimeMs": 156 },
    { "service": "egov-workflow-v2",    "status": "healthy", "responseTimeMs": 98 },
    { "service": "egov-hrms",          "status": "healthy", "responseTimeMs": 203 },
    { "service": "boundary-service",   "status": "healthy", "responseTimeMs": 89 }
  ]
}
```

If a service shows `"unhealthy"`, check that the DIGIT Docker environment is running. Services that require authentication are skipped if you have not yet called [`configure`](../api/tools/configure.md).

---

## Quick Recap

| Step | Tool | Purpose |
|------|------|---------|
| 1 | *(config file)* | Point your MCP client at `dist/index.js` with credentials |
| 2 | [`configure`](../api/tools/configure.md) | Authenticate with DIGIT (or rely on auto-login via env vars) |
| 3 | [`discover_tools`](../api/tools/discover_tools.md) | See all 14 groups and 59 tools |
| 4 | [`enable_tools`](../api/tools/enable_tools.md) | Unlock the groups you need |
| 5 | [`mdms_get_tenants`](../api/tools/mdms_get_tenants.md) | Find available tenants |
| 6 | [`health_check`](../api/tools/health_check.md) | Verify services are up |

---

## What's Next

- **[City Setup Guide](city-setup.md)** -- Bootstrap a new tenant from scratch and configure PGR end-to-end
- **[PGR Complaint Lifecycle](pgr-lifecycle.md)** -- Create, assign, resolve, and rate complaints through the full workflow
- **[Debugging & Monitoring](debugging.md)** -- Trace API failures, inspect Kafka lag, and monitor persister health
- **[Architecture](../architecture.md)** -- Understand progressive disclosure, dual transport, and the multi-tenant model
- **[API Reference](../api/README.md)** -- Detailed per-tool documentation for all 59 tools

---

## Troubleshooting

### "Not authenticated" errors

Most tools require authentication. Either:

1. Set `CRS_USERNAME` and `CRS_PASSWORD` environment variables in your MCP client config (recommended -- enables auto-login), or
2. Call [`configure`](../api/tools/configure.md) explicitly at the start of your session.

### Tools not appearing

The server starts with only `core` tools visible. Call [`enable_tools`](../api/tools/enable_tools.md) or [`init`](../api/tools/init.md) to unlock additional groups. Use [`discover_tools`](../api/tools/discover_tools.md) to see what is available.

### Connection refused / fetch failed

Verify the DIGIT environment is reachable. For the `chakshu-digit` environment, the API is at `https://api.egov.theflywheel.in`. For local Docker setups, ensure containers are running:

```bash
cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml ps
```

### Cross-tenant authorization failures

If you see "User is not authorized" when operating on a tenant other than `pg`, the admin user's roles may not be tagged to that tenant root. Enable the `admin` group and call [`user_role_add`](../api/tools/user_role_add.md) to provision roles for the target tenant.

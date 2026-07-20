# DIGIT MCP Server Documentation

MCP server that bridges Claude to the DIGIT eGov platform -- 60 tools across 14 groups covering tenant management, grievance redressal (PGR), employee management, workflow, and observability.

## Guides

Start here if you want to get something done.

| Guide | Description |
|-------|-------------|
| [Getting Started](guides/getting-started.md) | Connect, authenticate, discover tools |
| [City Setup](guides/city-setup.md) | Bootstrap a new tenant and set up PGR end-to-end |
| [PGR Complaint Lifecycle](guides/pgr-lifecycle.md) | Create, assign, resolve, and rate complaints |
| [Debugging & Monitoring](guides/debugging.md) | Trace failures, monitor persister health, inspect Kafka lag |
| [API Nuances & Gotchas](guides/api-nuances.md) | Known DIGIT API quirks, format mismatches, and deployment-specific fixes |
| [Building a PGR UI](ui.md) | Complete guide to building complaint management frontends |

## Architecture

See [architecture.md](architecture.md) for how the server works internally: progressive disclosure, dual transport (stdio + SSE), multi-tenant model, tool group system, session management, security boundaries, and deployment topology.

## API Reference

See [api/README.md](api/README.md) for full tool documentation organized by group.

### Tool Groups at a Glance

All tools start disabled except `core`. Enable groups on demand with `enable_tools`.

| Group | Tools | Purpose | Enable |
|-------|------:|---------|--------|
| **core** | 8 | Discovery, auth, environment, health check | Always on |
| **mdms** | 8 | Master data search/create, schema management, tenant bootstrap/cleanup | `enable_tools(["mdms"])` |
| **boundary** | 7 | Boundary hierarchy definition + entity CRUD | `enable_tools(["boundary"])` |
| **masters** | 3 | Validate departments, designations, complaint types | `enable_tools(["masters"])` |
| **employees** | 3 | HRMS employee create, update, validate | `enable_tools(["employees"])` |
| **localization** | 2 | Search and upsert UI label translations | `enable_tools(["localization"])` |
| **pgr** | 6 | PGR complaints + workflow actions + business services | `enable_tools(["pgr"])` |
| **admin** | 4 | Filestore upload/download, access control roles/actions | `enable_tools(["admin"])` |
| (admin) | 3 | User search, create, role management | Included in admin |
| **idgen** | 1 | ID generation (complaint numbers, application IDs) | `enable_tools(["idgen"])` |
| **location** | 1 | Geographic boundaries via legacy egov-location | `enable_tools(["location"])` |
| **encryption** | 2 | Encrypt and decrypt sensitive data | `enable_tools(["encryption"])` |
| **docs** | 3 | Search docs.digit.org + fetch pages + API catalog | `enable_tools(["docs"])` |
| **monitoring** | 4 | Kafka lag, persister errors, DB row counts, composite monitor | `enable_tools(["monitoring"])` |
| **tracing** | 5 | Distributed trace search, debug, slow-query detection | `enable_tools(["tracing"])` |

### Common Workflows

**Set up a new city with PGR:**
`configure` -> `tenant_bootstrap` -> `city_setup` -> `employee_create` -> `pgr_create`

**Debug a failed API call:**
`enable_tools(["tracing"])` -> `trace_debug` -> `trace_get`

**Check platform health:**
`health_check` -> `enable_tools(["monitoring"])` -> `persister_monitor`

## Quick Reference

| Item | Value |
|------|-------|
| Environments | `chakshu-digit` (remote), `dev` (unified-dev.digit.org), `local` (Docker at localhost:18000) |
| Default credentials | `ADMIN` / `eGov@123` |
| Transport | stdio (Claude Code) or SSE (HTTP clients on port 3001) |
| Installation | See [repo README](../README.md) |

## File Map

```
docs/
  README.md              <- You are here
  architecture.md        <- Server internals and design decisions
  ui.md                  <- PGR frontend development guide
  api/
    README.md            <- API reference index
    tools/               <- Per-tool documentation (auto-generated)
  guides/
    getting-started.md   <- First-run walkthrough
    city-setup.md        <- Tenant provisioning guide
    pgr-lifecycle.md     <- End-to-end PGR workflow
    debugging.md         <- Observability and troubleshooting
    api-nuances.md       <- Known API quirks and gotchas
```

# DIGIT MCP Server Documentation Design

## Date: 2026-02-28

## Goal

Create comprehensive, progressively-disclosed documentation for the DIGIT MCP Server. Three deliverables:

1. **Guides** — Task-oriented walkthroughs for common workflows
2. **Architecture doc** — Design decisions and system internals
3. **API reference (BIBLE)** — One file per tool, 59 total

## Audience

Multiple audiences served through progressive disclosure:
- **DIGIT platform developers** enter via guides, drill into API reference
- **AI/MCP developers** enter via architecture doc, reference tools as needed
- **City administrators** follow guides end-to-end without needing internals

## Directory Structure

```
docs/
├── README.md                     # Docs index — progressive disclosure entry point
├── architecture.md               # Design decisions, system internals
├── guides/
│   ├── getting-started.md        # Connect, authenticate, discover tools
│   ├── city-setup.md             # Full tenant bootstrap workflow
│   ├── pgr-lifecycle.md          # Complaint create → assign → resolve/reject → rate
│   └── debugging.md              # Tracing, monitoring, health checks
├── api/
│   ├── README.md                 # API reference index grouped by domain
│   └── tools/
│       ├── configure.md          # 59 individual tool files
│       ├── discover_tools.md
│       ├── enable_tools.md
│       ├── get_environment_info.md
│       ├── mdms_get_tenants.md
│       ├── health_check.md
│       ├── validate_tenant.md
│       ├── mdms_search.md
│       ├── mdms_create.md
│       ├── mdms_schema_search.md
│       ├── mdms_schema_create.md
│       ├── tenant_bootstrap.md
│       ├── city_setup.md
│       ├── tenant_cleanup.md
│       ├── validate_boundary.md
│       ├── boundary_hierarchy_search.md
│       ├── boundary_create.md
│       ├── boundary_mgmt_process.md
│       ├── boundary_mgmt_search.md
│       ├── boundary_mgmt_generate.md
│       ├── boundary_mgmt_download.md
│       ├── validate_departments.md
│       ├── validate_designations.md
│       ├── validate_complaint_types.md
│       ├── validate_employees.md
│       ├── employee_create.md
│       ├── employee_update.md
│       ├── user_search.md
│       ├── user_create.md
│       ├── user_role_add.md
│       ├── localization_search.md
│       ├── localization_upsert.md
│       ├── pgr_search.md
│       ├── pgr_create.md
│       ├── pgr_update.md
│       ├── workflow_business_services.md
│       ├── workflow_process_search.md
│       ├── workflow_create.md
│       ├── filestore_get_urls.md
│       ├── filestore_upload.md
│       ├── access_roles_search.md
│       ├── access_actions_search.md
│       ├── idgen_generate.md
│       ├── location_search.md
│       ├── encrypt_data.md
│       ├── decrypt_data.md
│       ├── docs_search.md
│       ├── docs_get.md
│       ├── api_catalog.md
│       ├── kafka_lag.md
│       ├── persister_errors.md
│       ├── db_counts.md
│       ├── persister_monitor.md
│       ├── tracing_health.md
│       ├── trace_search.md
│       ├── trace_get.md
│       ├── trace_debug.md
│       ├── trace_slow.md
│       ├── init.md
│       └── session_checkpoint.md
└── ui.md                         # (existing) PGR UI building guide
```

## Document Templates

### docs/README.md — Docs Index

Progressive disclosure entry point. Three paths based on what you want to do:

- **"I want to get something done"** → Guides
- **"I want to understand how this works"** → Architecture
- **"I need the details on a specific tool"** → API Reference

Includes a quick-reference table of all 14 tool groups with one-line descriptions and links.

### Guide Template

Each guide follows this structure:

```markdown
# Guide Title

> One-sentence summary of what you'll accomplish.

## Prerequisites
What you need before starting (tools enabled, auth, etc.)

## Steps
Numbered walkthrough with:
- Tool calls shown as code blocks
- Expected responses (abbreviated)
- Decision points explained
- Error scenarios and recovery

## What's Next
Links to related guides and relevant API reference pages.
```

Guides reference API tool pages for parameter details rather than duplicating them.

### architecture.md

Sections:

1. **Overview** — What this is and why it exists
2. **Progressive Disclosure** — Why not expose all tools at once; the group system; `listChanged` notifications
3. **Dual Transport** — stdio vs HTTP; when to use each; stateless HTTP design
4. **Multi-Tenant Model** — State vs city tenants; auto-derivation; cross-tenant auth
5. **Tool System** — ToolRegistry, registration pattern, handler contract, error handling
6. **DIGIT API Client** — Singleton pattern, auth flow, request building, multi-tenant resolution
7. **Session Management** — In-memory vs PostgreSQL; checkpointing; viewer UI
8. **Observability** — Distributed tracing integration; monitoring probes; health checks
9. **Security Model** — Read vs write tool classification; role-based access in DIGIT; no credential storage
10. **Deployment Models** — Local stdio, Docker, Kubernetes/Helm, PM2

### Per-Tool File Template (api/tools/*.md)

```markdown
# tool_name

> One-sentence description.

**Group:** `group_name` | **Risk:** `read` or `write` | **DIGIT Service:** `service-name`

## Description
2-3 paragraphs explaining what this tool does, when to use it, and how it fits
into the broader workflow. Not just a repeat of the schema description — adds
context, explains the "why".

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| param_1   | string | Yes | — | What this parameter controls |
| param_2   | number | No | 100 | What this defaults to and why |

## Response
Description of the response shape with a JSON example.

## Examples

### Basic Usage
Tool call + response showing the simplest case.

### Advanced Usage
Tool call + response showing optional parameters, edge cases.

## Errors
Common error scenarios and what they mean:
- "Not authenticated" — call `configure` first
- "Tenant not found" — verify tenant code with `validate_tenant`

## See Also
- [related_tool](related_tool.md) — how it connects
- [Guide: City Setup](../../guides/city-setup.md) — used in step 3
```

### api/README.md — API Reference Index

Tools grouped by domain with one-line descriptions:

```markdown
# API Reference

## Core (always enabled)
| Tool | Description |
|------|-------------|
| [configure](tools/configure.md) | Authenticate with a DIGIT environment |
| ... | ... |

## MDMS & Tenants (enable: `mdms`)
| Tool | Description |
|------|-------------|
| [mdms_search](tools/mdms_search.md) | Search MDMS v2 records by schema code |
| ... | ... |

(repeat for all 14 groups)
```

## Guide Outlines

### 1. Getting Started (`guides/getting-started.md`)

1. Install and configure the MCP server (stdio or HTTP)
2. Authenticate with `configure`
3. Explore available tools with `discover_tools`
4. Enable your first tool group with `enable_tools`
5. Run a simple query — list tenants with `mdms_get_tenants`
6. Check system health with `health_check`

### 2. City Setup (`guides/city-setup.md`)

1. Bootstrap the state tenant root with `tenant_bootstrap`
2. Create a city tenant with `city_setup`
3. Verify boundaries with `validate_boundary`
4. Add departments with `mdms_create`
5. Add designations with `mdms_create`
6. Add complaint types (service definitions) with `mdms_create`
7. Create employees (GRO, LME) with `employee_create`
8. Add localization labels with `localization_upsert`
9. Verify everything with the validator tools
10. File a test complaint to confirm the setup works

### 3. PGR Complaint Lifecycle (`guides/pgr-lifecycle.md`)

1. Search existing complaints with `pgr_search`
2. Create a complaint with `pgr_create`
3. Check workflow state with `workflow_process_search`
4. Assign to employee (GRO action) with `pgr_update` ASSIGN
5. Resolve the complaint (LME action) with `pgr_update` RESOLVE
6. Rate and close (citizen action) with `pgr_update` RATE
7. Alternative flows: REJECT, REOPEN, REASSIGN
8. Bulk operations and edge cases

### 4. Debugging & Monitoring (`guides/debugging.md`)

1. Check tracing infrastructure with `tracing_health`
2. Debug a failed API call with `trace_debug`
3. Find slow requests with `trace_slow`
4. Inspect a specific trace with `trace_get`
5. Monitor persister health with `persister_monitor`
6. Check Kafka consumer lag with `kafka_lag`
7. Scan persister error logs with `persister_errors`
8. Verify database row counts with `db_counts`

## Writing Principles

- **Show, don't tell** — Every concept illustrated with a real tool call and response
- **Progressive disclosure in prose** — Start with the simplest usage, add complexity gradually
- **Cross-link aggressively** — Guides link to tool pages; tool pages link back to guides
- **No duplication** — Parameter details live in tool pages only; guides reference them
- **Real data** — Examples use real tenant codes (`pg.citya`, `statea.f`), real service codes (`StreetLightNotWorking`), real department codes (`DEPT_1`)
- **Error-first** — Common errors documented before edge cases

## Scope

**In scope:**
- All 59 tools documented individually
- 4 guides covering core workflows
- Architecture document
- Docs index with progressive disclosure
- API reference index

**Out of scope:**
- Docs site / static site generation (just markdown in repo)
- Auto-generation scripts
- Updating the existing README.md (it stays as the repo entry point)
- Modifying docs/ui.md (already comprehensive)
- Video or interactive tutorials

## Estimated Size

- **docs/README.md**: ~80 lines
- **docs/architecture.md**: ~300-400 lines
- **4 guides**: ~150-250 lines each
- **59 tool files**: ~60-100 lines each
- **api/README.md**: ~120 lines
- **Total**: ~5,000-7,500 lines of markdown

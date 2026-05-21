# DIGIT MCP Documentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create comprehensive, progressively-disclosed documentation for the DIGIT MCP Server — 4 guides, 1 architecture doc, 59 per-tool API reference files, and 2 index files.

**Architecture:** Markdown files in `docs/` organized into three tiers: index (entry point), guides (task-oriented), and API reference (per-tool BIBLE). Cross-linked aggressively. Progressive disclosure mirrors the server's own design.

**Tech Stack:** Markdown, Git

**Design doc:** [2026-02-28-documentation-design.md](2026-02-28-documentation-design.md)

---

### Task 1: Scaffold directory structure

**Files:**
- Create: `docs/guides/` (directory)
- Create: `docs/api/tools/` (directory)

**Step 1: Create directories**

```bash
mkdir -p /root/DIGIT-MCP/docs/guides /root/DIGIT-MCP/docs/api/tools
```

**Step 2: Commit**

```bash
cd /root/DIGIT-MCP
git add docs/guides docs/api/tools
git commit --allow-empty -m "docs: scaffold documentation directory structure"
```

---

### Task 2: Write docs/README.md (docs index)

**Files:**
- Create: `docs/README.md`

**Step 1: Write the docs index**

Progressive disclosure entry point with three paths:
- "I want to get something done" → Guides
- "I want to understand how this works" → Architecture
- "I need details on a specific tool" → API Reference

Include a table of all 14 tool groups with one-line descriptions and link to the API reference index. Link to each guide. Link to architecture doc.

Content structure:
```markdown
# DIGIT MCP Server Documentation

> One-sentence intro

## Guides
Table linking to each of the 4 guides with one-line descriptions.

## Architecture
Link to architecture.md with brief description.

## API Reference
Link to api/README.md. Table of all 14 tool groups with tool counts and one-line purposes.

## Quick Reference
- Environments table (chakshu-digit, dev, local)
- Common env vars
- Link back to repo README for installation
```

**Step 2: Commit**

```bash
git add docs/README.md && git commit -m "docs: add documentation index with progressive disclosure entry points"
```

---

### Task 3: Write docs/architecture.md

**Files:**
- Create: `docs/architecture.md`

**Step 1: Write the architecture document**

This is the "why" document. 10 sections, each explaining a design decision with enough context for someone who knows MCP but not DIGIT (or vice versa). Use diagrams where helpful (ASCII or mermaid).

Sections (see design doc for full outline):

1. **Overview** — What this server is. MCP protocol bridge to DIGIT eGov platform. 60 tools, 14 groups, 16 DIGIT services.

2. **Progressive Disclosure** — Problem: 60 tools overwhelm the LLM context. Solution: start with 8 (core + docs), unlock on demand via `enable_tools`. `tools/list_changed` notification triggers client re-fetch. `core` group cannot be disabled. `MCP_ENABLE_ALL_GROUPS=1` for testing.

3. **Dual Transport** — stdio for local Claude Code (stateful, one session per process). HTTP for containers/K8s (stateless, each request gets fresh server, horizontal scaling). HTTP also serves session viewer UI and REST API for session querying.

4. **Multi-Tenant Model** — DIGIT hierarchy: state tenant (root) → city tenant (leaf). Examples: `pg` → `pg.citya`. Auto-derivation: `pg.citya.split('.')[0]` = `pg`. Cross-tenant auth: roles must be tagged to target tenant root. `user_role_add` fixes cross-tenant issues.

5. **Tool System** — `ToolRegistry` stores `Map<string, ToolMetadata>`. Registration pattern: each domain has `registerXyzTools(registry)`. Handler contract: accepts `Record<string, unknown>`, returns `Promise<string>` (JSON). Error handling: caught in `server.ts`, returned with `isError: true`.

6. **DIGIT API Client** — Singleton `digitApi`. OAuth2 password grant. `buildRequestInfo()` creates standard DIGIT envelope. All requests through `request<T>()`. Special handling: encryption (non-standard response), filestore (multipart), PGR/workflow (query params).

7. **Session Management** — Dual-layer persistence: JSONL (always works) + PostgreSQL (best-effort, fire-and-forget writes). Session tracking: tool calls, results, checkpoints, messages. Nudge mechanism: suggest checkpoint every 8 tool calls. Sensitive field sanitization.

8. **Observability** — OpenTelemetry → Grafana Tempo integration. `trace_debug` composite tool: search + get in one call. Monitoring probes: Kafka lag (rpk), persister errors (docker logs), DB counts (psql). `persister_monitor` runs all probes and cross-references.

9. **Security Model** — Read vs write risk classification. No credential storage (env vars or per-session login). DIGIT RBAC: roles scoped to tenant roots. Admin user pattern for testing. Cross-tenant role propagation via `user_role_add`.

10. **Deployment Models** — Local stdio (Claude Code settings.json). Docker (multi-stage Alpine build). Kubernetes (Helm chart with ConfigMap, Secret, Deployment, Service). PM2 (ecosystem.config.cjs).

**Step 2: Commit**

```bash
git add docs/architecture.md && git commit -m "docs: add architecture document covering design decisions and system internals"
```

---

### Task 4: Write docs/api/README.md (API reference index)

**Files:**
- Create: `docs/api/README.md`

**Step 1: Write the API reference index**

Group all 60 tools by their 14 groups. Each group gets a table with tool name (linked to `tools/<name>.md`), risk level, and one-line description.

Groups and their tools:

**Core (always enabled, 8 tools):** init, session_checkpoint, discover_tools, enable_tools, configure, get_environment_info, mdms_get_tenants, health_check

**MDMS & Tenants (enable: `mdms`, 8 tools):** validate_tenant, mdms_search, mdms_create, mdms_schema_search, mdms_schema_create, tenant_bootstrap, city_setup, tenant_cleanup

**Boundaries (enable: `boundary`, 7 tools):** validate_boundary, boundary_hierarchy_search, boundary_create, boundary_mgmt_process, boundary_mgmt_search, boundary_mgmt_generate, boundary_mgmt_download

**Master Data (enable: `masters`, 3 tools):** validate_departments, validate_designations, validate_complaint_types

**Employees (enable: `employees`, 3 tools):** validate_employees, employee_create, employee_update

**Localization (enable: `localization`, 2 tools):** localization_search, localization_upsert

**PGR & Workflow (enable: `pgr`, 7 tools):** pgr_search, pgr_create, pgr_update, workflow_business_services, workflow_process_search, workflow_create, tenant_cleanup (note: also in mdms)

**Administration (enable: `admin`, 4 tools):** filestore_get_urls, filestore_upload, access_roles_search, access_actions_search

**User Management (part of `admin`):** user_search, user_create, user_role_add

**ID Generation (enable: `idgen`, 1 tool):** idgen_generate

**Location (enable: `location`, 1 tool):** location_search

**Encryption (enable: `encryption`, 2 tools):** encrypt_data, decrypt_data

**Documentation (enable: `docs`, 3 tools):** docs_search, docs_get, api_catalog

**Monitoring (enable: `monitoring`, 4 tools):** kafka_lag, persister_errors, db_counts, persister_monitor

**Tracing (enable: `tracing`, 5 tools):** tracing_health, trace_search, trace_get, trace_debug, trace_slow

**Step 2: Commit**

```bash
git add docs/api/README.md && git commit -m "docs: add API reference index with all 60 tools grouped by domain"
```

---

### Task 5: Write core group tool files (8 files)

**Files:**
- Create: `docs/api/tools/init.md`
- Create: `docs/api/tools/session_checkpoint.md`
- Create: `docs/api/tools/discover_tools.md`
- Create: `docs/api/tools/enable_tools.md`
- Create: `docs/api/tools/configure.md`
- Create: `docs/api/tools/get_environment_info.md`
- Create: `docs/api/tools/mdms_get_tenants.md`
- Create: `docs/api/tools/health_check.md`

**Step 1: Write all 8 files**

Follow the per-tool template from the design doc. Each file includes: one-line description, group/risk/service metadata, narrative description, parameters table, response shape with JSON example, basic and advanced usage examples, common errors, and see-also links.

Key details per tool (source: tool catalog from research):

- **init**: Group core, risk read, no DIGIT service. Params: user_name, purpose (required), telemetry. Auto-enables tool groups based on intent. Response: enabled groups, session ID.
- **session_checkpoint**: Group core, risk read. Params: summary (required), messages (optional array of turn/role/content). Persists progress to JSONL + DB.
- **discover_tools**: Group core, risk read. No params. Returns all tools grouped by enabled/disabled status.
- **enable_tools**: Group core, risk read. Params: enable (array of group names), disable (array). Cannot disable core. Triggers `tools/list_changed`.
- **configure**: Group core, risk read, service egov-user. Params: environment, username, password, tenant_id, state_tenant. OAuth2 login. Auto-detects state tenant from login.
- **get_environment_info**: Group core, risk read. Params: switch_to, state_tenant. Shows current config, lists available environments.
- **mdms_get_tenants**: Group core, risk read, service egov-mdms-service. Params: state_tenant_id. Lists all tenants from MDMS.
- **health_check**: Group core, risk read. Params: tenant_id, timeout_ms. Probes all DIGIT services, reports status/response time/errors.

**Step 2: Commit**

```bash
git add docs/api/tools/init.md docs/api/tools/session_checkpoint.md docs/api/tools/discover_tools.md docs/api/tools/enable_tools.md docs/api/tools/configure.md docs/api/tools/get_environment_info.md docs/api/tools/mdms_get_tenants.md docs/api/tools/health_check.md
git commit -m "docs: add API reference for core group tools (8 files)"
```

---

### Task 6: Write MDMS & tenant group tool files (8 files)

**Files:**
- Create: `docs/api/tools/validate_tenant.md`
- Create: `docs/api/tools/mdms_search.md`
- Create: `docs/api/tools/mdms_create.md`
- Create: `docs/api/tools/mdms_schema_search.md`
- Create: `docs/api/tools/mdms_schema_create.md`
- Create: `docs/api/tools/tenant_bootstrap.md`
- Create: `docs/api/tools/city_setup.md`
- Create: `docs/api/tools/tenant_cleanup.md`

Key details:

- **validate_tenant**: Read, egov-mdms-service. Params: tenant_id (required). Returns tenant details or error.
- **mdms_search**: Read, egov-mdms-service. Params: tenant_id, schema_code (required), unique_identifiers, limit, offset. Common schemas listed in description (DEPARTMENT, DESIGNATION, etc.).
- **mdms_create**: Write, egov-mdms-service. Params: tenant_id, schema_code, unique_identifier, data (all required). Must search first to avoid duplicates.
- **mdms_schema_search**: Read. Params: tenant_id (required), codes (optional). Shows registered schemas.
- **mdms_schema_create**: Write. Params: tenant_id, code (required), copy_from_tenant, definition, description. Register new schema at state root.
- **tenant_bootstrap**: Write, composite. Params: target_tenant (required), source_tenant (default "pg"). Copies ALL schemas, MDMS data, provisions ADMIN user, copies workflows. Call ONCE for new tenant root.
- **city_setup**: Write, composite. Params: tenant_id, city_name (required), create_boundaries, locality_codes, source_tenant. Creates tenant record, ADMIN user, workflows, boundaries.
- **tenant_cleanup**: Write. Params: tenant_id (required), deactivate_users, schemas. Soft-deletes all MDMS data, deactivates users.

**Step 2: Commit**

```bash
git add docs/api/tools/validate_tenant.md docs/api/tools/mdms_search.md docs/api/tools/mdms_create.md docs/api/tools/mdms_schema_search.md docs/api/tools/mdms_schema_create.md docs/api/tools/tenant_bootstrap.md docs/api/tools/city_setup.md docs/api/tools/tenant_cleanup.md
git commit -m "docs: add API reference for MDMS and tenant tools (8 files)"
```

---

### Task 7: Write boundary group tool files (7 files)

**Files:**
- Create: `docs/api/tools/validate_boundary.md`
- Create: `docs/api/tools/boundary_hierarchy_search.md`
- Create: `docs/api/tools/boundary_create.md`
- Create: `docs/api/tools/boundary_mgmt_process.md`
- Create: `docs/api/tools/boundary_mgmt_search.md`
- Create: `docs/api/tools/boundary_mgmt_generate.md`
- Create: `docs/api/tools/boundary_mgmt_download.md`

Key details:

- **validate_boundary**: Read, boundary-service. Params: tenant_id (required), hierarchy_type (default "ADMIN"). Checks hierarchy exists and boundaries defined.
- **boundary_hierarchy_search**: Read. Params: tenant_id (required), hierarchy_type. Returns hierarchy levels (Country > State > District > City > Ward > Locality).
- **boundary_create**: Write. Params: tenant_id, boundaries (required array of code/type/parent), hierarchy_definition, hierarchy_type. Three-step: create hierarchy, create entities, create relationships. TIP: clone DIGIT-Boundaries-OpenData for real data.
- **boundary_mgmt_process**: Write, egov-bndry-mgmnt. Params: tenant_id, resource_details (required). Upload/update boundary data via management service.
- **boundary_mgmt_search**: Read. Params: tenant_id (required). Search processed boundary uploads.
- **boundary_mgmt_generate**: Write. Params: tenant_id, resource_details (required). Generate boundary code mappings.
- **boundary_mgmt_download**: Read. Params: tenant_id (required). Download generated boundary codes.

**Step 2: Commit**

```bash
git add docs/api/tools/validate_boundary.md docs/api/tools/boundary_hierarchy_search.md docs/api/tools/boundary_create.md docs/api/tools/boundary_mgmt_process.md docs/api/tools/boundary_mgmt_search.md docs/api/tools/boundary_mgmt_generate.md docs/api/tools/boundary_mgmt_download.md
git commit -m "docs: add API reference for boundary tools (7 files)"
```

---

### Task 8: Write masters group tool files (3 files)

**Files:**
- Create: `docs/api/tools/validate_departments.md`
- Create: `docs/api/tools/validate_designations.md`
- Create: `docs/api/tools/validate_complaint_types.md`

Key details:

- **validate_departments**: Read, egov-mdms-service. Params: tenant_id (required), required_departments (optional array). Lists departments, flags inactive ones.
- **validate_designations**: Read. Params: tenant_id (required), required_designations (optional array). Lists designations, validates specific codes present.
- **validate_complaint_types**: Read. Params: tenant_id (required), check_department_refs (default true). Validates PGR service definitions exist and reference valid departments.

**Step 2: Commit**

```bash
git add docs/api/tools/validate_departments.md docs/api/tools/validate_designations.md docs/api/tools/validate_complaint_types.md
git commit -m "docs: add API reference for masters group tools (3 files)"
```

---

### Task 9: Write employees group tool files (3 files)

**Files:**
- Create: `docs/api/tools/validate_employees.md`
- Create: `docs/api/tools/employee_create.md`
- Create: `docs/api/tools/employee_update.md`

Key details:

- **validate_employees**: Read, egov-hrms. Params: tenant_id (required), required_roles (optional, e.g. ["GRO", "PGR_LME"]). Checks employees exist, have valid dept/designation, have required roles.
- **employee_create**: Write, egov-hrms. Params: tenant_id, name, mobile_number, roles (array of code/name), department, designation, jurisdiction_boundary_type, jurisdiction_boundary (all required). Optional: email, gender, employee_type, date_of_appointment, jurisdiction_hierarchy.
- **employee_update**: Write. Params: tenant_id, employee_code (required). Optional: add_roles, remove_roles, new_assignment (dept/designation), deactivate, reactivate.

**Step 2: Commit**

```bash
git add docs/api/tools/validate_employees.md docs/api/tools/employee_create.md docs/api/tools/employee_update.md
git commit -m "docs: add API reference for employee tools (3 files)"
```

---

### Task 10: Write user management tool files (3 files)

**Files:**
- Create: `docs/api/tools/user_search.md`
- Create: `docs/api/tools/user_create.md`
- Create: `docs/api/tools/user_role_add.md`

Key details:

- **user_search**: Read, admin group. Params: tenant_id (required). Optional filters: user_name, mobile_number, uuid (array), role_codes (array), user_type (CITIZEN/EMPLOYEE/SYSTEM), limit, offset.
- **user_create**: Write, admin group. Params: tenant_id, name, mobile_number (required). Optional: user_type (default CITIZEN), roles, email, gender, username, password (default "eGov@123"). Auto-adds CITIZEN role.
- **user_role_add**: Write, admin group. Params: tenant_id (required). Optional: username (default current user), role_codes (default standard PGR roles), city_level. CRITICAL for cross-tenant operations. Resolves to tenant root unless city_level=true.

**Step 2: Commit**

```bash
git add docs/api/tools/user_search.md docs/api/tools/user_create.md docs/api/tools/user_role_add.md
git commit -m "docs: add API reference for user management tools (3 files)"
```

---

### Task 11: Write localization group tool files (2 files)

**Files:**
- Create: `docs/api/tools/localization_search.md`
- Create: `docs/api/tools/localization_upsert.md`

Key details:

- **localization_search**: Read, egov-localization. Params: tenant_id (required), locale (default "en_IN"), module (e.g. "rainmaker-pgr").
- **localization_upsert**: Write. Params: tenant_id (required), messages (required array of code/message/module), locale (default "en_IN"). Upserts — creates if new, updates if exists.

**Step 2: Commit**

```bash
git add docs/api/tools/localization_search.md docs/api/tools/localization_upsert.md
git commit -m "docs: add API reference for localization tools (2 files)"
```

---

### Task 12: Write PGR & workflow group tool files (7 files)

**Files:**
- Create: `docs/api/tools/pgr_search.md`
- Create: `docs/api/tools/pgr_create.md`
- Create: `docs/api/tools/pgr_update.md`
- Create: `docs/api/tools/workflow_business_services.md`
- Create: `docs/api/tools/workflow_process_search.md`
- Create: `docs/api/tools/workflow_create.md`

Key details:

- **pgr_search**: Read, pgr-services. Params: tenant_id (required), service_request_id, status (enum: PENDINGFORASSIGNMENT, PENDINGATLME, PENDINGFORREASSIGNMENT, RESOLVED, REJECTED, CLOSEDAFTERRESOLUTION), limit, offset.
- **pgr_create**: Write, pgr-services. Params: tenant_id, service_code, description, address (with locality.code), citizen_name, citizen_mobile (all required). Any user with EMPLOYEE/CITIZEN/CSR role can create. Returns service request ID + citizenLogin credentials for REOPEN/RATE.
- **pgr_update**: Write, pgr-services. Params: tenant_id, service_request_id, action (required, enum: ASSIGN/REASSIGN/RESOLVE/REJECT/REOPEN/RATE), assignees (array UUIDs), comment, rating (1-5). Auto-fetches complaint before applying action.
- **workflow_business_services**: Read, egov-workflow-v2. Params: tenant_id (required), business_services (optional array, e.g. ["PGR"]). Returns state machine definition.
- **workflow_process_search**: Read. Params: tenant_id (required), business_ids (optional array), limit, offset. Audit trail of transitions.
- **workflow_create**: Write. Params: tenant_id (required), copy_from_tenant (recommended), or manual: business_service, business, business_service_sla, states. Auto-resolves city to state root.

**Step 2: Commit**

```bash
git add docs/api/tools/pgr_search.md docs/api/tools/pgr_create.md docs/api/tools/pgr_update.md docs/api/tools/workflow_business_services.md docs/api/tools/workflow_process_search.md docs/api/tools/workflow_create.md
git commit -m "docs: add API reference for PGR and workflow tools (6 files)"
```

---

### Task 13: Write admin group tool files (4 files)

**Files:**
- Create: `docs/api/tools/filestore_get_urls.md`
- Create: `docs/api/tools/filestore_upload.md`
- Create: `docs/api/tools/access_roles_search.md`
- Create: `docs/api/tools/access_actions_search.md`

Key details:

- **filestore_get_urls**: Read, egov-filestore. Params: tenant_id, file_store_ids (array, both required). Returns signed download URLs.
- **filestore_upload**: Write, egov-filestore. Params: tenant_id, module, file_name, file_content_base64 (required), content_type (optional). Returns fileStoreId.
- **access_roles_search**: Read, egov-accesscontrol. Params: tenant_id (required). Returns all role codes/names/descriptions.
- **access_actions_search**: Read. Params: tenant_id (required), role_codes (optional array). Returns API endpoints/UI actions per role.

**Step 2: Commit**

```bash
git add docs/api/tools/filestore_get_urls.md docs/api/tools/filestore_upload.md docs/api/tools/access_roles_search.md docs/api/tools/access_actions_search.md
git commit -m "docs: add API reference for admin group tools (4 files)"
```

---

### Task 14: Write idgen, location, encryption tool files (4 files)

**Files:**
- Create: `docs/api/tools/idgen_generate.md`
- Create: `docs/api/tools/location_search.md`
- Create: `docs/api/tools/encrypt_data.md`
- Create: `docs/api/tools/decrypt_data.md`

Key details:

- **idgen_generate**: Write, egov-idgen. Params: tenant_id, id_name (required, e.g. "pgr.servicerequestid"), count, id_format (optional custom format).
- **location_search**: Read, egov-location (legacy). Params: tenant_id (required), boundary_type, hierarchy_type. Not available in all environments — prefer validate_boundary.
- **encrypt_data**: Write, egov-enc-service. Params: tenant_id, values (array, both required). Does NOT require authentication.
- **decrypt_data**: Write, egov-enc-service. Params: tenant_id, encrypted_values (array, both required). May fail if key not configured.

**Step 2: Commit**

```bash
git add docs/api/tools/idgen_generate.md docs/api/tools/location_search.md docs/api/tools/encrypt_data.md docs/api/tools/decrypt_data.md
git commit -m "docs: add API reference for idgen, location, and encryption tools (4 files)"
```

---

### Task 15: Write docs group tool files (3 files)

**Files:**
- Create: `docs/api/tools/docs_search.md`
- Create: `docs/api/tools/docs_get.md`
- Create: `docs/api/tools/api_catalog.md`

Key details:

- **docs_search**: Read. Params: query (required). Searches local docs/ + remote docs.digit.org. Returns titles, URLs, snippets.
- **docs_get**: Read. Params: url (required). Accepts docs.digit.org or local:// URLs. Returns full markdown.
- **api_catalog**: Read. Params: service (optional filter), format ("summary" or "openapi"). Covers 14 services, 37 endpoints.

**Step 2: Commit**

```bash
git add docs/api/tools/docs_search.md docs/api/tools/docs_get.md docs/api/tools/api_catalog.md
git commit -m "docs: add API reference for documentation tools (3 files)"
```

---

### Task 16: Write monitoring group tool files (4 files)

**Files:**
- Create: `docs/api/tools/kafka_lag.md`
- Create: `docs/api/tools/persister_errors.md`
- Create: `docs/api/tools/db_counts.md`
- Create: `docs/api/tools/persister_monitor.md`

Key details:

- **kafka_lag**: Read. No params. Requires digit-redpanda container. Status: OK (0), WARN (1-100), CRITICAL (>100).
- **persister_errors**: Read. Params: since (enum time windows, default "5m"). Requires egov-persister container. Categorizes errors (DataIntegrityViolation, CommitFailed, etc.).
- **db_counts**: Read. No params. Tables: eg_pgr_service_v2, eg_pgr_address_v2, eg_wf_processinstance_v2, eg_wf_state_v2, eg_hrms_employee. Tracks delta from previous call.
- **persister_monitor**: Read, composite. Params: tenant_id, since, skip_probes (array). Runs all 4 probes + PGR-workflow parity check. Returns composite health.

**Step 2: Commit**

```bash
git add docs/api/tools/kafka_lag.md docs/api/tools/persister_errors.md docs/api/tools/db_counts.md docs/api/tools/persister_monitor.md
git commit -m "docs: add API reference for monitoring tools (4 files)"
```

---

### Task 17: Write tracing group tool files (5 files)

**Files:**
- Create: `docs/api/tools/tracing_health.md`
- Create: `docs/api/tools/trace_search.md`
- Create: `docs/api/tools/trace_get.md`
- Create: `docs/api/tools/trace_debug.md`
- Create: `docs/api/tools/trace_slow.md`

Key details:

- **tracing_health**: Read. No params. Checks Tempo, OTel Collector, Grafana. Reports indexed trace count.
- **trace_search**: Read. Params: service_name, operation, min_duration_ms, max_duration_ms, seconds_ago (default 300), limit (default 20, max 100).
- **trace_get**: Read. Params: trace_id (required, hex, auto-padded to 32 chars). Returns spans grouped by service, error spans highlighted, Grafana link.
- **trace_debug**: Read, composite. Params: service_name (required), operation, seconds_ago (default 60). Calls trace_search + trace_get. One-call debugger.
- **trace_slow**: Read. Params: min_duration_ms (default 500), seconds_ago (default 300), limit (default 10, max 50). Sorted by duration desc.

**Step 2: Commit**

```bash
git add docs/api/tools/tracing_health.md docs/api/tools/trace_search.md docs/api/tools/trace_get.md docs/api/tools/trace_debug.md docs/api/tools/trace_slow.md
git commit -m "docs: add API reference for tracing tools (5 files)"
```

---

### Task 18: Write guides/getting-started.md

**Files:**
- Create: `docs/guides/getting-started.md`

**Step 1: Write the getting started guide**

Structure (see design doc outline):

1. **Prerequisites** — Node.js 22+, npm, a running DIGIT environment (or use chakshu-digit remote)
2. **Install** — Clone, npm install, npm run build. Configure Claude Code settings.json.
3. **Connect and authenticate** — `configure` with environment, username, password. Show example call and response.
4. **Discover tools** — `discover_tools` showing the 14 groups. Explain progressive disclosure.
5. **Enable a tool group** — `enable_tools` with `["mdms"]`. Show the notification behavior.
6. **First query** — `mdms_get_tenants` listing available tenants. Explain state vs city tenants.
7. **Health check** — `health_check` probing all services. Explain status codes.
8. **What's next** — Links to city-setup guide, PGR lifecycle guide, architecture doc.

Use real data: environment `chakshu-digit`, user `ADMIN`, tenants `pg.citya`, `statea.f`.

Cross-link to tool reference pages for parameter details (don't duplicate).

**Step 2: Commit**

```bash
git add docs/guides/getting-started.md
git commit -m "docs: add getting started guide"
```

---

### Task 19: Write guides/city-setup.md

**Files:**
- Create: `docs/guides/city-setup.md`

**Step 1: Write the city setup guide**

Structure (see design doc outline):

1. **Prerequisites** — Authenticated, mdms + boundary + masters + employees + pgr groups enabled.
2. **Bootstrap state tenant** — `tenant_bootstrap` with target "mytenant", source "pg". Explain what gets copied (schemas, MDMS data, ADMIN user, workflows).
3. **Create city tenant** — `city_setup` with tenant_id "mytenant.mycity", city_name "My City". Explain what gets created (tenant record, ADMIN user, workflows, boundaries).
4. **Verify boundaries** — `validate_boundary` on "mytenant.mycity". Show expected hierarchy.
5. **Add departments** — `mdms_create` with schema "common-masters.Department". Example: DEPT_HEALTH.
6. **Add designations** — `mdms_create` with schema "common-masters.Designation". Example: DESIG_OFFICER.
7. **Add complaint types** — `mdms_create` with schema "RAINMAKER-PGR.ServiceDefs". Example: StreetLightNotWorking with department ref.
8. **Create GRO employee** — `employee_create` with GRO + EMPLOYEE roles, department, designation, jurisdiction.
9. **Create LME employee** — `employee_create` with PGR_LME + EMPLOYEE roles.
10. **Add localization labels** — `localization_upsert` for department names, complaint types.
11. **Verify setup** — Run all validators: validate_departments, validate_designations, validate_complaint_types, validate_employees.
12. **Test with a complaint** — `pgr_create` to file test complaint, `pgr_update` to assign and resolve.
13. **Cleanup (optional)** — `tenant_cleanup` to tear down test data.

**Step 2: Commit**

```bash
git add docs/guides/city-setup.md
git commit -m "docs: add city setup guide"
```

---

### Task 20: Write guides/pgr-lifecycle.md

**Files:**
- Create: `docs/guides/pgr-lifecycle.md`

**Step 1: Write the PGR lifecycle guide**

Structure (see design doc outline):

1. **Prerequisites** — Authenticated, pgr group enabled, city tenant with complaint types + employees set up.
2. **Understanding PGR workflow** — State machine diagram: PENDINGFORASSIGNMENT → PENDINGATLME → RESOLVED/REJECTED → CLOSEDAFTERRESOLUTION. Roles: Citizen creates, GRO assigns, LME resolves, Citizen rates.
3. **Search existing complaints** — `pgr_search` with tenant_id, optional status filter.
4. **Create a complaint** — `pgr_create` with service_code, description, address (locality code), citizen_name, citizen_mobile. Note: any user with EMPLOYEE role can create. Returns service_request_id and citizenLogin.
5. **Check workflow state** — `workflow_process_search` with business_ids. Show audit trail.
6. **Assign to employee (GRO)** — `pgr_update` with action ASSIGN. Find employee UUID via `validate_employees`. Explain auto-routing if assignees omitted.
7. **Resolve the complaint (LME)** — `pgr_update` with action RESOLVE and comment.
8. **Rate and close (Citizen)** — `pgr_update` with action RATE and rating 1-5.
9. **Alternative: Reject** — GRO rejects with `pgr_update` REJECT.
10. **Alternative: Reopen** — Citizen reopens with `pgr_update` REOPEN after resolution.
11. **Alternative: Reassign** — GRO reassigns with `pgr_update` REASSIGN.
12. **Troubleshooting** — Cross-tenant auth errors → `user_role_add`. Missing workflow → `workflow_create`. Invalid service code → `validate_complaint_types`.

**Step 2: Commit**

```bash
git add docs/guides/pgr-lifecycle.md
git commit -m "docs: add PGR complaint lifecycle guide"
```

---

### Task 21: Write guides/debugging.md

**Files:**
- Create: `docs/guides/debugging.md`

**Step 1: Write the debugging guide**

Structure (see design doc outline):

1. **Prerequisites** — Authenticated, monitoring + tracing groups enabled, DIGIT Docker stack running locally.
2. **Check tracing infrastructure** — `tracing_health`. Explain Tempo, OTel Collector, Grafana components.
3. **Debug a failed API call** — `trace_debug` with service_name (e.g. "pgr-services"). Show how it finds the most recent trace and returns error analysis. Walk through a real failure scenario.
4. **Find slow requests** — `trace_slow` with min_duration_ms 500. Explain performance bottleneck identification.
5. **Inspect a specific trace** — `trace_get` with trace_id. Explain span breakdown by service, error highlighting, Grafana link.
6. **Search for specific traces** — `trace_search` with service_name, operation, duration filters.
7. **Monitor persister health** — `persister_monitor`. Explain the 5 probes: Kafka lag, persister errors, DB counts, Kafka-vs-DB delta, PGR-workflow parity.
8. **Check Kafka consumer lag** — `kafka_lag`. Explain OK/WARN/CRITICAL thresholds.
9. **Scan persister errors** — `persister_errors` with since window. Explain error categories.
10. **Verify database counts** — `db_counts`. Explain delta tracking between calls.
11. **Correlating issues** — How to use multiple tools together: lag + errors + DB = data loss diagnosis.

**Step 2: Commit**

```bash
git add docs/guides/debugging.md
git commit -m "docs: add debugging and monitoring guide"
```

---

### Task 22: Cross-link verification and final commit

**Files:**
- Verify: All `docs/api/tools/*.md` files have correct See Also links
- Verify: All guides link to correct tool reference pages
- Verify: `docs/README.md` links work
- Verify: `docs/api/README.md` links work

**Step 1: Verify all internal links**

Check that every `[tool_name](path)` link in every file points to a file that exists. Check that guide cross-references use correct relative paths (e.g. `../../guides/city-setup.md` from tool files, `../api/tools/pgr_create.md` from guide files).

**Step 2: Fix any broken links**

Edit files to correct paths.

**Step 3: Final commit**

```bash
git add docs/ && git commit -m "docs: fix cross-links across all documentation files"
```

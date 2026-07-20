# DIGIT MCP Server -- Architecture

This document explains why the system is built the way it is. Each section
covers a design decision: the problem it addresses, the solution chosen, and
the trade-offs accepted.

---

## 1. Overview

DIGIT MCP Server bridges Claude (via the Model Context Protocol) to the DIGIT
eGov platform -- India's open-source digital governance infrastructure for
municipalities and state governments. The server exposes 60 tools organized
into 14 groups, covering 16 DIGIT services: Auth, User, MDMS v2, Boundary,
Boundary Management, HRMS, PGR, Workflow, Localization, Filestore,
Access Control, ID Generation, Location, Encryption, plus Distributed Tracing
(Grafana Tempo) and Infrastructure Monitoring (Kafka, Persister, PostgreSQL).

Written in TypeScript (Node.js 22), the server supports dual transport -- stdio
for local Claude Code sessions and HTTP for containerized deployments. A single
codebase produces both modes, selected at startup via `MCP_TRANSPORT`.

```
src/
  index.ts            -- Entry point: transport selection, HTTP server
  server.ts           -- MCP server: tool dispatch, session tracking
  logger.ts           -- Structured JSON access logging
  config/             -- Environment configs, endpoint constants
  types/              -- Shared TypeScript types
  tools/              -- 17 registration modules, one per domain
    registry.ts       -- ToolRegistry: progressive disclosure engine
  services/           -- API client, session store, DB, shell, Tempo
```

---

## 2. Progressive Disclosure

**Problem.** 60 tools overwhelm the LLM's context window. When every tool
description is included in the system prompt, the model spends tokens parsing
irrelevant tools and may choose poorly among too many options.

**Solution.** The server starts with only two groups enabled: `core` (8 tools
for environment configuration, tool discovery, tenant operations, and session
management) and `docs` (documentation search). Clients call `enable_tools` to
unlock additional groups. When groups change, the server sends a
`tools/list_changed` MCP notification so clients re-fetch the tool list.

14 groups: `core`, `mdms`, `boundary`, `masters`, `employees`, `localization`,
`pgr`, `admin`, `idgen`, `location`, `encryption`, `docs`, `monitoring`,
`tracing`. The `core` group cannot be disabled. Set `MCP_ENABLE_ALL_GROUPS=1`
to pre-enable everything (used by integration tests).

**Implementation.** `ToolRegistry` (`src/tools/registry.ts`) holds an in-memory
`Map<string, ToolMetadata>` of all registered tools and a `Set<ToolGroup>` of
enabled groups. `getEnabledTools()` filters the map by the set.
`enableGroups()`/`disableGroups()` mutate the set and fire the
`onToolListChanged` callback, which the server wires to
`server.sendToolListChanged()`.

```
Client           Server              Registry
  |                 |                    |
  |-- enable_tools ->|                    |
  |                 |-- enableGroups() -->|
  |                 |<-- callback --------|
  |<- tools/list_changed notification ---|
  |-- tools/list ------>|                 |
  |                 |-- getEnabledTools ->|
  |<-- updated tool list ----------------|
```

**Trade-off.** Progressive disclosure adds one extra round-trip before the LLM
can use a new group. In practice this is negligible: the `init` tool
auto-enables groups based on the user's stated purpose, so most sessions start
with the right groups already active.

---

## 3. Dual Transport

**Problem.** The server must work as a local development companion (piped via
stdin/stdout to Claude Code) and as a shared service behind a load balancer
(HTTP in Kubernetes).

**stdio** (default). The MCP SDK's `StdioServerTransport` reads JSON-RPC
from stdin, writes responses to stdout. One process = one session. State
(auth token, enabled groups) lives in memory for the process lifetime.

**HTTP** (`MCP_TRANSPORT=http`). An `http.createServer` on port 3000 routes:

| Path | Purpose |
|------|---------|
| `POST /mcp` | MCP JSON-RPC (StreamableHTTPServerTransport, stateless) |
| `GET /healthz` | Kubernetes liveness/readiness probe |
| `GET /api/stats` | Aggregate session statistics |
| `GET /api/sessions` | Paginated session list |
| `GET /api/sessions/{id}/events` | Full event timeline for a session |
| `POST /api/sessions/{id}/messages` | Ingest conversation messages |
| `GET /` | Session viewer UI (static files from `ui/`) |

Each `/mcp` request creates a fresh `Server` + transport with
`sessionIdGenerator: undefined` (stateless mode). No session affinity
required -- any replica can handle any request.

**Trade-off.** Stateless HTTP means the DIGIT auth token is not cached across
requests. Each new session must call `configure` to authenticate. Acceptable
because sessions are long-lived and login adds only ~200ms.

---

## 4. Multi-Tenant Model

**Problem.** DIGIT uses a hierarchical tenant model. Master data lives at the
state root; operational data lives at city-level tenants. The server must route
API calls to the correct level without requiring the LLM to understand this.

**Two-level resolution:**
- **State tenant** (root): `pg`, `statea`, `tenant` -- schemas, MDMS master
  data, workflow definitions, access control roles.
- **City tenant** (leaf): `pg.citya`, `statea.f` -- PGR complaints, HRMS
  employees, boundary hierarchies.

Auto-derivation: `pg.citya` splits on the first dot to yield state root `pg`.
The API client performs this during login and stores it as
`stateTenantOverride`.

**Cross-tenant auth.** DIGIT checks that user roles are tagged to the target
tenant's root. If a user on `pg` tries to operate on `tenant.coimbatore`, it
fails because roles are tagged to `pg`, not `tenant`. The `user_role_add` tool
fixes this by adding roles tagged to the target root.

**Bootstrap pattern.** `tenant_bootstrap` copies all schemas and essential MDMS
data from an existing root (typically `pg`) to a new root. `city_setup` then
creates a city-level tenant with admin user, workflow definitions, and default
boundary hierarchy. This two-step pattern ensures everything needed for PGR.

---

## 5. Tool System

**Registration.** Each domain has a `registerXyzTools(registry)` function in
`src/tools/`. All are aggregated in `src/tools/index.ts` via
`registerAllTools()`, called once during server creation:

```
registerDiscoverTools       -- core: enable_tools, discover_tools, init
registerMdmsTenantTools     -- mdms: mdms_search, mdms_create, tenant ops
registerValidatorTools      -- masters: validate_departments, etc.
registerPgrWorkflowTools    -- pgr: pgr_create, pgr_update, workflow
registerHrmsTools           -- employees: employee_create, employee_update
registerLocalizationTools   -- localization: search, upsert
registerFilestoreAclTools   -- admin: filestore, access control
registerUserTools           -- admin: user_search, user_create, user_role_add
registerEncryptionTools     -- encryption: encrypt, decrypt
registerDocsTools           -- docs: docs_search, docs_get
registerMonitoringTools     -- monitoring: kafka_lag, persister_errors, etc.
registerTracingTools        -- tracing: trace_search, trace_get, trace_debug
registerSessionTools        -- core: session_checkpoint
```

**ToolMetadata** is a plain object: `name`, `group` (ToolGroup), `category`,
`risk` (`read` | `write`), `description`, `inputSchema` (JSON Schema), and
async `handler`.

**Handler contract.** Receives `Record<string, unknown>`, returns
`Promise<string>` (JSON with `{ success, data }` on success, or throws).
The server catches errors and returns them with `isError: true`. Handlers
calling DIGIT APIs must invoke `ensureAuthenticated()` first.

**Tool call flow in server.ts:**
1. Verify tool exists and its group is enabled.
2. Record tool call in session store (gets sequence number).
3. Execute handler with wall-clock timing.
4. Record result (duration, success/error, truncated output).
5. Nudge checkpoint every 8 non-session tool calls.
6. Return result to MCP client.

---

## 6. DIGIT API Client

**Problem.** DIGIT services share a common request envelope but differ: some
use query parameters, encryption returns raw JSON arrays, filestore uses
multipart form-data. One client must handle all variants.

**Solution.** Singleton `digitApi` (`src/services/digit-api.ts`).

**Auth:** OAuth2 password grant to `/user/oauth/token`. Form-encoded credentials
with Basic auth (client ID `egov-user-client`, empty secret). Returns
`access_token` + `UserRequest` (user details/roles). Token stored in memory.

**Request envelope.** `buildRequestInfo()` creates the standard DIGIT envelope:
`{ apiId: "Rainmaker", ver: "1.0", ts, msgId, authToken, userInfo }`. Included
in every request body as the `RequestInfo` field.

**`request<T>()`:** Single method for all API calls. Constructs URL, sends POST
with JSON body + Bearer header, parses response, checks for `data.Errors`
array, throws `ApiClientError` with concatenated messages and status code.

**Special cases outside `request()`:**
- Encryption: raw JSON arrays, non-standard envelope.
- Filestore: `multipart/form-data` with file blob.
- PGR/workflow search: URL query parameters (Spring `@ModelAttribute`).

**Endpoint resolution.** Paths defined in `src/config/endpoints.ts`. Envs can
override via `endpointOverrides` (validated against known keys at load time).

---

## 7. Session Management

**Problem.** Understanding what happened during a session is critical for
debugging and auditing. But persistence must never block tool execution.

**Dual-layer persistence:**

**JSONL (always works).** Append-only files in `data/`: `events.jsonl` (tool
calls, results, checkpoints) and `sessions.jsonl` (metadata). Written via
Node.js `WriteStream`. Survives DB outages, restarts, migration failures.

**PostgreSQL (best-effort).** `Db` class (`src/services/db.ts`) manages a
`pg.Pool` (max 5 connections). Auto-creates `sessions`, `events`, `messages`
tables. If connection fails, disables itself -- `execute()` (writes) silently
returns, `query()` throws. Write method is fire-and-forget: catches errors,
never throws. A PostgreSQL outage never disrupts tool execution.

PostgreSQL enables the HTTP API endpoints and session viewer UI.

**Tracked events:**

| Type | Fields |
|------|--------|
| `tool_call` | session ID, seq, timestamp, tool name, sanitized args |
| `tool_result` | seq, tool, duration ms, success/error, result (200 chars) |
| `checkpoint` | summary, recent tools (last 20), optional messages |

**Sanitization.** Args scanned for `password`, `secret`, `token`, `auth_token`;
values replaced with `***` in both JSONL and PostgreSQL.

**Nudging.** Every 8 non-session tool calls, a hint is appended suggesting
`session_checkpoint`. Counter resets on checkpoint.

---

## 8. Observability

**Problem.** DIGIT is distributed across 16+ microservices. A PGR failure might
originate in pgr-services, workflow, persister, or the database. The server
must provide cross-service observability without context switching.

**Three layers:**

**Distributed tracing (OpenTelemetry + Grafana Tempo).** DIGIT services
instrumented with OTel Java agents export traces to a Collector, forwarded to
Tempo. The MCP server queries Tempo via `src/services/tempo.ts`:
- `trace_search`: Find traces by service, operation, duration range.
- `trace_get`: Full trace with spans grouped by service, durations, errors.
- `trace_debug`: Composite -- search + get in one call for immediate debugging.
- `trace_slow`: Traces above a duration threshold, sorted by duration.

**Monitoring probes.** Shell commands against the Docker environment:
- `kafka_lag`: Redpanda `rpk` for consumer lag. OK/WARN/CRITICAL thresholds.
- `persister_errors`: Container log scan, categorized error counts.
- `db_counts`: Direct psql row counts for key tables.
- `persister_monitor`: Runs all probes + Kafka-vs-DB delta + PGR-Workflow parity.

Shell execution via `src/services/shell.ts` uses `execFileSync` with explicit
argv arrays (fixed command registry). No string interpolation, no injection.

**Health checks.** `health_check` probes all 16 service endpoints, reports
status, response time, and errors.

---

## 9. Security Model

**Problem.** The server bridges an LLM to a government platform. It must
prevent credential leakage, respect DIGIT RBAC, and limit mutation surface.

**Read/write classification.** Every tool has `risk: 'read' | 'write'` for
auditing and future policy enforcement.

**No credential storage.** Credentials come from env vars or per-session
`configure` call. Auth token lives in memory only.

**DIGIT RBAC.** Roles scoped to tenant roots, checked on every API call:

| Role | Capability |
|------|------------|
| `CITIZEN` | File complaints, reopen, rate |
| `GRO` | Assign, reassign, reject complaints |
| `PGR_LME` | Resolve complaints |
| `DGRO` | Department-level routing |
| `EMPLOYEE` | Base role for employee operations |

**ADMIN user pattern.** `tenant_bootstrap` provisions an ADMIN with all roles
for testing.

**Cross-tenant roles.** `user_role_add` adds missing roles tagged to a target
tenant root when cross-tenant operations fail with authorization errors.

**Arg sanitization.** Both logger and session store mask `password`, `secret`,
`token`, `auth_token` to `***`.

**Path traversal protection.** Static file serving resolves paths and verifies
they start with the UI directory prefix. Returns 403 otherwise.

**Shell safety.** `execFileSync` with argv arrays, never string interpolation.

---

## 10. Deployment Models

Four deployment options, all configured via environment variables.

**Local stdio.** Configured in Claude Code's `settings.json`:
```json
{
  "mcpServers": {
    "digit-mcp": {
      "command": "node",
      "args": ["dist/index.js"],
      "env": { "CRS_ENVIRONMENT": "chakshu-digit", "CRS_USERNAME": "ADMIN", "CRS_PASSWORD": "..." }
    }
  }
}
```
Direct process communication. No network exposure.

**Docker.** Multi-stage Alpine build:
```
Stage 1 (builder): node:22-alpine, npm ci, tsc
Stage 2 (runtime): node:22-alpine, npm ci --omit=dev, copy dist/
```
Image: `ghcr.io/chakshugautam/digit-mcp:latest`. Defaults to HTTP transport
on port 3000.

**Kubernetes.** Helm chart in `helm/digit-mcp/`:

| Resource | Purpose |
|----------|---------|
| Deployment | 1 replica, 100m CPU / 128Mi memory requests |
| Service | ClusterIP on port 3000 |
| ConfigMap | Non-sensitive env vars |
| Secret | CRS_USERNAME, CRS_PASSWORD (set via `--set`) |

Probes hit `/healthz`. Stateless HTTP enables horizontal scaling without
session affinity.

**PM2.** `ecosystem.config.cjs` for bare-metal/VM production:
```javascript
{ name: 'digit-mcp', script: 'dist/index.js',
  env: { MCP_TRANSPORT: 'http', MCP_PORT: '3100', CRS_ENVIRONMENT: 'chakshu-digit' } }
```

**Environment variables (all modes):**

| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PORT` | `3000` | HTTP listen port |
| `MCP_ENABLE_ALL_GROUPS` | unset | `1` to pre-enable all groups |
| `MCP_LOG_FILE` | `/var/log/digit-mcp/access.log` | Structured JSON log |
| `CRS_ENVIRONMENT` | `chakshu-digit` | Named environment key |
| `CRS_API_URL` | from env config | Override API base URL |
| `CRS_USERNAME` | -- | DIGIT admin username |
| `CRS_PASSWORD` | -- | DIGIT admin password |
| `CRS_TENANT_ID` | from env config | Tenant for login |
| `CRS_STATE_TENANT` | from env config | Override state tenant root |
| `SESSION_DATA_DIR` | `./data` | JSONL data directory |
| `SESSION_DB_HOST` | `localhost` | PostgreSQL host |
| `SESSION_DB_PORT` | `15433` | PostgreSQL port |
| `SESSION_DB_NAME` | `mcp_sessions` | PostgreSQL database |

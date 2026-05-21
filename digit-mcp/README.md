# DIGIT MCP Server

[![CI](https://github.com/ChakshuGautam/digit-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ChakshuGautam/digit-mcp/actions/workflows/ci.yml)

MCP server + data provider for the [DIGIT](https://docs.digit.org) eGov platform — **60 MCP tools** across **14 groups**, a **shared TypeScript API client** (`@digit-mcp/data-provider`), and a **react-admin DataProvider/AuthProvider** for building DIGIT frontends.

Only 11 tools load initially (`core` + `docs`). The rest unlock on demand via `enable_tools`, so agents aren't overwhelmed with options they don't need yet.

## Install

One command to configure your MCP client:

```bash
curl -fsSL https://raw.githubusercontent.com/ChakshuGautam/DIGIT-MCP/main/install.sh | bash
```

This auto-detects your client (**Claude Code**, **Cursor**, **Windsurf**, **VS Code**), connects to the hosted server, and — for Claude Code — installs skills that guide the AI through DIGIT workflows.

### Non-interactive

```bash
# Remote mode (default) — connects to hosted server, no build needed
curl -fsSL https://raw.githubusercontent.com/ChakshuGautam/DIGIT-MCP/main/install.sh | bash -s -- --client claude-code --mode remote --yes

# Local mode — clones repo, builds, runs via stdio
curl -fsSL https://raw.githubusercontent.com/ChakshuGautam/DIGIT-MCP/main/install.sh | bash -s -- --client cursor --mode local --yes
```

### Manual Configuration

<details>
<summary>Claude Code</summary>

Add to `~/.claude.json` or project `.mcp.json`:

```json
{
  "mcpServers": {
    "DIGIT-MCP": {
      "type": "http",
      "url": "https://mcp.egov.theflywheel.in/mcp"
    }
  }
}
```

Or for local stdio:

```json
{
  "mcpServers": {
    "DIGIT-MCP": {
      "command": "node",
      "args": ["/path/to/DIGIT-MCP/dist/index.js"],
      "env": {
        "CRS_ENVIRONMENT": "local",
        "CRS_USERNAME": "ADMIN",
        "CRS_PASSWORD": "eGov@123"
      }
    }
  }
}
```

</details>

<details>
<summary>Cursor / Windsurf / VS Code</summary>

Add to your MCP settings (`.cursor/mcp.json`, `.windsurf/mcp.json`, or VS Code MCP config):

```json
{
  "mcpServers": {
    "DIGIT-MCP": {
      "url": "https://mcp.egov.theflywheel.in/mcp"
    }
  }
}
```

</details>

## CLI

The `digit` CLI provides the same 56 tools as the MCP server, auto-generated from the shared tool registry. No per-tool CLI code — adding an MCP tool automatically adds a CLI command.

### Install

```bash
npm install -g @chakshu-gautam/digit-mcp --registry=https://npm.pkg.github.com
```

Or from source:

```bash
git clone https://github.com/ChakshuGautam/DIGIT-MCP.git
cd DIGIT-MCP && npm install && npm run build
npm link   # makes `digit` available globally
```

### Usage

```bash
# Authenticate (saved to ~/.config/digit-cli/credentials.json)
digit login --environment chakshu-digit --username ADMIN --password eGov@123

# Search complaints
digit pgr search --tenant-id pg.citya --status RESOLVED

# File a complaint
digit pgr create --tenant-id pg.citya --service-code StreetLightNotWorking \
  --description "Broken light on MG Road" \
  --address '{"locality":{"code":"LOC_CITYA_1"}}' \
  --citizen-name "Ravi Kumar" --citizen-mobile 9876543210

# MDMS search
digit mdms search --tenant-id pg --schema-code common-masters.Department

# Health check
digit health-check

# Output formats
digit pgr search --tenant-id pg.citya --output json    # raw JSON (default when piped)
digit pgr search --tenant-id pg.citya --output table   # formatted table (default on TTY)
digit pgr search --tenant-id pg.citya --output plain   # minimal for scripting
```

### Command Structure

```
digit <group> <command> [flags]     # grouped tools
digit <command> [flags]             # core tools (top-level)
digit --help                        # list all groups
digit pgr --help                    # list pgr commands
digit pgr search --help             # show all flags
```

Core tools (`configure`, `health-check`, `get-environment-info`, `mdms-get-tenants`) are top-level. All other tools are grouped: `digit pgr search`, `digit mdms search`, `digit boundary validate`, etc.

## Quick Start

```bash
npm install
npm run build
npm start              # stdio transport (default)
npm run start:http     # HTTP transport on :3000
npm run cli -- --help  # CLI (dev mode, no build needed)
```

## Docker

```bash
docker run -p 3000:3000 \
  -e CRS_ENVIRONMENT=chakshu-digit \
  -e CRS_USERNAME=ADMIN \
  -e CRS_PASSWORD=eGov@123 \
  ghcr.io/chakshugautam/digit-mcp:latest

# Health check
curl http://localhost:3000/healthz
```

## Helm (Kubernetes)

```bash
helm install digit-mcp ./helm/digit-mcp \
  --set env.CRS_ENVIRONMENT=chakshu-digit \
  --set secret.CRS_USERNAME=ADMIN \
  --set secret.CRS_PASSWORD=eGov@123
```

See [`helm/digit-mcp/values.yaml`](helm/digit-mcp/values.yaml) for all options.

## Progressive Disclosure

The server starts with 11 tools. Agents call `enable_tools` to unlock groups as needed:

| Group | Tools | Purpose |
|-------|------:|---------|
| **core** | 8 | Discovery, auth, environment, health check |
| **docs** | 3 | Search docs.digit.org, fetch pages, OpenAPI catalog |
| **mdms** | 8 | Master data CRUD, schema management, tenant bootstrap/cleanup |
| **boundary** | 7 | Boundary hierarchy + entity CRUD |
| **masters** | 3 | Validate departments, designations, complaint types |
| **employees** | 3 | HRMS employee create, update, validate |
| **localization** | 2 | Search and upsert UI label translations |
| **pgr** | 6 | PGR complaints + workflow actions |
| **admin** | 7 | Filestore, access control, user management |
| **idgen** | 1 | ID generation |
| **location** | 1 | Geographic boundaries (legacy) |
| **encryption** | 2 | Encrypt/decrypt sensitive data |
| **monitoring** | 4 | Kafka lag, persister errors, DB counts |
| **tracing** | 5 | Distributed trace search, debug, slow-query detection |

Full tool reference with per-tool docs: **[docs/api/](docs/api/README.md)**

## Common Workflows

**Connect to any DIGIT instance by URL:**
```
configure(base_url="https://my-digit.example.com", username, password) → auto-probes services
```

**Set up a new city with PGR:**
```
configure → tenant_bootstrap → city_setup → employee_create → pgr_create
```

**Set up a city from xlsx files (CCRS dataloader format):**
```
configure → city_setup_from_xlsx(tenant_id, masters_file, employee_file, ...)
```

**File a complaint and resolve it:**
```
pgr_create → pgr_update(ASSIGN) → pgr_update(RESOLVE) → pgr_update(RATE)
```

**Debug a failed API call:**
```
enable_tools(["tracing"]) → trace_debug → trace_get
```

## Documentation

| Doc | Description |
|-----|-------------|
| [Getting Started](docs/guides/getting-started.md) | Connect, authenticate, discover tools |
| [City Setup](docs/guides/city-setup.md) | Bootstrap a new tenant and set up PGR end-to-end |
| [PGR Complaint Lifecycle](docs/guides/pgr-lifecycle.md) | Create, assign, resolve, and rate complaints |
| [Debugging & Monitoring](docs/guides/debugging.md) | Trace failures, monitor persister health |
| [API Nuances](docs/guides/api-nuances.md) | Known DIGIT API quirks and gotchas |
| [Building a PGR UI](docs/ui.md) | Complete guide to building complaint management frontends |
| [Architecture](docs/architecture.md) | Server internals, transport, progressive disclosure |
| [CLI Architecture](docs/cli-architecture.md) | How the CLI is auto-generated from the tool registry |
| [API Reference](docs/api/README.md) | All 60 tools with parameters and examples |
| [OpenAPI Spec](docs/openapi.yaml) | Machine-readable API specification |

## Data Provider (`@digit-mcp/data-provider`)

Shared TypeScript package for building DIGIT frontends. Lives in `packages/data-provider/`.

### Install

```bash
npm install @digit-mcp/data-provider
```

### API Client

Standalone DIGIT API client with 45+ methods covering all platform services:

```typescript
import { DigitApiClient } from '@digit-mcp/data-provider/client';

const client = new DigitApiClient({
  url: 'https://my-digit-instance.example.com',
  stateTenantId: 'pg',
});

await client.login('ADMIN', 'eGov@123', 'pg');

// MDMS
const departments = await client.mdmsSearch('pg', 'common-masters.Department');

// PGR
const complaints = await client.pgrSearch('pg.citya', { status: 'PENDINGASSIGNMENT' });

// HRMS
const employees = await client.employeeSearch('pg.citya', { limit: 100 });

// Boundaries, workflow, localization, filestore, idgen, encryption, access control...
```

**Services covered:** User, MDMS v2, HRMS, Boundary (entities + hierarchy + management), PGR, Localization, Workflow, Access Control, IDGen, Filestore, Encryption, Inbox.

Built-in retry logic (429/503 with exponential backoff), endpoint overrides, and multi-tenant resolution.

### react-admin DataProvider

Drop-in `DataProvider` and `AuthProvider` for [react-admin](https://marmelab.com/react-admin/):

```typescript
import { DigitApiClient } from '@digit-mcp/data-provider/client';
import { createDigitDataProvider, createDigitAuthProvider } from '@digit-mcp/data-provider';

const client = new DigitApiClient({ url: 'https://...', stateTenantId: 'pg' });
const dataProvider = createDigitDataProvider(client, 'pg.citya');
const authProvider = createDigitAuthProvider(client);

// Use with react-admin <Admin>
<Admin dataProvider={dataProvider} authProvider={authProvider}>
  <Resource name="complaints" />
  <Resource name="employees" />
  <Resource name="departments" />
</Admin>
```

**13 dedicated resources** out of the box: tenants, departments, designations, complaint-types, employees, boundaries, complaints, localization, users, workflow-business-services, workflow-processes, access-roles, access-actions.

**17 generic MDMS resources** auto-mapped: state-info, branding, city-modules, id-formats, role-actions, and more.

Smart features:
- Auto-searches city sub-tenants when root tenant returns no results
- Flattens boundary hierarchies into flat lists with parent pointers
- Handles PGR workflow state transitions (ASSIGN, RESOLVE, REJECT, REOPEN, RATE)
- MDMS `uniqueIdentifier` fast-path for getOne lookups

### Resource Registry

Query available resources programmatically:

```typescript
import { getAllResources, getDedicatedResources, getResourceBySchema } from '@digit-mcp/data-provider';

getAllResources();           // all 30 resource configs
getDedicatedResources();     // 13 first-class resources
getResourceBySchema('RAINMAKER-PGR.ServiceDefs');  // → complaint-types config
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PORT` | `3000` | HTTP port (http mode only) |
| `CRS_ENVIRONMENT` | `chakshu-digit` | Environment key |
| `CRS_USERNAME` | — | DIGIT admin username |
| `CRS_PASSWORD` | — | DIGIT admin password |
| `CRS_TENANT_ID` | from env config | Tenant for authentication |
| `MCP_ENABLE_ALL_GROUPS` | — | Set to `1` to enable all tool groups on startup |

## Environments

| Key | URL | State Tenant |
|-----|-----|--------------|
| `chakshu-digit` | `https://chakshu-digit.egov.theflywheel.in` | `statea` |
| `dev` | `https://unified-dev.digit.org` | `statea` |
| `local` | `http://0.0.0.0:18000` | `pg` |

## Testing

```bash
# MCP server
npm test                 # Quick validator tests
npm run test:safety      # Agent safety tests (53 tests)
npm run test:full        # Full integration suite (130 tests, 100% tool coverage)
npm run test:e2e         # E2E new-tenant test
npm run test:openapi     # Validate OpenAPI spec against live APIs
npx tsx test-xlsx-reader.ts  # xlsx-reader unit tests (12 tests)

# Data provider
cd packages/data-provider
npm test                 # Unit tests (client, registry, providers)
npm run test:integration # Integration tests against live DIGIT API
```

## Architecture

```
src/
├── index.ts              # MCP entry point (dual transport: stdio / HTTP)
├── cli.ts                # CLI entry point (Commander.js, auto-generated commands)
├── cli/
│   ├── adapter.ts        # JSON Schema → Commander.js option mapper
│   ├── formatter.ts      # json / table / plain output formatting
│   └── auth.ts           # Credential persistence (~/.config/digit-cli/)
├── server.ts             # MCP server with listChanged notifications
├── types/                # Shared types, ToolGroup, MDMS schema constants
├── config/
│   ├── environments.ts   # Named environment configs
│   └── endpoints.ts      # DIGIT API endpoint paths
├── services/
│   ├── digit-api.ts      # DIGIT API client (auth, multi-tenant, all services)
│   ├── session-store.ts  # PostgreSQL session tracking
│   └── telemetry.ts      # Matomo analytics
├── tools/                # 60 tools across 16 registration files
│   ├── registry.ts       # ToolRegistry (group enable/disable lifecycle)
│   └── index.ts          # registerAllTools() aggregator
├── utils/
│   ├── validation.ts     # Input validation (tenant IDs, mobile, control chars)
│   ├── sanitize.ts       # Response sanitization (prompt injection defense)
│   ├── field-mask.ts     # Field projection for search results
│   ├── probe.ts          # Service availability probing for ad-hoc environments
│   ├── xlsx-reader.ts    # xlsx sheet parsing (CCRS dataloader format)
│   └── xlsx-loader.ts    # 4-phase xlsx setup orchestrator
packages/
└── data-provider/        # @digit-mcp/data-provider
    └── src/
        ├── client/       # DigitApiClient — standalone DIGIT API client (45+ methods)
        │   ├── DigitApiClient.ts
        │   ├── endpoints.ts
        │   ├── errors.ts
        │   └── types.ts
        └── providers/    # react-admin integration
            ├── dataProvider.ts      # DataProvider (CRUD for 30 resources)
            ├── authProvider.ts      # AuthProvider (OAuth2 session)
            └── resourceRegistry.ts  # Resource config registry
docs/
├── api/                  # Per-tool API reference
├── guides/               # 5 walkthrough guides
├── architecture.md       # Server design and internals
├── ui.md                 # PGR frontend development guide
└── openapi.yaml          # OpenAPI 3.0 specification
skills/                   # Claude Code skills for guided DIGIT workflows
helm/digit-mcp/           # Helm chart for Kubernetes
```

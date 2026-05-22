# DIGIT CLI — Architecture

How the `digit` CLI is auto-generated from the MCP server's tool registry
at runtime, with zero per-tool CLI code.

---

## 1. Design Principle: One Registry, Two Interfaces

The MCP server and the CLI share 100% of their tool logic. The shared core
is the `ToolRegistry` — a map of 60 `ToolMetadata` objects, each carrying a
`name`, `group`, `inputSchema` (JSON Schema), and `handler` function.

```
                    ToolRegistry (60 tools)
                    ToolMetadata[] with inputSchema + handler
                           │
              ┌────────────┴────────────┐
              │                         │
        MCP Server                    CLI
       src/index.ts              src/cli.ts
     stdio / HTTP             Commander.js
   progressive disclosure    all groups enabled
   JSON-RPC transport        terminal I/O
```

There is no code generation step. No templates. No per-tool CLI files.
The CLI reads the live registry and builds Commander commands on every
invocation.

---

## 2. Startup Sequence

When a user runs `digit pgr search --tenant-id pg.citya`:

```
1. src/cli.ts loads
2. applyCredentialsToEnv()        — load saved creds from ~/.config/digit-cli/
3. new ToolRegistry()             — empty registry
4. registerAllTools(registry)     — registers all 60 tools
5. registry.enableGroups(ALL)     — enables everything (no progressive disclosure)
6. buildProgram(registry)         — loops over tools, builds Commander tree
7. program.parseAsync(argv)       — Commander parses args, invokes handler
```

Steps 3-6 take <50ms. The registry is populated, the Commander tree is built,
and args are parsed — all in a single pass.

---

## 3. Command Generation Pipeline

### 3.1 Tool → Command mapping

`buildProgram()` in `src/cli.ts` iterates `registry.getAllTools()` and:

1. **Skips MCP-only tools.** `discover_tools`, `enable_tools`, `init`, and
   `session_checkpoint` are meaningless in CLI context.

2. **Groups by `tool.group`.** Core tools become top-level commands.
   All others nest under their group.

3. **Derives command names.** Strips the group prefix and converts to kebab:
   - `pgr_search` in group `pgr` → `digit pgr search`
   - `workflow_business_services` in group `pgr` → `digit pgr workflow-business-services`
   - `configure` in group `core` → `digit configure` (top-level)

This produces the command tree:

```
digit
├── login / logout              — credential management (CLI-only)
├── configure                   — core (top-level)
├── health-check                — core (top-level)
├── get-environment-info        — core (top-level)
├── mdms-get-tenants            — core (top-level)
├── pgr/
│   ├── search
│   ├── create
│   ├── update
│   └── ...
├── mdms/
│   ├── search
│   ├── create
│   └── ...
├── boundary/
├── employees/
├── tracing/
└── ... (14 groups total)
```

### 3.2 inputSchema → Commander options

`addSchemaOptions()` in `src/cli/adapter.ts` iterates `schema.properties`
and maps each to a Commander `Option`:

| JSON Schema | Commander flag | Coercion |
|-------------|---------------|----------|
| `{ type: 'string' }` | `--flag <value>` | none |
| `{ type: 'number' }` | `--flag <value>` | `Number()` |
| `{ type: 'boolean' }` | `--flag` | boolean flag (no value) |
| `{ type: 'string', enum: [...] }` | `--flag <value>` | `.choices()` validation |
| `{ type: 'object' }` | `--flag <json>` | `JSON.parse()` |
| `{ type: 'array', items: { type: 'string' } }` | `--flag <items...>` | variadic |
| `{ type: 'array', items: { type: 'object' } }` | `--flag <json>` | `JSON.parse()` |

Required properties (from `schema.required`) become mandatory options.
All others are optional.

**Example.** `pgr_search` has this inputSchema:

```json
{
  "type": "object",
  "properties": {
    "tenant_id":          { "type": "string" },
    "service_request_id": { "type": "string" },
    "status":             { "type": "string", "enum": ["PENDINGFORASSIGNMENT", ...] },
    "limit":              { "type": "number" },
    "offset":             { "type": "number" }
  },
  "required": ["tenant_id"]
}
```

This generates:

```
--tenant-id <tenant-id>                    (mandatory, string)
--service-request-id [service-request-id]  (optional, string)
--status [status]                          (optional, choices validated)
--limit [limit]                            (optional, coerced to number)
--offset [offset]                          (optional, coerced to number)
```

### 3.3 Name translation

Property names undergo two conversions:

**snake_case → kebab-case** (for CLI flags):
`tenant_id` → `--tenant-id`

**kebab-case → camelCase** (Commander's internal storage):
`--tenant-id` → `opts.tenantId`

**camelCase → snake_case** (back to handler args):
`opts.tenantId` → `args.tenant_id`

The round-trip is handled by `optsToArgs()` in `src/cli/adapter.ts`, which
iterates the original schema properties and looks up the corresponding
camelCase key in Commander's opts object.

---

## 4. Execution Flow

```
User types:    digit pgr search --tenant-id pg.citya --status RESOLVED
                     │
                     ▼
Commander parses argv
  → opts = { tenantId: "pg.citya", status: "RESOLVED" }
                     │
                     ▼
optsToArgs(opts, schema)
  → args = { tenant_id: "pg.citya", status: "RESOLVED" }
                     │
                     ▼
tool.handler(args)          ← SAME function as MCP server
  → calls ensureAuthenticated()
  → calls digitApi.pgrSearch()
  → returns JSON string
                     │
                     ▼
formatOutput(result, format)
  → json:  raw JSON (default when piped)
  → table: aligned columns with headers (default on TTY)
  → plain: minimal output for scripting
                     │
                     ▼
console.log(output)
```

The handler is literally the same function object. There is no adapter
layer, no serialization/deserialization between CLI and tool logic.

---

## 5. Output Formatting

`src/cli/formatter.ts` provides three modes, selected by `--output` flag
or auto-detected from TTY:

**json** (default when stdout is piped).
Raw JSON from the handler, pretty-printed.

```
$ digit pgr search --tenant-id pg.citya | jq '.complaints[0].serviceCode'
"StreetLightNotWorking"
```

**table** (default when stdout is a TTY).
Detects the primary data array in the response, extracts scalar columns
(up to 8), aligns them with padded headers and a separator line.

```
SERVICEREQUESTID          SERVICECODE            STATUS    RATING
────────────────────────  ─────────────────────  ────────  ──────
PG-PGR-2026-03-05-011865  StreetLightNotWorking  RESOLVED  5
PG-PGR-2026-03-05-011864  StreetLightNotWorking  REJECTED  —

2 complaints
```

Error responses show colored labels:
```
Error: User is not authorized
Hint: Call configure with the target tenant_id, or use user_role_add
```

**plain** (for scripting).
Extracts the most useful single value: array count, error message, or
scalar result.

```
$ digit pgr search --tenant-id pg.citya --output plain
2 complaints
```

**Color control.**
ANSI color codes are used sparingly (red errors, yellow hints, dim counts).
Color is automatically disabled when:

- `NO_COLOR` env var is set (any value) — per https://no-color.org
- `TERM=dumb`
- `--no-color` flag is passed
- stdout is not a TTY (piped output)

All errors go to stderr, including JSON-formatted errors.

---

## 6. Credential Persistence

MCP sessions get credentials per-session via the `configure` tool. The CLI
persists them to disk so users don't pass `--username`/`--password` on
every command.

**File:** `~/.config/digit-cli/credentials.json` (mode 0600)

```json
{
  "environment": "chakshu-digit",
  "username": "ADMIN",
  "password": "eGov@123"
}
```

**Two ways to save:**

1. `digit login --environment ... --username ... --password ...` — explicit
2. `digit configure --environment ... --username ...` — auto-saves on success

**Load order** (first wins):
1. Explicit env vars (`CRS_ENVIRONMENT`, `CRS_USERNAME`, `CRS_PASSWORD`)
2. Stored credentials from `~/.config/digit-cli/credentials.json`

`applyCredentialsToEnv()` runs at startup, before any tool handler. It only
sets env vars that aren't already set, so explicit env vars always win.

`digit logout` clears the file.

---

## 7. What the CLI Does NOT Do

The CLI intentionally omits features that only make sense in MCP context:

| MCP feature | CLI equivalent |
|-------------|---------------|
| `discover_tools` | `digit --help` |
| `enable_tools` | All groups always enabled |
| `init` | Not needed (no session tracking) |
| `session_checkpoint` | Not needed (no session tracking) |
| Progressive disclosure | `--help` at every level |
| `tools/list_changed` | N/A |

---

## 8. Adding a New Tool

Register a tool in the MCP server's `ToolRegistry` → it automatically
appears as a CLI command. No additional code needed.

Specifically:

1. Define `ToolMetadata` with `name`, `group`, `inputSchema`, `handler`
2. Register via `registry.register(tool)` in a `registerXyzTools()` function
3. The CLI picks it up on next invocation

The `inputSchema` drives both the MCP tool definition and the CLI flags.
The `handler` is called by both. The `description` becomes both the MCP
tool description and the Commander command description.

**If you add a new `ToolGroup`**, it automatically becomes a new CLI
subcommand namespace (e.g. `digit newgroup command`).

---

## 9. File Map

```
src/cli.ts                 Entry point. Builds Commander program from registry.
                           Guards execution with isMain check (importable by tests).

src/cli/adapter.ts         JSON Schema → Commander option mapper.
                           toFlag(), toArgKey(), addSchemaOptions(), optsToArgs().
                           Handles string, number, boolean, enum, object, array.

src/cli/formatter.ts       Output formatting: json, table, plain.
                           Auto-detects TTY. Table mode finds primary data array,
                           extracts scalar columns, aligns with padding.

src/cli/auth.ts            Credential persistence.
                           saveCredentials(), loadCredentials(), clearCredentials(),
                           applyCredentialsToEnv(). File: ~/.config/digit-cli/credentials.json.

test-cli.ts                96 tests covering adapter, formatter, auth, and
                           program structure. Verifies 1:1 tool mapping (56 CLI
                           commands = 56 non-MCP-only registry tools).
```

Zero changes to existing MCP server files.

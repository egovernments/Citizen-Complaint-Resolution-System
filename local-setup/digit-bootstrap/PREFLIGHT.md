# Pre-flight MCP audit — 2026-06-07

Probed against `https://subhadev.digitlab.in` (Self-hosted DIGIT). Source tenant `pg`, existing target root `mz`, existing city `mz.maputo`. ADMIN credentials worked with full role set (SUPERUSER, CSR, GRO, DGRO, PGR_LME, etc.).

## MCP REST shim — RESOLVED 2026-06-07

Initial probe assumed a REST-style shim at `/tools/<name>`. **That shim does NOT exist on subhadev.digitlab.in.** Direct HTTP probes:

```
POST https://subhadev.digitlab.in/mcp (with MCP initialize)   → 200, server "digit-mcp" v1.0.0, protocolVersion 2025-06-18
GET  https://subhadev.digitlab.in/tools/validate_tenant       → 404
GET  https://subhadev.digitlab.in/mcp/tools/validate_tenant   → 404
GET  https://subhadev.digitlab.in/mcp-shim                    → 404
GET  https://subhadev.digitlab.in/api/mcp                     → 404
```

The deployment speaks the **MCP protocol** (JSON-RPC 2.0 over HTTP, SSE responses) at `/mcp` — NOT the REST `/tools/<name>` shape McpClient was built for.

**Plan impact: McpClient needs a rewrite before the e2e smoke can run against this deployment.** Two options:
1. **Rewrite McpClient to speak MCP protocol** (recommended). `POST /mcp` with `Content-Type: application/json` + `Accept: application/json, text/event-stream`. Body is `{"jsonrpc":"2.0","method":"tools/call","params":{"name":<tool>,"arguments":<payload>},"id":<n>}`. Response is SSE `event: message` containing the JSON-RPC envelope. ~2h of focused work. Orchestrator, templates, CLI, and all existing tests stay valid (same Python surface, different wire shape).
2. Deploy a separate REST shim alongside the MCP server. Operational burden; doesn't simplify anything.

Until McpClient is rewritten, the e2e smoke stays skipped (`DIGIT_BOOTSTRAP_E2E` only meaningful with a REST shim — none today). All 23 unit tests with mocked MCP pass; the 24th (e2e) skips correctly.

## Open question 2 — Does `tenant_bootstrap` copy ServiceDefs (complaint types)?

**Resolved: YES, more than the schema docs suggest.**

Observations:
- `mz` has 5+ ServiceDefs records (NoStreetlight, NonSweepingOfRoad, StreetLightNotWorking, GarbageNeedsTobeCleared, DamagedGarbageBin) — these match pg-style complaint types but were re-keyed with `uniqueIdentifier = serviceCode` (vs pg's SHA-style hash identifiers).
- `mz` has Departments (DEPT_1..DEPT_5) with the same names as pg (Street Lights, Building & Roads, Health & Sanitation, Operation & Maintenance, Horticulture). Direct copy.
- `mz` has **1253 localization rows** for `rainmaker-pgr` / `en_IN`. Also a deep copy from pg.

So `tenant_bootstrap` covers:
- Schemas ✓
- Department records ✓
- Designation records (assumed; not separately verified due to time budget)
- **ServiceDefs (complaint types) ✓**
- **Localization rows (full en_IN payload) ✓**
- Workflow definitions ✓ (per schema docs)
- StateInfo, IdFormat, InboxQueryConfiguration ✓ (per schema docs)

**Plan impact:**
- **Task 8 (apply_complaint_types) is REDUNDANT for any tenant cloned via `tenant_bootstrap`.** Implement it anyway for templates that want to *add* country-specific complaint types beyond what `pg` ships, but the probe-then-skip-if-present idempotency is what makes it safe (it'll skip every record that's already there).
- **Task 9 (apply_localizations) should focus on locale *deltas*** (sw_KE rows for the Africa template; pt_MZ for Mozambique) rather than re-seeding the en_IN baseline. The Africa template's `localizations` field should only carry Swahili rows.

## Open question 3 — Sync vs async

Not separately timed in this probe (mz was bootstrapped before this session). Reasoning by proxy: the MCP tool returns synchronously when called from Claude (no `job_id` in the schema), so the Python orchestrator can treat it as a blocking call. If observed latency on a fresh bootstrap exceeds ~60s, McpClient timeout (currently 60s) will need to be bumped; the field is parameterizable.

**Plan impact:** Phase 3 (async/notify) is NOT needed for v1. Defer. If operator reports timeouts, raise `McpClient(timeout=…)`.

## Open question 4 — `localization_upsert` batch ceiling

Not probed empirically (would have polluted mz's localization table with PROBE_* rows). The Africa template's localization payload will be sparse (sw_KE deltas, low hundreds of rows). The orchestrator uses `localization_batch_size=200` default, which is safe under any realistic ceiling.

**Plan impact:** Keep the 200 default. If a future template exceeds it, the operator can override via constructor; if upserts fail, halve the batch and retry (not implemented in v1).

## Open question 5 — Boundary entity bulk method vs single

`boundary_hierarchy_search` for `mz` returned **count=0** — meaning city_setup didn't create a hierarchy at root level. Hierarchies live at the city tenant. The `boundary_mgmt_process` tool was not probed; the `boundary_create` per-entity loop in Task 7 is the safe default.

**Plan impact:** Keep per-entity `boundary_create`. If volume becomes a problem, switch to `boundary_mgmt_process` later — the orchestrator's interface stays the same.

## Open question 6 — `employee_update` reportingTo

Out of scope for Phase 1. Will probe in Phase 2 before persona provisioning lands.

## What this audit changes in the plan

1. **Task 8 stays in place** — its idempotency probe means it's a no-op when ServiceDefs are already copied. Useful for adding country-specific complaint types in templates.
2. **Task 9 / Africa template:** the `localizations` field carries only sw_KE rows. Don't re-seed en_IN.
3. **Phase 3 (async) deferred indefinitely** — `tenant_bootstrap` is sync from the operator's perspective.
4. **No URL hardcoding** — `--mcp-base` flag is the source of truth at runtime.

## Recorded probe responses

Captured in this session's transcript:
- `validate_tenant` for `mz` and `mz.maputo` — both exist.
- `mdms_search` for `RAINMAKER-PGR.ServiceDefs` on `mz` (5 records) and `pg` (5 records of the same complaint-type set, hash-keyed) — confirms ServiceDefs are copied during bootstrap.
- `mdms_search` for `common-masters.Department` on `mz` — 5 records (DEPT_1..DEPT_5), Hindi-context department names from pg.
- `localization_search` for `mz` / `rainmaker-pgr` / `en_IN` — 1253 records, en_IN baseline fully copied.
- `boundary_hierarchy_search` for `mz` — empty, hierarchy not at root level.

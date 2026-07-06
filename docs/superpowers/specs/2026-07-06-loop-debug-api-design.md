# Design: `loop-debug-api` — a production operator tool for API-failure root-cause analysis

**Date:** 2026-07-06
**Status:** Approved design, pending implementation plan
**Source method:** [singhalkarun/loop-engineering](https://github.com/singhalkarun/loop-engineering) —
`debugging-agent-design.md` (operationalized here), evolved over time with
`bug-causes-what-changed.md` and `debugging-sources.md`.

---

## 1. Summary

Operationalize `debugging-agent-design.md` for this DIGIT/eGov monorepo as a **production-grade,
operator-driven debugging tool** (architecture "B": human-in-the-loop, real tools underneath — not
an autonomous headless service).

Given a failing API call (`curl` + response + failure timestamp), the tool reconstructs the
cross-service call chain, drills to the **deepest failing (root) service**, and returns a ranked,
evidence-cited root-cause hypothesis. Every asserted fact must trace to a read-only tool call — no
invented log lines, commits, or versions.

The deliverable is a Claude Code **skill** (the reasoning/method layer) backed by a **production
read-only tool layer built into `digit-mcp`** (the evidence layer).

## 2. Context & key findings (why this design)

- **Target environment:** the `bomet` deployment (`62.238.3.196`, ssh host `bomet`), a
  docker-compose + Ansible DIGIT install. It runs a full observability stack (Loki, Tempo, Promtail,
  Prometheus, Grafana, OTEL collector), Kong gateway, and the `digit-mcp` container.
- **Distributed tracing is effectively absent.** Empirical probe (2026-07-05): across 150 traces over
  12h, **only 1 spanned more than one service**; Kong traces are single-service islands and
  `kong.request.id` does not reach backend spans. So `digit-mcp`'s `trace_debug`/`trace_get` cannot
  supply a cross-service call chain here. This matches the world `debugging-agent-design.md` was
  written for.
- **Decision: log-based debugging, no correlation-id workstream.** We deliberately do **not** build
  request-id/correlation-id propagation. The agent correlates evidence by **service + time window +
  error signature**, and reconstructs the call chain by **reading each service's outbound calls in
  code**. Accepted tradeoff: cross-service correlation is imprecise under heavy concurrent load.
- **`digit-mcp` is the right tool home.** Its container sits inside bomet's docker network (so a Loki
  client reaches `http://digit-loki:3100` with no ssh and no exposing Loki publicly), and it already
  has a tool-group registry, service clients (`tempo.ts`, `db.ts`, `shell.ts`), and CI.
- **No shortcuts.** Evidence is fetched through real read-only clients (Loki API, GitHub API,
  read-only `docker inspect`), not ad-hoc `ssh docker exec`. Read-only is a property of the tool
  layer, not merely a prompt rule.

## 3. Scope

**In scope — the complete method:**
- Five read-only evidence tools in `digit-mcp`: `resolve_route`, `get_logs`, `get_changes`,
  `get_deploys`, `read_source`.
- Multi-hop drill-down to the root service (chain reconstructed from logs + code-read outbound calls).
- `.mcp.json` wiring so the operator's Claude Code session can call the tools.
- The `loop-debug-api` skill encoding the full method, human-in-the-loop.
- End-to-end proof on one real bomet failure.

**Out of scope (architecture choice B, not a cut):** an autonomous/headless runtime. The agent is
operator-driven.

**Explicitly not built:** correlation-id / request-id propagation (see §2).

## 4. Architecture — "Arch 1": uniform MCP tool layer

All five tools live in `digit-mcp` as a new `debug` tool group, presenting one uniform MCP surface.
The skill is a thin orchestrator that only calls MCP tools.

Source/history tools bind to the **exact deployed gitsha** (parsed from the running image tag) via the
**GitHub API**, so evidence reflects what is actually running on bomet — not whatever the operator has
checked out locally.

```
Operator's Claude Code session
        │  (.mcp.json → digit-mcp HTTP endpoint)
        ▼
  loop-debug-api skill  ──calls──▶  digit-mcp `debug` tool group
  (method / system prompt)              │
                                        ├─ resolve_route   → kong.yml (bundled) + get_deploys
                                        ├─ get_logs        → Loki query_range @ digit-loki:3100
                                        ├─ get_deploys     → docker inspect (image tag) → gitsha
                                        ├─ get_changes     → GitHub API @ deployed gitsha
                                        └─ read_source     → GitHub API @ deployed gitsha
```

### 4.1 Tool specifications (all read-only)

| Tool | Input | Source on bomet | Returns |
|---|---|---|---|
| `resolve_route` | `path` | bundled `kong.yml` routing table (authoritative prefix→upstream) + `get_deploys` | `service`, `version_live_at_t`, `code_location` |
| `get_logs` | `service`, `time_window`, optional `filter` | Loki `query_range` at `http://digit-loki:3100`, label `service_name` | `[{ts, level, service, message, stack_trace}]` |
| `get_changes` | `service`, `time_window` | GitHub API, commits touching the service's source path, windowed | `[{sha, author, ts, message, files_changed}]` |
| `get_deploys` | `service`, `time_window` | running image tag via read-only `docker inspect` → gitsha; git history of `docker-compose.bomet.yml` | `version`, `deployed_at`, `commit_range` |
| `read_source` | `service`, optional `path`/`ref` | GitHub API at the deployed gitsha | source text (to find outbound calls + inspect failing line) |

### 4.2 Read-only enforcement
- Loki, `docker inspect`, and GitHub reads are query-only; **no write paths are added**.
- `docker inspect` runs through `digit-mcp`'s existing fixed, no-arbitrary-exec `shell.ts` registry
  (already limited to `docker ps`/`inspect`/`exec`-read patterns).
- Tools ship **disabled** until `enable_tools('debug')`, per the existing registry pattern.

## 5. Method — chain reconstruction from logs (no correlation id)

The skill's `SKILL.md` encodes `debugging-agent-design.md`'s system prompt, adapted so the call chain
is reconstructed from **logs + code** rather than a distributed trace:

1. **Anchor.** From `curl + response + timestamp t`: extract route, HTTP status, error signature
   (code + message). Windows: logs `[t−5m, t+1m]`; changes/deploys `[t−72h, t]`.
2. **Entry.** `resolve_route(path)` → owning service + `code_location` + `version_live_at_t`.
   `get_logs(service, window)`; isolate the failing request by **timestamp proximity + matching the
   error signature** the operator saw. (Low-traffic box: usually pinpoints it. Under load: ambiguous —
   the skill must say so.)
3. **Find the edges.** `read_source(service)` to find which **downstream endpoints** it calls near the
   failing path — this is how the next hop is known without a trace.
4. **Walk down.** For each downstream: `resolve_route(downstream_path)` → service; `get_logs` it in the
   same window; match by timestamp + relayed error text. Recurse to the **deepest failing** service
   (its own downstreams all succeeded / it makes none / it fails at an external boundary). That is the
   **root**.
5. **Find the cause.** On the root: `get_deploys` (did its version deploy just before `t`?) +
   `get_changes` (commit touching the failing `file:line` from the stack trace) + `read_source` to
   confirm the change explains the failure.
6. **Rank & report.** HIGH / MED / LOW per the doc. Top 1–3 hypotheses: claim, propagation chain
   (entry ← … ← root), exact evidence (quoted log line + cited commit/deploy/version on the root),
   confidence, concrete next step. **Attribute the cause to the root**, never to a service that merely
   relayed the error. Then hand to the human to confirm.

**Framework tie-in (light for v1, evolved over time):** step 6 (rank) cites
`bug-causes-what-changed.md` buckets for the cause category; the where-to-look reasoning cites
`debugging-sources.md`.

## 6. Honest limits (stated by the tool, not hidden)

- **Timestamp correlation is imprecise under concurrent load.** With no shared id, cross-service
  linkage is time-window + code-read call edges; the skill flags when a window is ambiguous.
- **Mutable image tags can't be pinned to a commit.** `get_deploys` resolves immutable tags
  (`v2.11-a520687`, `master-e22c7c5`, `maven-jdk21-9f83afb`) to a gitsha, but several bomet services
  run mutable tags (`nightly-develop`, `latest`) that cannot be tied to an exact commit — the tool
  says so rather than guessing.
- **Local checkout drift is avoided** by binding source/history tools to the deployed gitsha via
  GitHub (Arch 1), but requires GitHub API access to the repo and the sha being present on GitHub.

## 7. Skill structure

```
.claude/skills/loop-debug-api/
  SKILL.md            # the method (anchor → resolve → logs → edges → walk to root → cause → report; human-gated)
  references/
    debugging-agent-design.md      # committed from loop-engineering (source method)
    bug-causes-what-changed.md     # consulted at the rank/correlate step
    debugging-sources.md           # consulted at the where-to-look step
```

The three loop-engineering docs are committed as the skill's spec and annotated over time with DIGIT
specifics (Loki labels, Kong prefixes, tag→sha rules).

## 8. Integration & deployment

- New `debug` tool group in `digit-mcp` (`services/loki.ts`, `services/github.ts`,
  `tools/{logs,changes,deploys,read-source,resolve-route}.ts`), registered via the existing
  `ToolRegistry`.
- Build + push the updated `digit-mcp` image; redeploy the `digit-mcp` container on bomet.
- Add `.mcp.json` at repo root registering the `digit-mcp` HTTP endpoint so Claude Code sessions see
  the `debug` tools.

## 9. Verification & definition of done

**Tool-level.** Unit/integration tests in `digit-mcp`'s existing setup: mock Loki `query_range`, mock
GitHub API, fixture `docker inspect` output, fixture `kong.yml`. Explicitly cover the honest-limit
paths (mutable-tag → "unpinnable"; ambiguous window → "multiple candidates"). Extend
`digit-mcp-ci.yml` to cover the `debug` group.

**End-to-end proof (read-only, authentic).**
1. Mine bomet's Loki for a **genuine** recent 4xx/5xx (real `route + response + timestamp`) — zero
   writes to the box.
2. Run the skill on that anchor end-to-end.
3. **Human gate:** operator confirms the named root service + cause against reality. That confirmation
   is the pass.

**Success criteria (all must hold):**
- Reaches the **correct root** service (not just the error-surfacing one).
- **Every** asserted fact traces to a tool call — no invented log lines, commits, or versions.
- Honest limits fire correctly (says "correlation approximate" / "tag unpinnable" when true).

## 10. Follow-on work (committed to the overall effort, not this changeset)

- `bug-causes-what-changed.md` and `debugging-sources.md` deep integration (richer cause ranking and
  source selection).
- Broader route coverage / other tenants beyond bomet.
- Optional later evolution toward architecture "A" (autonomous/headless runtime) if desired.

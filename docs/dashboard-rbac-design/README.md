# Dashboard RBAC & KPI Access — deep design (in parts)

A multi-part design for moving dashboard config + access control server-side and adding **attribute-based row restriction (jurisdiction + department)** to the DIGIT PGR analytics API. Each part was authored against the real `pgr-services` / dashboard-UI / Kong source, then **adversarially reviewed by a separate agent pointed at that same code**. Generated 2026-06-23 via the `rbac-deep-design` workflow.

> Builds on `../dashboard-query-api-design.md` (§5/§5a) and `../rbac-kpi-access-implementation-plan.md`. Read `00-requirements.md` first — it is the shared spec.

## Parts & review verdicts

| # | Part | File | Verdict |
|---|------|------|---------|
| — | Requirements & stage-setting | `00-requirements.md` | (spec) |
| A | Trust Foundation (identity & auth) | `10-auth-foundation.md` | 🟡 sound-with-risks |
| B | Attribute Resolution (roles, jurisdiction, department) | `20-attribute-resolution.md` | 🟡 sound-with-risks *(1 blocker)* |
| C | Row-Scope Enforcement (generalized attribute scoping) | `30-row-scope-enforcement.md` | 🟡 sound-with-risks *(1 blocker)* |
| D | KPI Catalog, Definitions & Inline Gating | `40-kpi-catalog-governance.md` | 🔴 needs-rework |
| E | Dashboard Packs & Config Ownership | `50-packs-config-ownership.md` | 🔴 needs-rework |
| F | Frontend Inversion (FE → BE) | `60-frontend-inversion.md` | 🟡 sound-with-risks |

### Follow-on parts (the three items appended to CCRS #631 — pass-1, not yet adversarially reviewed)

| # | Part | File | Answers |
|---|------|------|---------|
| 65 | FE → BE Dashboard Config Extraction Inventory | `65-fe-config-inventory.md` | the worklist for pulling the 52 hardcoded KPIs/queries/viz/layout from the FE into `dss.KpiDefinition`/`dss.DashboardPack` (feeds D + F); §4b corrected to move compose *rules* to `viz.compose` |
| 66 | Viz Schema & Wide-Migration API Contract | `66-viz-schema-api-contract.md` | the concrete `viz` JSON schema (kind/format/valueKey/accent/variants/compose/pii) + the 3+1 API calls (`/packs`, `/_query`, `/catalog/_search`, `/user-preference/_upsert`); draws the FE/BE line: engine stays FE, spec comes from BE |
| 70 | Dashboard View Management Across Users | `70-view-management.md` | "elaborate how view management works for different users" — synthesis over D/E/F (who manages what, lifecycle) |
| 80 | Multi-Tier Complaint Types in the Grains | `80-multi-tier-complaint-types.md` | "array/jsonb or config-built MV" → a `complaint_node_path` materialized path (boundary-path analogue); consumes Discussion **#864** |
| 90 | Dashboard Test Strategy | `90-test-strategy.md` | "tests for dashboard" — consolidates A–F per-part tests into one leak-regression matrix + layers + exit gates |

Parts A–F each end with a `## Code-grounded review (<verdict>)` section carrying the full severity-tagged findings with `file:line` evidence. Parts 70/80/90 are **pass-1** (authored against the same code + Discussion #864) and have **not** yet had that dual-review pass run — each ends with a "Review status" note saying so.

## Dependency graph

```
A (trust identity) ──► B (resolve attributes) ──► C (enforce row scope)
                   └──► D (KPI catalog + gating) ──► E (packs / config ownership)
                   └──► F (frontend inversion)
```
A is the hard prerequisite for all; C depends on B; E curates over D. D/F can proceed in parallel with B/C once A lands.

## Cross-cutting findings the reviews surfaced (act on these first)

1. **🔴 BLOCKER — existing daily-grain citizen leak (found independently by reviewers A *and* C).** `complaint_open_state_daily` has `citizenColumn = null` (`AnalyticsCatalog.java:108`); the citizen self-scope predicate is guarded by `citizenColumn != null` (`AnalyticsPlanner.java:246`). So a pure **citizen querying `grain:"daily"` gets every open complaint in the tenant** — a real leak in shipped code, not just a design gap. Fix in Part C: add `account_id` to the daily grain (or reject citizen daily queries). The convergence is the signal — fix this regardless of the rest.
2. **Identity is fail-OPEN, not fail-closed (A + F).** The reused `ServiceRequestRepository.fetchResult` swallows 5xx/timeout and returns `null` (`ServiceRequestRepository.java:38-40`), and removing FE-supplied `userInfo` (F) depends on the Kong enrichment that today returns early when `userInfo` is present (`kong.yml:65-68`). Net: introspection must be **mandatory + coercive**, and `null` must map to `401`, or hardening the FE silently fails open.
3. **Department scoping has three silent-drop traps (B + C):** (a) MDMS v1-flat vs v2-wrapped `Department.json` shape → one read path loads **zero** codes; (b) `department_code` is `NULL` for any complaint whose `service_code` lacks a ServiceDefs row (LEFT JOIN, `…grain_mvs.sql:227`) and `NULL IN (...)` is never true; (c) the **events grain has no `department_code` column** at all. Any of the three turns a department filter into a silent under- or over-scope.
4. **The "narrow-only" client param doesn't exist (C).** `boundary_path` isn't in the grain `filterable` set (`AnalyticsPlanner.java:174`), so the declared `boundaryScope`/`departmentScope` narrowing param the spec leans on has no code path yet.
5. **🔴 Batch `queries` arm bypasses the inline gate + kpiId re-check (D).** `AnalyticsService.query()` has two arms; the batch dict arm (`AnalyticsService.java:42-46`) calls `runOne()` directly — wiring only the single arm leaves a hole.
6. **🔴 user-preferences-service is itself spoofable (E).** It keys records on body `Preference.UserId`, using the token uuid only for audit fields — so per-user layout can't just be delegated to it; that store needs its own identity binding.
7. **`tenantStateLevel` dropped in `PrincipalAttributes` (B)** → Part C can't choose `LIKE prefix` (state) vs `= tenant` (city), a cross-tenant leak risk.

## Mis-citations to correct in the design text

- **B:** `/boundary/_search` returns the **legacy** Boundary model — the v2 model (`web/models/boundary/Boundary.java`) has **no `materializedPath`**. The path must come from elsewhere (boundary hierarchy / the grain's own `ancestralmaterializedpath`).
- **E:** `AnalyticsScope.rolesOf(ri)` and the `_query` tenant cross-check **do not exist**; the user-preferences service **is** vendored in-tree (Open Q1 answerable) and uses `_upsert`/`_search`, not REST PUT.
- **D:** `_schema` is unauthenticated and returns PII/officer columns past any def ceiling — must be role-filtered.

## Pass 2 — revise + external codex review (2026-06-23)

Each part was revised to fold in its pass-1 findings (replacing the old review with a `## v2 revision log`), then re-reviewed by an **external `codex exec` (gpt-5.5, read-only)** pass that verified the revision claims against the actual code.

| Part | pass-1 (Claude) | pass-2 codex | codex resolved-in-code |
|---|---|---|---|
| A — Trust Foundation | 🟡 | 🔴 needs-rework | 5/11 |
| B — Attribute Resolution | 🟡 | 🔴 needs-rework | 6/14 |
| C — Row-Scope Enforcement | 🟡 | 🔴 needs-rework | 3/13 |
| D — KPI Catalog & Gating | 🔴 | 🔴 needs-rework | 0/15 |
| E — Dashboard Packs | 🔴 | 🔴 needs-rework | 8/10 |
| F — Frontend Inversion | 🟡 | 🔴 needs-rework | 4/10 |

### ⚠ How to read the codex verdicts — framing collision
Codex judged "resolved" as **"patched in the code,"** not "the design now correctly specifies the fix." Because this is a **design exercise with no code written yet**, codex correctly observes the code at `AnalyticsPlanner.java:246` etc. is unchanged and therefore marks most `resolvedCheck` items false. That is true but largely **not a design defect** — it's an implementation-status statement. The blanket 🔴s mostly mean "still unimplemented," which was never in dispute. The signal to extract is the subset of findings that are **genuine design errors**, below.

### Genuine design errors codex caught — ✅ ALL FIXED in pass-3 (each verified against code; see per-file `### v3 corrections`)
1. **F — ✅ fixed:** count corrected **48→52** (verified `kpiQueries.js:47-416`); the false "escalation tiles project no officer dims" claim corrected — `er_critical_by_officer` projects `current_assignee_uuid` via `officerTopCount` (`kpiQueries.js:37-45,314`), now flagged as a real Layer-2 officer-PII path routed through `visibleTo`/officer-gate.
2. **D — ✅ fixed:** `MDMSServiceV2.search()` confirmed **first-hit, no merge** (`MDMSServiceV2.java:83-89`) → defs now resolved via two explicit reads (city + state root) merged in-process; `x-unique` confirmed composite-key-uniqueness only (`CompositeUniqueIdentifierGenerationUtil.java:23-44`, `_update` still mutates) → immutable versioning made an **explicit pipeline invariant** (version in key + never-update-published + forward-only status), x-unique demoted to a dup-create backstop.
3. **B — ✅ fixed:** confirmed legacy `Boundary.java:57` has `materializedPath`, v2 boundary model does not; grain builds `boundary_path` globally `DISTINCT ON (code)` with no tenant filter (`…grain_mvs.sql:21-25`) → jurisdiction prefix now anchors on the **grain's own `boundary_path`** (one source of truth), with the duplicate-code hazard noted.
4. **C — ✅ fixed:** added subsection **C.1a "The default is DENY-ALL"** — a 4-arm classification where the fall-through arm denies (`1=0`/empty), and unresolved/failed HRMS lookups fail **closed**; replaces today's fail-open tenant-only fall-through (`AnalyticsScope.java:47` → `AnalyticsPlanner.java:242-246`).
5. **E — ✅ fixed:** `AdvancedPage.tsx` re-cited to `CCRS/configurator/src/resources/advanced/AdvancedPage.tsx:7`; the A.4 cross-ref re-pointed to `10-auth-foundation.md` §A.4 (`:231`).

### Convergent across BOTH passes (the real must-fix, independent of framing)
- **Daily-grain citizen leak** — `complaint_open_state_daily` has `citizenColumn=null` (`AnalyticsCatalog.java:108`) + the `citizenColumn!=null` guard (`AnalyticsPlanner.java:246`) ⇒ a citizen querying `grain:"daily"` gets tenant-wide rows. Flagged by Claude (A+C) *and* codex (A,B,C,D). **This is a real existing bug; fix in Part C regardless.**
- **Fail-open identity** — both passes: introspection must be mandatory+coercive and `null`→`401`.
- **Batch `queries` arm bypasses gating** (`AnalyticsService.java:42-46`) — both passes.
- **Department silent-drops** (code-space, NULL LEFT JOIN, events grain missing column) — both passes.

## Status / next step

Design + critique only — **no code changed**; that is by design (PR-per-phase comes later). Pass-2 takeaway: the *design* is materially sound but carries ~5 genuine factual errors (above) to correct, and codex's value was as a fact-checker against real code, not as an implementation gate. Recommended: (a) correct the 5 design errors, (b) treat the convergent four as the Phase-0/Phase-C must-fixes, (c) begin implementation with Part A (auth) since every codex 🔴 ultimately reduces to "identity still spoofable + nothing implemented yet."

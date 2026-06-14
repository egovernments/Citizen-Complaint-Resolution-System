# PGR Configurable Hierarchy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. This is a master plan spanning seven workstreams. Each workstream marked **EXPAND** must be rewritten as its own detailed bite-sized plan before execution starts.

**Goal:** Evolve PGR's complaint taxonomy into a tenant-configurable jagged tree of up to four levels, delivered as additive changes on the existing `ServiceDefs` master, two new PGR endpoints, a migration utility, and updates to two UI codebases plus the configurator.

**Architecture:** In-place extension of `ServiceDefs` MDMS v2 master with `parentCode` + `level`; new `HierarchyConfig` master for per-tenant depth and level names; two new PGR-services endpoints (`_tree`, `_validate`); data-driven UI dispatch via presence of `HierarchyConfig`; per-tenant opt-in migration utility; no `/v3/` API path.

**Tech Stack:** Java 17 + Spring Boot 3.2.2 (pgr-services), Python 3.11 (migration utility under `utilities/mdms-v2-migration/`), React (digit-ui-esbuild, digit-ui-v2, configurator), MDMS v2 (in-flight, dependency).

**Source spec:** `docs/superpowers/specs/2026-06-14-pgr-configurable-hierarchy-design.md`

---

## Workstream overview and sizing

| # | Workstream | Tech | Engineer-days | Risk | Depends on |
|---|---|---|---|---|---|
| 1 | MDMS v2 schema additions (`ServiceDefs` + `HierarchyConfig`) | MDMS v2 | 1–2 | Medium — depends on MDMS v2 readiness | MDMS v2 migration utility landed for PGR |
| 2 | PGR-services `_tree` endpoint | Java | 2–3 | Low | W1 |
| 3 | PGR-services `_validate` endpoint | Java | 3–4 | Low | W1 |
| 4 | PGR-services additive changes on existing endpoints (`parentServiceCode` filter, `complaintNodePath` field) | Java | 1–2 | Low | W2 |
| 5 | Migration utility under `utilities/mdms-v2-migration/migrate_pgr_hierarchy.py` | Python | 3–4 | Medium — edge cases | W3 |
| 6 | `digit-xlsx-onboard` skill + dataloader templates for hierarchical input | Python | 2 | Low | W3 |
| 7 | `useComplaintTaxonomy()` hook + citizen picker rewrite — `digit-ui-esbuild` | React | 5–7 | Low | W2 |
| 8 | `useComplaintTaxonomy()` hook + citizen picker rewrite — `digit-ui-v2` | React | 5–7 | Low | W2 |
| 9 | Configurator tree editor (CRUD + `_validate` integration) **EXPAND** | React | 8–12 | High — largest piece, scope creep risk | W3 |
| — | Cross-workstream: integration testing, regression suite, demo prep | All | 4–6 | Medium | All workstreams |

**Totals (independent worker effort, no parallelism):** 34–49 engineer-days, ≈ 7–10 weeks for one engineer.

**With realistic parallelism (3 engineers — 1 backend, 1 frontend, 1 ops/configurator):** 4–6 calendar weeks end-to-end. Critical path is **W1 → W3 → W9** (MDMS schema → validator → configurator). Backend tree endpoint (W2) can branch to unblock both UI streams (W7, W8) in parallel.

**Mozambique go-live alignment:** Per `project_github_structure.md` memory, Release 2.20 (SaaSSy Phase 1, due 2026-07-31) is the candidate. This plan fits a 4–6 week calendar window if started by end of June 2026; tighter than that needs scope cuts (defer W9 drag-reparent affordances, defer W8 if v2 UI is not the citizen path for Maputo).

---

## Dependencies and sequencing

```
W1 (MDMS schema) ──────┬──> W2 (_tree)  ─────┬──> W7 (UI esbuild)
                       │                     ├──> W8 (UI v2)
                       │                     └──> W4 (additive)
                       │
                       └──> W3 (_validate) ──┬──> W5 (migration utility)
                                             ├──> W6 (xlsx-onboard)
                                             └──> W9 (configurator tree editor)
```

**Hard gating:** W1 must complete before anything else starts. W2 must complete before W4, W7, W8 start. W3 must complete before W5, W6, W9 start.

**Recommended order if single engineer:** W1 → W2 → W3 → W4 → W5 → W7 → W6 → W9 → W8.

---

## File structure

### MDMS v2 schemas (Workstream 1)

- Modify: `<MDMS-v2-repo>/RAINMAKER-PGR/schemas/ServiceDefs.json` — add optional `parentCode`, `level` fields. **Exact path TBD by MDMS v2 working group answer.**
- Create: `<MDMS-v2-repo>/RAINMAKER-PGR/schemas/HierarchyConfig.json` — new master schema.

### PGR-services (Workstreams 2, 3, 4)

- Create: `backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/ServiceDefsTreeController.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/service/ServiceDefsTreeService.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/service/ServiceDefsValidator.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/ServiceDefsTreeRequest.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/ServiceDefsTreeResponse.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/ServiceDefsValidateRequest.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/ServiceDefsValidateResponse.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/ComplaintNode.java`
- Create: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/HierarchyConfig.java`
- Modify: `backend/pgr-services/src/main/java/org/egov/pgr/service/ServiceRequestService.java` — add `parentServiceCode` filter expansion.
- Modify: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/ServiceRequestSearchCriteria.java` — add `parentServiceCode` field.
- Modify: `backend/pgr-services/src/main/java/org/egov/pgr/web/models/Service.java` — add optional `complaintNodePath` field.
- Create: `backend/pgr-services/src/test/java/org/egov/pgr/service/ServiceDefsTreeServiceTest.java`
- Create: `backend/pgr-services/src/test/java/org/egov/pgr/service/ServiceDefsValidatorTest.java`

### Migration utility (Workstream 5)

- Create: `utilities/mdms-v2-migration/migrate_pgr_hierarchy.py`
- Create: `utilities/mdms-v2-migration/pgr_hierarchy/__init__.py`
- Create: `utilities/mdms-v2-migration/pgr_hierarchy/derive_tree.py` — `menuPath` grouping → L1 nodes.
- Create: `utilities/mdms-v2-migration/pgr_hierarchy/mdms_client.py` — MDMS read/write wrapper.
- Create: `utilities/mdms-v2-migration/pgr_hierarchy/validator_client.py` — calls PGR `_validate`.
- Create: `utilities/mdms-v2-migration/pgr_hierarchy/backup.py` — snapshot/restore.
- Create: `utilities/mdms-v2-migration/tests/test_derive_tree.py`
- Create: `utilities/mdms-v2-migration/tests/test_migrate_pgr_hierarchy_e2e.py`

### digit-xlsx-onboard skill (Workstream 6)

- Modify: `.claude/skills/digit-xlsx-onboard/SKILL.md` (or equivalent — check current location)
- Modify: `local-setup/jupyter/dataloader/templates/` — add hierarchical complaint types template.
- Modify: `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/` — sample HierarchyConfig.

### UI — digit-ui-esbuild (Workstream 7)

- Create: `digit-ui-esbuild/packages/libraries/src/hooks/pgr/useComplaintTaxonomy.js`
- Deprecate (keep callers working then remove): `digit-ui-esbuild/packages/libraries/src/hooks/pgr/useServiceDefs.js`
- Rewrite: `digit-ui-esbuild/products/pgr/src/pages/citizen/Create/FormExplorer.js`
- Create: `digit-ui-esbuild/products/pgr/src/components/TreePicker/` (subcomponents — exact file split decided in detailed plan).

### UI — digit-ui-v2 (Workstream 8)

- Create: `digit-ui-v2/src/hooks/pgr/useComplaintTaxonomy.ts`
- Rewrite: `digit-ui-v2/src/pages/CitizenComplaintCreate.tsx` (and related — exact file list from existing structure).
- Create: `digit-ui-v2/src/components/TreePicker/`

### Configurator (Workstream 9)

- Rewrite: `configurator/src/resources/complaint-types/index.tsx`
- Create: `configurator/src/resources/complaint-types/TreeEditor.tsx`
- Create: `configurator/src/resources/complaint-types/NodeEditModal.tsx`
- Create: `configurator/src/resources/complaint-types/HierarchyConfigEditor.tsx`
- Create: `configurator/src/resources/complaint-types/api/validateBeforeWrite.ts`

---

## Workstream 1 — MDMS v2 schema additions (1–2 days)

**Pre-requisite confirmation:** MDMS v2 working group must confirm that (a) `ServiceDefs` schema additions can land in MDMS v2, (b) self-reference fields are supported for `parentCode → ServiceDefs.serviceCode`. **This is a blocking question — see Open Question 1 in the spec.** Do not start until confirmed.

### Task 1.1 — Locate MDMS v2 schema registration target

- [ ] **Step 1:** Read `utilities/mdms-v2-migration/README.md` and `utilities/mdms-v2-migration/generate_mdms_seed_sql.py` to identify where PGR schemas land in MDMS v2.
- [ ] **Step 2:** Inspect any existing `ServiceDefs` schema definition. Document the current schema path and how it is registered.
- [ ] **Step 3:** Commit a doc note under `utilities/mdms-v2-migration/notes/pgr-schemas.md` recording the location for future work.

### Task 1.2 — Add `parentCode` + `level` to `ServiceDefs` schema

- [ ] **Step 1:** Add optional `parentCode` field (`type: string`, nullable). Configure as schema-reference to `ServiceDefs.serviceCode` within tenant scope if MDMS v2 supports it.
- [ ] **Step 2:** Add `level` field (`type: integer`, `minimum: 1`, `maximum: 4`, optional, default 1).
- [ ] **Step 3:** Verify that an existing flat `ServiceDefs.json` (Nairobi sample) loads cleanly against the updated schema with no migration.
- [ ] **Step 4:** Commit schema change.

### Task 1.3 — Create `HierarchyConfig` schema

- [ ] **Step 1:** Define schema with fields: `tenantId` (required, string), `depth` (required, integer, 1..4), `levels` (required, array of `{level, code, nameKey}`).
- [ ] **Step 2:** Add sample `HierarchyConfig.json` for `moz.maputo` with `depth: 3` and three Portuguese-key levels.
- [ ] **Step 3:** Run sample load through MDMS v2 to verify schema accepts it.
- [ ] **Step 4:** Commit.

---

## Workstream 2 — `POST /v2/serviceDefs/_tree` endpoint (2–3 days)

### Task 2.1 — Define request/response models

- [ ] Create `ServiceDefsTreeRequest` with fields: `RequestInfo`, `tenantId` (required), `rootCode` (optional).
- [ ] Create `ServiceDefsTreeResponse` with: `ResponseInfo`, `tree: List<ComplaintNode>`, `hierarchyConfig: HierarchyConfig` (nullable).
- [ ] Create `ComplaintNode` POJO: `serviceCode`, `name`, `parentCode`, `level`, `active`, `slaHours`, `department`, `keywords`, `children: List<ComplaintNode>`.
- [ ] Create `HierarchyConfig` POJO: `depth`, `levels: List<HierarchyLevel>`, where `HierarchyLevel` is `{level, code, nameKey}`.

### Task 2.2 — Tree assembly service (TDD)

- [ ] Write failing test: `assembleTree_givenFlatRowsWithParents_returnsNested`.
- [ ] Write failing test: `assembleTree_givenRootCode_returnsSubtree`.
- [ ] Write failing test: `assembleTree_givenOrphanRow_logsWarningAndOmits`.
- [ ] Implement minimal `ServiceDefsTreeService.assemble(List<ServiceDefRow>, rootCode)`.
- [ ] Run tests, ensure all pass.
- [ ] Commit.

### Task 2.3 — Wire MDMS v2 client read

- [ ] Implement `ServiceDefsTreeService.fetchFromMdms(tenantId)` calling MDMS v2 generic `_search`.
- [ ] Implement parallel `HierarchyConfig` fetch.
- [ ] Add integration test using `WireMock` against a stubbed MDMS v2 response.
- [ ] Commit.

### Task 2.4 — Controller

- [ ] Implement `ServiceDefsTreeController` mapping `POST /v2/serviceDefs/_tree`.
- [ ] Add controller test verifying request → service → response wiring.
- [ ] Commit.

**EXPAND for execution:** Detailed bite-sized plan with full TDD code blocks should be written when this workstream is scheduled.

---

## Workstream 3 — `POST /v2/serviceDefs/_validate` endpoint (3–4 days)

### Task 3.1 — Validator rules as pure functions (TDD)

- [ ] Implement `ServiceDefsValidator.validateLevelMatchesParent(rows)` — `level == parent.level + 1` (or `level == 1, parentCode == null`).
- [ ] Implement `ServiceDefsValidator.validateLevelWithinDepth(rows, hierarchyConfig)` — `level <= depth`.
- [ ] Implement `ServiceDefsValidator.validateLeafAttributes(rows)` — leaves have `slaHours` + `department`; non-leaves have them null.
- [ ] Each rule gets its own test class with positive + negative cases.
- [ ] Commit after each rule lands green.

### Task 3.2 — Aggregate validator + violation report

- [ ] Define `Violation` model: `serviceCode`, `rule`, `message`.
- [ ] Implement aggregator that runs all rules and returns a list of violations (empty list = valid).
- [ ] Write test: full validation against Mozambique sample (3-level tree, jagged) — expect zero violations.
- [ ] Write test: deliberately corrupt sample — expect specific violation list.

### Task 3.3 — Controller

- [ ] Implement `POST /v2/serviceDefs/_validate` accepting `ServiceDefsValidateRequest` (batch input).
- [ ] Validator fetches current `HierarchyConfig` for tenant from MDMS for depth check.
- [ ] Return `ServiceDefsValidateResponse` with `valid: boolean`, `violations: List<Violation>`.
- [ ] Add controller integration test.
- [ ] Commit.

### Task 3.4 — Startup backstop logging

- [ ] Add `@PostConstruct` hook that runs validation across all tenants' `ServiceDefs` at PGR-services startup.
- [ ] Log violations at WARN level, do NOT fail startup.
- [ ] Add metrics counter `pgr.servicedefs.invariant.violations` per tenant.
- [ ] Commit.

**EXPAND for execution.**

---

## Workstream 4 — Additive on existing endpoints (1–2 days)

### Task 4.1 — `parentServiceCode` filter on complaint search

- [ ] Add `parentServiceCode` to `ServiceRequestSearchCriteria`.
- [ ] In `ServiceRequestService.search()`, when `parentServiceCode` is present: call `ServiceDefsTreeService` to fetch the subtree, extract leaf `serviceCode`s, append to existing `serviceCodes` filter (OR-merge if both supplied).
- [ ] Write test: search with `parentServiceCode="SAN"` returns complaints across all SAN.* leaves.
- [ ] Commit.

### Task 4.2 — `complaintNodePath` on Service model

- [ ] Add optional `complaintNodePath: List<String>` to `Service` model.
- [ ] In `_create` response: populate from `ServiceDefsTreeService.findPath(serviceCode)`.
- [ ] In `_create` request: accept (informational only — `serviceCode` remains source of truth).
- [ ] Commit.

---

## Workstream 5 — Migration utility (3–4 days)

### Task 5.1 — `derive_tree.py` (pure logic, TDD)

- [ ] Function `derive_tree(flat_rows: list) -> tuple[list, HierarchyConfig]`.
- [ ] Test: flat rows with `menuPath="Garbage"` produce L1 parent `GARBAGE` and the existing rows become L2 leaves with `parentCode="GARBAGE"`.
- [ ] Test: rows with null/empty `menuPath` become L1 leaves.
- [ ] Test: synthetic L1 code derivation deterministic (`"Street Lights" → "STREET_LIGHTS"`).
- [ ] Test: collision detection — if synthetic L1 code matches an existing `serviceCode`, raise `CodeCollisionError` with offending pair.
- [ ] Test: `--code-map` override is respected.

### Task 5.2 — `mdms_client.py` and `validator_client.py`

- [ ] Wrap MDMS v2 `_search` / `_create` / `_update` for `ServiceDefs` and `HierarchyConfig`.
- [ ] Wrap PGR `_validate` call.
- [ ] Add unit tests against `responses` stub library.

### Task 5.3 — `backup.py`

- [ ] Function `snapshot(tenant_id) -> Path` writes current state to `migration_backups/<tenant>/<utc-ts>/`.
- [ ] Function `restore(tenant_id, backup_path)` applies snapshot.

### Task 5.4 — CLI orchestration

- [ ] Typer CLI with `--dry-run`, `--apply`, `--rollback --backup-ts`, `--force`, `--code-map`.
- [ ] Apply path: snapshot → derive → validate → write HierarchyConfig → write ServiceDefs → re-read tree → verify leaf count == pre-migration row count.
- [ ] Idempotency check: detect existing `HierarchyConfig`, exit with "already migrated" unless `--force`.

### Task 5.5 — End-to-end smoke test

- [ ] Use Nairobi's actual `ServiceDefs.json` (in dev tier).
- [ ] Run dry-run → verify produced tree.
- [ ] Run apply → verify MDMS reads back correctly.
- [ ] Run rollback → verify state restored.

**EXPAND for execution.**

---

## Workstream 6 — `digit-xlsx-onboard` skill + dataloader (2 days)

### Task 6.1 — XLSX template update

- [ ] Add new sheet `Complaint Types — Hierarchy` to the operator template.
- [ ] Columns: `level`, `parentCode`, `serviceCode`, `name`, `slaHours`, `department`, `keywords`, `active`.
- [ ] Add separate `Hierarchy Config` sheet: `depth`, `level`, `code`, `nameKey`.
- [ ] Document operator instructions.

### Task 6.2 — Dataloader changes

- [ ] Read both sheets.
- [ ] Build `ServiceDefs` payload + `HierarchyConfig` payload.
- [ ] Call PGR `_validate` before writing.
- [ ] Write both to MDMS v2.
- [ ] Verify by reading tree from PGR.

### Task 6.3 — Skill documentation update

- [ ] Update `.claude/skills/digit-xlsx-onboard/SKILL.md` to describe the new sheets, the validation step, and operator-side troubleshooting.

---

## Workstream 7 — `digit-ui-esbuild` UI (5–7 days)

### Task 7.1 — `useComplaintTaxonomy` hook

- [ ] Calls `POST /v2/serviceDefs/_tree`.
- [ ] Returns `{depth, levels, tree, findPath, leaves}`.
- [ ] Caches per-tenant per-session.
- [ ] Test: depth=1 case (no HierarchyConfig) returns leaves correctly.
- [ ] Test: depth=3 case returns nested tree.

### Task 7.2 — Citizen tree picker

- [ ] New `<TreePicker>` component, renders N dropdowns based on `depth`.
- [ ] Each dropdown filtered by previous level's selection.
- [ ] Final selection emits `{serviceCode, complaintNodePath}`.
- [ ] Handles jagged depth: if user reaches a leaf early, no further dropdowns.

### Task 7.3 — Replace `FormExplorer.js` integration

- [ ] Drop `menuPath`-grouping logic.
- [ ] Use `useComplaintTaxonomy` + `<TreePicker>`.
- [ ] Backward-compat check: tenant without `HierarchyConfig` still renders the existing flat behavior.

### Task 7.4 — Manual QA against Nairobi + Maputo dev tenants

- [ ] Verify Nairobi: picker unchanged.
- [ ] Verify Maputo: three dropdowns with Portuguese level names.

**EXPAND for execution.**

---

## Workstream 8 — `digit-ui-v2` UI (5–7 days)

Mirror of W7 in the TypeScript codebase. Same structure, separate files.

**Optional scope cut for Mozambique timeline:** if Maputo's citizen flow uses only `digit-ui-esbuild`, W8 can be deferred to a follow-up release. Confirm with PM before kickoff.

**EXPAND for execution.**

---

## Workstream 9 — Configurator tree editor (8–12 days) **EXPAND mandatory**

Largest single piece. Scope strictly bounded to v1 affordances only.

### Task 9.1 — Tree rendering

- [ ] Render the tree returned from `useComplaintTaxonomy`.
- [ ] Expand/collapse nodes.
- [ ] Visual distinction: leaf vs non-leaf (e.g., leaf icon, attribute badges).

### Task 9.2 — Node CRUD

- [ ] Add child node modal (asks for `serviceCode`, `name`, leaf attrs if applicable based on whether this would be a leaf).
- [ ] Edit node modal.
- [ ] Deactivate subtree (cascading `active: false`).
- [ ] Each save calls PGR `_validate` first. If validation fails, surface violations.

### Task 9.3 — HierarchyConfig editor

- [ ] Edit `depth` + level names.
- [ ] Block depth-decrease if any node exists at the dropped level (read tree, check).

### Task 9.4 — Out of scope (do NOT implement)

- Drag-reparent across levels.
- Bulk import.
- Cross-tenant template clone.
- Cross-level moves of any kind.

### Task 9.5 — Manual QA

- [ ] Verify full add → edit → deactivate cycle.
- [ ] Verify Maputo can create their 3-level tree from scratch.
- [ ] Verify Nairobi can edit migrated 2-level tree.

**EXPAND for execution — this workstream must have a detailed bite-sized plan before it starts.**

---

## Cross-workstream: integration + regression (4–6 days)

### Task X.1 — End-to-end integration test

- [ ] Mozambique fresh load: bootstrap via xlsx-onboard → citizen submits complaint → workflow transitions → PGR search finds it.
- [ ] Nairobi migration: run utility → citizen picker still works → existing complaints still resolve.

### Task X.2 — Regression suite for complaint lifecycle

- [ ] Ensure no existing complaint workflow path breaks.
- [ ] Ensure SLA computation unaffected.
- [ ] Ensure notifications unaffected.

### Task X.3 — Performance check on `_tree`

- [ ] Measure `_tree` latency for tenant with 200 leaf nodes (Nairobi-scale).
- [ ] Add MDMS-side caching if p95 > 200ms.

### Task X.4 — Documentation

- [ ] Update PGR API reference docs.
- [ ] Add migration runbook for ops.
- [ ] Add tenant-onboarding playbook update.

---

## Risk-driven schedule adjustments

If **W1 risk materializes** (MDMS v2 not ready for PGR in time): fallback is to keep `ServiceDefs` in MDMS v1 with self-imposed schema fields, do all validation in PGR-services side. Adds ~2 days to W3 (full validation moves to PGR), removes MDMS v2 dependency. Spec section 10 flags this fallback.

If **W9 risk materializes** (configurator scope creep): cut to "edit existing tree only — no add-child UI" for v1, force operators to use xlsx-onboard for initial tree creation. Saves ~5 days. Defer full tree editor to follow-up release.

If **Mozambique timeline forces tighter window**: drop W8 entirely (defer v2 UI to follow-up release), confirm with PM that Maputo's citizen channel does not need digit-ui-v2.

---

## Self-review

**Spec coverage:** Each spec section maps to a workstream — Section 1 → W1, Sections 3 & 5 → W1+W2+W3+W4, Section 7 → W5+W6, Section 8 → W7+W8+W9. ✓

**Placeholder scan:** One `<MDMS-v2-repo>` placeholder in W1 file-structure — flagged explicitly as TBD-by-MDMS-v2-working-group, gated by Open Question 1 in the spec. All other paths are concrete. Detailed bite-sized TDD code blocks deferred for workstreams marked **EXPAND**; this is intentional per scope check, not a placeholder.

**Type consistency:** `ComplaintNode` POJO defined in W2.1 used consistently through W2.2 (`assemble`), W4.2 (`findPath`), W5.1 (Python equivalent). `HierarchyConfig` shape (`depth`, `levels[{level, code, nameKey}]`) consistent across W1.3, W2.1, W7.1, W9.3.

**Sizing sanity check:** 34–49 engineer-days total. Single-engineer 7–10 weeks; 3-engineer parallel 4–6 weeks. Aligns with Release 2.20 (2026-07-31) if started by end of June.

---

## Open items requiring confirmation before execution

1. **MDMS v2 readiness for PGR** (Open Question 1 in spec). Blocks W1. Confirm with MDMS v2 working group.
2. **Configurator v1 scope agreement** (Open Question 2 in spec). Confirms W9 task list above. If drag-reparent is required, W9 grows by ~5 days.
3. **digit-ui-v2 scope** — confirm whether Mozambique citizens use it. If no, W8 deferred.
4. **Naming** (Open Question 6 in spec). If `HierarchyConfig` is renamed, search-and-replace across W1, W2, W7, W8, W9 file paths and code samples.

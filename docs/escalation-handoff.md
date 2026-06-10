# Escalation feature — handoff doc

> Canonical pickup guide. If you're inheriting this work cold, start here.
> Last updated: 2026-06-10. Owner at time of writing: @ChakshuGautam.

Linked artifacts:
- **Design doc**: [`docs/escalation-feature-design.md`](./escalation-feature-design.md) — full architecture, schemas, algorithm, UI specs
- **Roadmap doc**: [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md) — G1-G8 phases
- **Bomet operational notes**: [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
- **Design hub**: [Discussion #773](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773)
- **Foundation PR**: [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)

---

## 1. One-paragraph executive summary

The escalation feature makes the PGR auto-escalation chain operable, diagnosable, and testable on production deployments. Foundation PR [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770) (open, +10927/-135, ~75 files) ships an OTEL-instrumented `EscalationScheduler` with structured skip reasons, an admin `POST /escalation/_trigger` endpoint, three new MDMS schemas (`CRS.CategorySLA`, `CRS.StateSLA`, `CRS.SLAAuditLog`), a Configurator SLA Matrix page with trace-back + bulk import, an embedded workflow designer fork, and three Playwright integration specs. The code is **deployed and verified live on Bomet** (`bometfeedbackhub.digit.org`); the chain currently returns `NO_ASSIGNEES` for all complaints due to an upstream `egov-workflow-v2` ASSIGN-persistence bug — once that lands, escalation fires automatically. PR #770 is **OPEN and review-required**, sitting on a stale base (`develop@1e28bfb7`, ~12+ commits behind current). Six follow-up PRs (#775, #776, #794, #796, #797 stacked impl + docs + tests; #774 image pin) and eight G-phase design-only drafts (#777-#791) extend the foundation.

---

## 2. The stack at a glance

```
develop (egov, e8cba53f, current)
   │   (the 14 escalation PRs were branched from older develop tips —
   │    PR #770 on 1e28bfb7, follow-ups on cdd87a84; rebase needed before merge)
   │
   ├── PR #770  [OPEN]  feat/escalation-otel-configurator-designer
   │       │     Foundation. +10927/-135. backend+configurator+designer+tests+docs.
   │       │
   │       ├── PR #775  [OPEN]  refactor/scheduler-state-name-mdms
   │       │       │     Adds 4th schema CRS.WorkflowStateMapping; drops hardcoded PGR
   │       │       │     state-name switch in EscalationScheduler.
   │       │       │
   │       │       └── PR #797 [OPEN]  test/escalation-state-mapping-edge-cases
   │       │              JUnit + Vitest for STATE_MAPPING_MISSING cascade + CSV parser.
   │       │
   │       ├── PR #776  [OPEN]  docs/categorysla-wiring-strategies
   │       │       │     Strategy A (rich intake) vs Strategy B (ServiceDefs extension).
   │       │
   │       ├── PR #794  [OPEN]  docs/escalation-ops-gotchas-recipes
   │       │       │     7 gotchas with copy-pasteable bash fix + verification.
   │       │
   │       ├── PR #796  [OPEN]  docs/deploying-escalation-to-new-tenant
   │       │       │     Operator runbook: 4 schemas in correct seed order +
   │       │       │     verification checklist + 10-min tutorial + rollback.
   │       │
   │       └── PR #774  [OPEN]  fix/pgr-services-pin-crs-sla
   │              Pins pgr-services image to escalation-otel SHA.
   │
   └── G-phase drafts (design-only, paired with Discussions)
       ├── PR #789  [DRAFT]  G1 Category Taxonomy        ↔ Discussion #790
       ├── PR #783  [DRAFT]  G2 Path Routing Rules        ↔ Discussion #785
       ├── PR #791  [DRAFT]  G3 Entity Directory          ↔ Discussion #792
       ├── PR #786  [DRAFT]  G4 Role Permission Matrix    ↔ Discussion #788
       ├── PR #777  [DRAFT]  G5 Notification Templates    ↔ Discussion #778
       ├── PR #779  [DRAFT]  G6 Territorial Hierarchy     ↔ Discussion #781
       ├── PR #780  [DRAFT]  G7 Dashboard Configuration   ↔ Discussion #784
       └── PR #782  [DRAFT]  G8 Submission Form Customisation ↔ Discussion #787

Design hub: Discussion #773 (74k-char body, 0 comments).
```

**Status snapshot (2026-06-10):**
- 5 PRs ready-for-review on top of #770: #775, #776, #794, #796, #797
- 8 G-phase drafts: design-only scaffolds, paired Discussions for architectural feedback
- All 14 escalation PRs target `develop` but sit on stale tips
- Discussion #773 has received no external comments yet

---

## 3. What's live where

### Bomet (`10.0.0.2`, `bometfeedbackhub.digit.org`, tenant `ke.bomet`)

| Artifact | Version / value | URL / location | Verification command |
|---|---|---|---|
| `pgr-services` image | `10.0.0.4:5000/egovio/pgr-services-dev:escalation-otel-amd64-fallback-a43e4adfc` | private VPC registry | `ssh egov-bomet "docker inspect digit-pgr-services-1 --format '{{.Config.Image}}'"` |
| Configurator bundle | built from PR #770 head `673005c02` | `/var/www/configurator/` on egov-bomet | `ssh egov-bomet "ls -la /var/www/configurator/index.html"` |
| Workflow designer fork | built from `workflow-designer/` in PR #770 | `https://bometfeedbackhub.digit.org/designer/` | `curl -sI https://bometfeedbackhub.digit.org/designer/ \| head -1` |
| Configurator SLA Matrix page | live | `https://bometfeedbackhub.digit.org/configurator/#/crs/sla-matrix` | open in browser → matrix renders with category rows × state columns |
| MDMS schemas registered | 3 in PR #770 + 1 added by PR #775 | mdms-v2 module `CRS` | `curl -s -X POST 'https://bometfeedbackhub.digit.org/mdms-v2/schema/v1/_search' -H 'Content-Type: application/json' -d '{"RequestInfo":{},"SchemaDefCriteria":{"tenantId":"ke","codes":["CRS.CategorySLA","CRS.StateSLA","CRS.SLAAuditLog"]}}' \| jq '.SchemaDefinitions[].code'` |
| MDMS data rows (CategorySLA) | tenant-seeded; 0 by default | mdms-v2 module `CRS` | `curl -s -X POST 'https://bometfeedbackhub.digit.org/mdms-v2/v2/_search' -H 'Content-Type: application/json' -d '{"RequestInfo":{},"MdmsCriteria":{"tenantId":"ke.bomet","schemaCode":"CRS.CategorySLA"}}' \| jq '.mdms \| length'` |
| `/escalation/_trigger` smoke | HTTP 200, structured JSON | Kong → pgr-services | `curl -s -X POST 'https://bometfeedbackhub.digit.org/pgr-services/escalation/_trigger' -H 'Content-Type: application/json' -d '{"RequestInfo":{"authToken":"<admin-token>"},"tenantId":"ke.bomet"}' \| jq '.scanned, .escalated, .skipped, .skipBreakdown'` |
| OTEL spans in Tempo | `escalation.scanned/escalated/skipped/skipBreakdown.<reason>/tenantId/slaSource` | Tempo on egov-bomet | `ssh egov-bomet "curl -s 'http://localhost:13200/api/search?tags=service.name%3Dpgr-services%20span.name%3DEscalationScheduler.scanAndEscalate' \| jq '.traces[0:3]'"` |
| Structured skip-reason logs | streaming | digit-pgr-services-1 stdout | `ssh egov-bomet "docker logs --tail 50 digit-pgr-services-1 2>&1 \| grep 'Escalation skip'"` |
| Trace-back smoke (configurator UI) | live | `https://bometfeedbackhub.digit.org/configurator/#/crs/sla-matrix` → "Trace-back" button → enter SRID | drawer opens → 4 layers shown (CRS.CategorySLA → CRS.StateSLA → v0.EscalationConfig → final) |

**Expected current behaviour**: every scan returns `NO_ASSIGNEES` for every complaint → 0 escalations. This is correct given the upstream ASSIGN-persistence bug (see §9 issue 2). Once upstream fixes it, the chain fires unchanged.

### Nairobi (`10.0.0.5`, `naipepea.digit.org`, tenant `ke.nairobi`)

Not yet deployed. To deploy: see PR [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) deployment runbook. The image, schemas, and configurator bundle are all tenant-agnostic — same artifacts, different seed data.

---

## 4. The architecture in 5 minutes

**Five-bullet TL;DR:**

1. **Scheduler-driven** — `EscalationScheduler.scanAndEscalate` runs on cron (or manually via `POST /escalation/_trigger`); scans open PGR complaints; per complaint resolves an SLA and escalates to supervisor if breached.
2. **Three-layer SLA cascade** — `CRS.CategorySLA` (most specific) → `CRS.StateSLA` (singleton defaults) → `v0.EscalationConfig` (legacy `RAINMAKER-PGR.EscalationConfig` per-service-code overrides). First non-null wins. Layer that answered is recorded as `slaSource` OTEL attribute.
3. **Supporting layer: `CRS.WorkflowStateMapping`** (singleton `default`) — translates the complaint's `applicationStatus` (e.g. `PENDINGATLME`) into one of six canonical SLA-column keys (`new`, `triage`, `forwarded`, `investigation`, `awaiting`, `resolved`). Read once per scan, threaded into `resolveSlaHours`. *Not* an SLA source itself — purely a name translator.
4. **Skip is a first-class outcome** — `EscalationSkipReason` enum has 9 values (`MAX_DEPTH_REACHED`, `NO_LAST_MODIFIED_TIME`, `SLA_NOT_BREACHED`, `NO_ASSIGNEES`, `NO_SUPERVISOR_IN_HRMS`, `WORKFLOW_TRANSITION_FAILED`, `UNMAPPED_CATEGORY`, `STATE_MAPPING_MISSING`, `SUCCESS`). Each emitted as structured log + OTEL skip-breakdown counter. Operators read these to diagnose why escalation isn't firing.
5. **Configurator-driven, not code-driven** — operators edit SLAs in `CategorySlaMatrixPage` (a 2D grid of category rows × state columns), import via CSV, debug via `TraceBackDialog` (re-runs `resolveSlaHours` with full layer trace shown in a drawer). All four schemas are versioned in MDMS; no code redeploy needed to change SLAs.

**If you read nothing else, read this paragraph**: a complaint that breaches its SLA without progressing gets auto-assigned to the current assignee's supervisor (per HRMS `reportingTo`). The SLA value comes from a 3-layer MDMS cascade keyed on `(path, category, subcategoryL1, workflowState)`. State names get translated via a 4th MDMS layer. Skip reasons are logged + spanned, so when escalation doesn't fire you can tell exactly why. The configurator UI lets operators edit all of this through a matrix view + bulk CSV import, with a trace-back tool to debug a specific complaint's resolution. Full depth: [`docs/escalation-feature-design.md`](./escalation-feature-design.md).

---

## 5. Where each piece of code lives

### Backend (`backend/pgr-services/`)

| Concern | File | Role |
|---|---|---|
| Scheduler entry-point | `src/main/java/org/egov/pgr/service/EscalationScheduler.java` | `scanAndEscalate` — cron + manual trigger entry; orchestrates per-complaint resolution |
| Per-complaint escalation | `src/main/java/org/egov/pgr/service/EscalationService.java` | `escalateComplaint` — HRMS supervisor lookup + workflow transition + structured logging |
| Skip-reason enum | `src/main/java/org/egov/pgr/util/EscalationSkipReason.java` | 9 reasons; each emitted as log line + OTEL `skipBreakdown.<reason>` counter |
| Admin endpoint | `src/main/java/org/egov/pgr/web/controllers/EscalationController.java` | `POST /escalation/_trigger` — synchronous scheduler invocation for tests + configurator |
| SLA-source constants | `src/main/java/org/egov/pgr/util/PGRConstants.java` | `SLA_SOURCE_CATEGORY`, `SLA_SOURCE_STATE`, `SLA_SOURCE_V0` — used as `slaSource` OTEL attribute values |
| Manual-ESCALATE validator | `src/main/java/org/egov/pgr/validator/ServiceRequestValidator.java` | `ESCALATE_COMMENT_REQUIRED` — HTTP 400 if comment missing on manual ESCALATE |
| Backend unit tests | `src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java` | 6 cases covering layer cascade |
| Validator tests | `src/test/java/org/egov/pgr/validator/ServiceRequestValidatorTest.java` | 4 cases covering ESCALATE comment validation |

### MDMS schemas (`utilities/default-data-handler/src/main/resources/schema/`)

| Schema code | File | Role |
|---|---|---|
| `CRS.CategorySLA` | `CRS.json` (entry 1) | Per `(path, category, subcategoryL1)` row with per-state SLA map |
| `CRS.StateSLA` | `CRS.json` (entry 2) | Singleton (`singletonKey="default"`) — per-state default hours |
| `CRS.SLAAuditLog` | `CRS.json` (entry 3) | Append-only audit of CategorySLA edits |
| `CRS.WorkflowStateMapping` | *added by PR [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775)* | Singleton — translates `applicationStatus` → SLA column key |

### Configurator (`configurator/src/`)

| Concern | File | Role |
|---|---|---|
| Routing + nav | `App.tsx`, `admin/DigitLayout.tsx` | SLA Matrix + Escalation Config routes |
| SLA Matrix page | `resources/crs/sla-matrix/CategorySlaMatrixPage.tsx` | Main 2D grid editor (category rows × state columns) |
| Trace-back drawer | `resources/crs/sla-matrix/TraceBackDialog.tsx` | Re-runs `resolveSlaHours` for a specific complaint, shows 4-layer trace |
| Bulk import | `resources/crs/sla-matrix/BulkImportDialog.tsx` | CSV upload — uses csvParser, validates, batches MDMS upserts |
| CSV parser | `resources/crs/sla-matrix/csvParser.ts` | Header → tuple-+-cell mapping; range-cell collapse to MAX |
| SLA service layer | `resources/crs/sla-matrix/slaService.ts` | MDMS-v2 search/create/update wrappers |
| Types | `resources/crs/sla-matrix/types.ts` | TypeScript view of CRS.CategorySLA / StateSLA / SLAAuditLog |
| v0 EscalationConfig editor | `admin/themeEditor/EscalationConfigEditor.tsx` | Legacy v0 schema editor (kept for fallback tenants) |
| Per-level SLA widget | `components/widgets/SlaByLevelInput.tsx` | hh:mm:ss ↔ ms conversion |
| Per-service-code overrides | `components/widgets/ServiceOverridesEditor.tsx` | Matrix editor for v0 schema |
| Designation tree side panel | `components/widgets/DesignationTreePanel.tsx` | Read-only HRMS tree (who escalation hits) |
| Workflow Action select | `admin/WorkflowActionSelect.tsx` | Per-state action picker; respects ESCALATE comment-required |
| Schema descriptors | `admin/schemaDescriptors/escalation-config.ts`, `auto-escalation-ignore.ts`, `index.ts` | Maps MDMS schemas to UI editor configs |
| Docs pane | `components/layout/DocsPane.tsx` | Inline help panel showing relevant design-doc anchors |
| i18n strings | `providers/i18nProvider.ts` | Locale keys for matrix + drawer |
| Seed/recovery scripts | `resources/crs/sla-matrix/_seed/fix-xref-schema.sql`, `example.csv` | Reset cross-ref schema; example CSV row |

### Workflow designer (`workflow-designer/`)

| File | Role |
|---|---|
| `src/` | Fork of `workflow.egov.theflywheel.in/designer/` prototype, refactored to ES modules |
| `build.mjs` | esbuild build script (replaces Babel-in-browser) |
| `tests/` | Designer-internal tests |

PostMessage bridge: `designer-ready` / `load-workflow` / `save-workflow`. Embedded in configurator's `WorkflowServiceShow` page via the "Visual" tab.

### Integration + smoke tests (`tests/`)

| File | Role |
|---|---|
| `integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts` | API-level + OTEL — asserts span attributes in Tempo |
| `integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts` | Validates 400 vs 200 on manual ESCALATE |
| `integration-tests/tests/admin/escalation-configurator-bomet.spec.ts` | UI drive-it-save-it |
| `integration-tests/tests/lifecycle/pgr-sla-auto-escalate.spec.ts` | End-to-end auto-escalation lifecycle |
| `integration-tests/tests/lifecycle/pgr-escalation-api.spec.ts` | API-only escalation lifecycle |
| `integration-tests/tests/admin/workflow-action-select-521.spec.ts` | Action select UI |
| `integration-tests/tests/employee/escalate-action-521.spec.ts` | Employee manual-escalate flow |
| `playwright/tests/smoke-issue-521-escalate-button.spec.ts` | Button-visible smoke |
| `playwright/tests/demo-521-escalate-bomet.spec.ts` | Bomet demo path |
| `integration-tests/tests/utils/tempo.ts` | Helper: query Tempo for spans by trace ID + filter attributes |

### Configurator e2e (`configurator/e2e/`)

| File | Role |
|---|---|
| `crs-sla-matrix.spec.ts` | SLA Matrix page e2e — render, edit, save, trace-back, import |

---

## 6. How to test

Five layers (matches §"Testing strategy" in [`docs/escalation-feature-design.md`](./escalation-feature-design.md#testing-strategy)).

### Layer 1 — Backend unit tests
- **What**: `EscalationSchedulerSlaResolutionTest` (6 cases on layer cascade) + `ServiceRequestValidatorTest` (4 cases on ESCALATE comment validator) + existing tests.
- **Run**: `cd backend/pgr-services && mvn test`
- **Expected**: 20/20 pass.
- **Edge cases follow-up**: PR [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797) adds 7 more JUnit cases for `STATE_MAPPING_MISSING` cascade.

### Layer 2 — MDMS shape validation
- **What**: Schema validation against the 4 registered schemas. Catches regressions like a bad slaHoursByState `oneOf` (see §9 issue 5).
- **Run**: `curl -X POST '<mdms-v2>/schema/v1/_validate' ...` (see design doc §"Layer 2").
- **Expected**: every schema validates clean; data rows validate or surface a specific path-error.

### Layer 3 — Configurator e2e (Playwright)
- **What**: `configurator/e2e/crs-sla-matrix.spec.ts` — render, edit, save, trace-back, CSV import.
- **Run**: `cd configurator && npx playwright test e2e/crs-sla-matrix.spec.ts`
- **Expected**: all green; trace-back drawer shows 4-layer cascade; import handles range cells.
- **Edge cases follow-up**: PR [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797) adds Vitest cases for CSV parser (range-cell MAX collapse, partial cascade fallbacks).

### Layer 4 — Integration tests (live against Bomet)
- **What**: three new specs in `tests/integration-tests/`:
  - `lifecycle/pgr-escalation-trigger-bomet.spec.ts` — API+OTEL, asserts Tempo attributes
  - `lifecycle/pgr-manual-escalate-comment.spec.ts` — 400 vs 200 on manual ESCALATE
  - `admin/escalation-configurator-bomet.spec.ts` — UI drive-it-save-it
- **Run**: `cd tests/integration-tests && BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet npx playwright test tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts tests/lifecycle/pgr-manual-escalate-comment.spec.ts tests/admin/escalation-configurator-bomet.spec.ts`
- **Expected**: trigger spec correctly identifies `NO_ASSIGNEES` (the upstream workflow bug); comment spec confirms 400 vs 200 paths; configurator spec exercises full UI.

### Layer 5 — Live trace-back (operator runbook)
- **What**: Production debugging of a specific complaint's SLA resolution.
- **Run**: open `https://bometfeedbackhub.digit.org/configurator/#/crs/sla-matrix` → "Trace-back" → paste SRID → inspect drawer.
- **Expected**: 4-layer cascade with the layer that answered highlighted; final SLA in ms; elapsed time and breach flag visible.

---

## 7. How to deploy to a new tenant

**Two paragraphs + link to PR [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) for the full runbook.**

Deployment is image + 4 MDMS schemas + 4 seed rows + nginx routing. The pgr-services image (`escalation-otel-amd64-fallback-<sha>`) is tenant-agnostic; pull it from the VPC registry (`10.0.0.4:5000`) into the target server's compose. The configurator bundle is built once and rsynced to `/var/www/configurator/` on every tenant — also tenant-agnostic. The four MDMS schemas (`CRS.WorkflowStateMapping`, `CRS.StateSLA`, `CRS.CategorySLA`, `CRS.SLAAuditLog`) must be registered **in this exact order** because StateSLA + CategorySLA both consume the state-name vocabulary that WorkflowStateMapping defines. Each tenant then seeds its own data: one WorkflowStateMapping row (operator-defined state→column map), one StateSLA row (per-state defaults), N CategorySLA rows (one per `(path, category, subcategoryL1)` tuple), and zero or more v0 EscalationConfig rows (legacy fallback).

After seeding, verify with the three smoke commands in §3: `/escalation/_trigger` returns HTTP 200 with a non-zero `scanned` count, OTEL spans appear in Tempo with `slaSource` set to one of the 3 layers, and the configurator SLA Matrix page renders the seeded rows. Common pitfalls (full list in PR #794): the x-ref-schema regression after MDMS recreate (`fix-xref-schema.sql` recovery), persister-async means a 202 response doesn't mean the row is queryable yet (`time.sleep(3)` between schema register + data create), and the mdms-v2 `oneOf` validator quirk on `slaHoursByState` (see §9 issue 5). Full operator-facing runbook: [PR #796 — `docs/deploying-escalation-to-new-tenant.md`](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796).

---

## 8. How to extend / what to build next

G-phase roadmap (`docs/crs-configurator-roadmap.md`). Each phase has a draft PR + paired Discussion. Order by dependency:

| Phase | Purpose | Draft PR | Discussion |
|---|---|---|---|
| **G1** | Category Taxonomy editor — replaces free-text category/subcategoryL1 with a constrained picker | [#789](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/789) | [#790](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/790) |
| **G2** | Path Routing Rules — `(category, subcategoryL1) → path` editable rules; replaces `UNMAPPED_CATEGORY` silent fallback | [#783](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/783) | [#785](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/785) |
| **G3** | Entity Directory — generic HRMS-adjacent directory for non-employee actors | [#791](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/791) | [#792](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/792) |
| **G4** | Role Permission Matrix editor — generic `CRS.ConfigAuditLog` supersedes escalation-specific `CRS.SLAAuditLog` | [#786](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/786) | [#788](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/788) |
| **G5** | Notification Templates — per-state SMS/email templates with variable substitution | [#777](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/777) | [#778](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/778) |
| **G6** | Territorial Hierarchy editor — 4-level boundary (Region → District → Sub-district → Locality) | [#779](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/779) | [#781](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/781) |
| **G7** | Dashboard Configuration — per-tenant dashboards (indicators, formulas, threshold alerts) | [#780](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/780) | [#784](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/784) |
| **G8** | Submission Form Customisation — per-tenant intake form editor; **enables Strategy A** wiring for CategorySLA | [#782](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/782) | [#787](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/787) |

**Recommended starting point**: **G1 (Category Taxonomy)** is the lowest-risk highest-value follow-on — it unblocks G2 (which depends on a constrained category vocab) and incidentally absorbs the open `CRS.WorkflowStateMapping` configurator-UI gap (§9 issue 4). After G1, build G8 if the target deployment wants Strategy A wiring, otherwise G2.

---

## 9. Known issues + outstanding work

1. **CSV parser case bug** *(minor)* — `configurator/src/resources/crs/sla-matrix/csvParser.ts` lowercases the CSV header then compares to the camelCase literal `'subcategoryL1'`. Result: header `SubcategoryL1` works, `subcategoryl1` (lowercased) doesn't match the literal. Tracked: task #66 in the team task list; no PR yet. Fix is a one-liner.
2. **Upstream `egov-workflow-v2` ASSIGN-assignee persistence bug** *(blocker for downstream auto-escalation)* — workflow service silently drops `assignees` on the `ASSIGN` action; `eg_wf_assignee_v2` table stays empty. As a result the scheduler returns `NO_ASSIGNEES` for every complaint on Bomet. Tracked: noted in PR #770 body, design doc §"Assignee-persistence upstream bug", and Discussion #773. To be raised against upstream `egov-workflow-v2` repo separately. No tracking issue yet.
3. **mdms-v2 `oneOf` validator quirk on `slaHoursByState`** *(minor, upstream)* — the validator rejects `slaHoursByState` cells when shape is declared with `oneOf`. Workaround documented in design doc §"`egov-mdms-v2` validator and `oneOf` on `slaHoursByState`". Upstream `egov-mdms` fix needed. No tracking issue.
4. **`mapWorkflowStateToKey` has no configurator UI** *(minor)* — `CRS.WorkflowStateMapping` is editable only via curl / Python today. Operators write the MDMS singleton row directly. Tracked: design doc open-question #1; will be absorbed by G1 (Category Taxonomy editor) — see [PR #789](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/789) — or a small standalone editor lands later.
5. **PR #770 + stack are on stale base** *(merge-blocker, not severity)* — `develop` has moved ~12+ commits since the stack was opened (PR #770 on `1e28bfb7`, follow-ups on `cdd87a84`, current `develop` at `e8cba53f`). Rebase needed before merge. No tracking issue.
6. **v0 EscalationConfig deletion (post-migration)** *(deferred)* — once all tenants migrate to CategorySLA + StateSLA, the legacy `RAINMAKER-PGR.EscalationConfig` schema + scheduler-side fallback can be removed. Tracked: design doc open-question #7. No PR yet.
7. **PR #774** is in the escalation-related set but was not in the originally listed 13-PR stack — flagged for review. It pins pgr-services image to an escalation-otel SHA. Probably intentional but worth confirming inclusion in the merge plan.

---

## 10. Open architectural questions

Lifted from Discussion #773's "Open questions and deferred work" table (design doc §"Open questions"). Each: question + tracking.

| # | Question | Tracking |
|---|---|---|
| 1 | No configurator UI for editing `CRS.WorkflowStateMapping` singleton — operators write MDMS row directly. Should G1 absorb this, or ship a small standalone editor? | Roadmap **G1** ([PR #789](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/789) / Discussion [#790](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/790)) |
| 2 | Upstream DIGIT workflow ASSIGN-assignee persistence bug — blocks end-to-end escalation testing on Bomet. When does upstream land a fix? | Upstream `egov-workflow-v2`, to be raised separately |
| 3 | Category Taxonomy editor (constrained picker) — replaces free-text category/subcategoryL1 in SLA Matrix. Acceptable to ship with free-text until G1 lands? | Roadmap **G1** ([PR #789](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/789) / Discussion [#790](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/790)) |
| 4 | Path Routing Rules — `(category, subcategoryL1) → path` editable rules. Currently relies on Strategy A intake or fails silently. | Roadmap **G2** ([PR #783](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/783) / Discussion [#785](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/785)) |
| 5 | Submission Form Customisation — required for Strategy A wiring of new tenants. Should this block new-tenant rollout? | Roadmap **G8** ([PR #782](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/782) / Discussion [#787](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/787)) |
| 6 | Generic `CRS.ConfigAuditLog` supersedes escalation-specific `CRS.SLAAuditLog`. Migrate existing SLAAuditLog rows or keep both? | Roadmap **G4** ([PR #786](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/786) / Discussion [#788](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/788)) |
| 7 | v0 EscalationConfig deletion (post-migration) — when is "all tenants migrated" declared? | Follow-up PR, no task yet |
| 8 | mdms-v2 `oneOf` validator fix — would allow declarative `slaHoursByState` cell-shape validation. Upstream fix or downstream workaround? | Upstream, no task |

---

## 11. Common operations cookbook

- **Register a new tenant for escalation** — see [PR #796 runbook](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796): register 4 schemas in order (WorkflowStateMapping → StateSLA → CategorySLA → SLAAuditLog), seed singletons, optional v0 fallback rows. Verify via `/escalation/_trigger` + Tempo span check.
- **Recover from x-ref-schema regression** — run `configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql` against the mdms-v2 Postgres. Symptom: cross-reference validation errors after a schema recreate. Full recipe in PR [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794).
- **Rebuild pgr-services after a code change** — `cd backend/pgr-services && mvn clean package -DskipTests && docker build -t 10.0.0.4:5000/egovio/pgr-services-dev:<tag> . && docker push 10.0.0.4:5000/egovio/pgr-services-dev:<tag>`, then update the target server's compose to pin the new tag and `docker compose up -d pgr-services`.
- **Redeploy configurator** — `cd configurator && npm run build`, then `cd local-setup/ansible && ./deploy.sh <tenant>` (the playbook rsyncs `dist/` to `/var/www/configurator/`).
- **Take a debug screenshot of the SLA Matrix** — `cd tests/integration-tests && BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet npx playwright test tests/admin/escalation-configurator-bomet.spec.ts --headed` — the spec already calls `page.screenshot()` on the matrix page.
- **Query a complaint's SLA-resolution path via /escalation/_trigger** — `curl -s -X POST 'https://bometfeedbackhub.digit.org/pgr-services/escalation/_trigger' -H 'Content-Type: application/json' -d '{"RequestInfo":{"authToken":"<admin-token>"},"tenantId":"ke.bomet","serviceRequestIds":["<SRID>"]}' | jq '.details[]'`. The response's `details[]` includes `slaSource`, `slaMs`, `elapsedMs`, `skipReason`, `workflowState`, `stateKey`.
- **Inspect OTEL spans for a recent scan** — `ssh egov-bomet "curl -s 'http://localhost:13200/api/search?tags=service.name%3Dpgr-services%20span.name%3DEscalationScheduler.scanAndEscalate' | jq '.traces[0]'"`. Span attributes include `escalation.scanned`, `escalation.escalated`, `escalation.skipped`, `escalation.skipBreakdown.<reason>`, `tenantId`.
- **Force a rescan now (instead of waiting for cron)** — `POST /escalation/_trigger` with empty body — synchronous, returns full structured result.
- **Update a CategorySLA cell without the UI** — POST to mdms-v2 `/v2/_update` with the row's full JSON (use `slaService.ts` as the canonical request shape).
- **Switch tenant to Strategy A vs B for wiring** — see PR [#776 strategy doc](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/776) for the decision tree + migration paths.

---

## 12. Quick reference: acronyms + URLs

### Acronyms (from design doc terminology cheatsheet)

| Term | Meaning |
|---|---|
| **CRS** | Citizen Complaint Resolution System. Also the MDMS module prefix (`CRS.*`) for escalation schemas. |
| **PGR** | Public Grievance Redressal — DIGIT-upstream complaint module. CCRS extends PGR. |
| **MDMS** | Master Data Management Service. v1 = search API (scheduler); v2 = create/update API (configurator). |
| **SLA** | Service Level Agreement. Hours (config-side) or ms (scheduler-side). |
| **CategorySLA** | Row in `CRS.CategorySLA` keyed on `(path, category, subcategoryL1)` with per-state SLA map. |
| **StateSLA** | Singleton `CRS.StateSLA` row — per-state default SLA hours. |
| **WorkflowStateMapping** | Singleton `CRS.WorkflowStateMapping` — translates `applicationStatus` → SLA column key. |
| **v0 EscalationConfig** | Legacy `RAINMAKER-PGR.EscalationConfig` schema (per-level SLAs + per-serviceCode overrides). Kept as fallback. |
| **slaSource** | OTEL span attribute: `CRS.CategorySLA` / `CRS.StateSLA` / `v0.EscalationConfig`. Which layer answered. |
| **skipReason** | One of 9 `EscalationSkipReason` values. Emitted as log + OTEL counter. |
| **Tuple** | `(path, category, subcategoryL1)` — join key of CategorySLA. |
| **Strategy A / B** | Two wirings: A = rich intake (tuple on `additionalDetail`); B = ServiceDefs extension (`serviceCode → tuple` map). |
| **OTEL** | OpenTelemetry. CCRS uses agent + Tempo backend at `localhost:13200`. |
| **HRMS** | Human Resource Management System — upstream DIGIT module. Source of `reportingTo` chain. |

### URLs + identifiers

| Resource | URL / location |
|---|---|
| Foundation PR | https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770 |
| Design hub Discussion | https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773 |
| Bomet UI | https://bometfeedbackhub.digit.org/digit-ui/ |
| Bomet configurator | https://bometfeedbackhub.digit.org/configurator/ |
| Bomet SLA Matrix | https://bometfeedbackhub.digit.org/configurator/#/crs/sla-matrix |
| Bomet workflow designer | https://bometfeedbackhub.digit.org/designer/ |
| Bomet pgr-services API | https://bometfeedbackhub.digit.org/pgr-services/ |
| VPC Docker registry | http://10.0.0.4:5000/v2/_catalog |
| Repo (upstream) | https://github.com/egovernments/Citizen-Complaint-Resolution-System |
| Repo (fork) | https://github.com/ChakshuGautam/Citizen-Complaint-Resolution-System |
| Design doc | `docs/escalation-feature-design.md` |
| Roadmap doc | `docs/crs-configurator-roadmap.md` |
| Bomet ops notes | `docs/escalation-feature-bomet.md` |
| Backend scheduler | `backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java` |
| MDMS schemas | `utilities/default-data-handler/src/main/resources/schema/CRS.json` |
| SLA Matrix page | `configurator/src/resources/crs/sla-matrix/CategorySlaMatrixPage.tsx` |
| Stack PRs | #770 (foundation), #774, #775, #776, #794, #796, #797 |
| G-phase drafts | #777 (G5), #779 (G6), #780 (G7), #782 (G8), #783 (G2), #786 (G4), #789 (G1), #791 (G3) |
| G-phase Discussions | #778 (G5), #781 (G6), #784 (G7), #787 (G8), #785 (G2), #788 (G4), #790 (G1), #792 (G3) |

---

## 13. Where to ask for help

- **Architecture / design questions** → comment on [Discussion #773](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773). It's the single design hub for the whole feature.
- **Code review / merge questions on the foundation** → comment on [PR #770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770).
- **Code review on a specific follow-up** → comment on the PR directly: [#774](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/774), [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775), [#776](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/776), [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794), [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796), [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797).
- **Future-phase architectural feedback (G1-G8)** → comment on the paired Discussion for the phase you care about (see §8 table).
- **Upstream `egov-workflow-v2` ASSIGN-assignee bug** → raise against [`egovernments/egov-workflow-v2`](https://github.com/egovernments/egov-workflow-v2) (not yet filed at time of writing).
- **Upstream `egov-mdms` `oneOf` validator bug** → raise against the `egov-mdms` (mdms-v2) repo. Not yet filed.
- **Operator / deployment questions for Bomet** → read [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md) first, then PR [#794 ops gotchas](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794) for symptoms + fixes, then PR [#796 deployment runbook](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) for new-tenant onboarding.

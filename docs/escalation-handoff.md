# Escalation feature — handoff doc

> Canonical pickup guide. If you're inheriting this work cold, start here.
> Last updated: 2026-06-10. Owner at time of writing: @ChakshuGautam.

> **Warning**: §3–§4 describe the INTENDED state; live Bomet currently diverges — read §14 (the drift dossier) before trusting any live-state claim in this doc.

Linked artifacts:
- **Design doc**: [`docs/escalation-feature-design.md`](./escalation-feature-design.md) — full architecture, schemas, algorithm, UI specs
- **Roadmap doc**: [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md) — G1-G8 phases
- **Bomet operational notes**: [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
- **Design hub**: [Discussion #773](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773)
- **Foundation PR**: [#770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
- **Requirements PDFs** (NOT committed to the public repo — they live at `/escalation/` on the dev server):
  - CMS Escalation PRD, Draft v3.0, April 2026 — `/escalation/CMS_Escalation_PRD-latest.pdf`
  - Mozambique BRD "Complaints and Reports Portal", v4.0, June 2026 — `/escalation/BRD_ Plataforma de Reclamacoes e Denuncias V4.0 ENG.docx.pdf`

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
   │       │       ├── PR #797 [OPEN]  test/escalation-state-mapping-edge-cases
   │       │       │      JUnit + Vitest for STATE_MAPPING_MISSING cascade + CSV parser.
   │       │       │
   │       │       └── feat/escalation-prd-alignment — PRD alignment: EscalationPolicy
   │       │              schema, level SLAs, dryRun, pre-breach detection, enriched
   │       │              audit comment, csvParser fix ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815))
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
- `feat/escalation-prd-alignment` — PRD alignment: EscalationPolicy schema, level SLAs, dryRun, pre-breach detection, enriched audit comment, csvParser fix ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815); stacked on #775)
- 8 G-phase drafts: design-only scaffolds, paired Discussions for architectural feedback
- All 14 escalation PRs target `develop` but sit on stale tips
- Discussion #773 has received no external comments yet

---

## 3. What's live where

### Bomet (`10.0.0.2`, `bometfeedbackhub.digit.org`, tenant `ke.bomet`)

| Artifact | Version / value | URL / location | Verification command |
|---|---|---|---|
| `pgr-services` image | `registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-prd-1d2e95262` (built from [PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) head, deployed 2026-06-10) | VPC registry (`10.0.0.4:5000`, same store) | `ssh egov-bomet "docker inspect digit-pgr-services-1 --format '{{.Config.Image}}'"` |
| Configurator bundle | built from PR #770 head `673005c02` | `/var/www/configurator/` on egov-bomet | `ssh egov-bomet "ls -la /var/www/configurator/index.html"` |
| Workflow designer fork | built from `workflow-designer/` in PR #770 | `https://bometfeedbackhub.digit.org/designer/` | `curl -sI https://bometfeedbackhub.digit.org/designer/ \| head -1` |
| Configurator SLA Matrix page | live | `https://bometfeedbackhub.digit.org/configurator/#/crs/sla-matrix` | open in browser → matrix renders with category rows × state columns |
| MDMS schemas registered | all 6 (CategorySLA, StateSLA, SLAAuditLog, WorkflowStateMapping, EscalationPolicy + RoleSupervisors registered 2026-06-11; EscalationPolicy SQL-patched with `roleEscalation`) | mdms-v2 module `CRS` | `curl -s -X POST 'https://bometfeedbackhub.digit.org/mdms-v2/schema/v1/_search' -H 'Content-Type: application/json' -d '{"RequestInfo":{},"SchemaDefCriteria":{"tenantId":"ke","codes":["CRS.CategorySLA","CRS.StateSLA","CRS.SLAAuditLog"]}}' \| jq '.SchemaDefinitions[].code'` |
| MDMS data rows (CategorySLA) | tenant-seeded; 0 by default | mdms-v2 module `CRS` | `curl -s -X POST 'https://bometfeedbackhub.digit.org/mdms-v2/v2/_search' -H 'Content-Type: application/json' -d '{"RequestInfo":{},"MdmsCriteria":{"tenantId":"ke.bomet","schemaCode":"CRS.CategorySLA"}}' \| jq '.mdms \| length'` |
| `/escalation/_trigger` smoke | HTTP 200, structured JSON | Kong → pgr-services | `curl -s -X POST 'https://bometfeedbackhub.digit.org/pgr-services/escalation/_trigger' -H 'Content-Type: application/json' -d '{"RequestInfo":{"authToken":"<admin-token>"},"tenantId":"ke.bomet"}' \| jq '.scanned, .escalated, .skipped, .skipBreakdown'` |
| OTEL spans in Tempo | `escalation.scanned/escalated/skipped/skipBreakdown.<reason>/tenantId/slaSource` | Tempo on egov-bomet | `ssh egov-bomet "curl -s 'http://localhost:13200/api/search?tags=service.name%3Dpgr-services%20span.name%3DEscalationScheduler.scanAndEscalate' \| jq '.traces[0:3]'"` |
| Structured skip-reason logs | streaming | digit-pgr-services-1 stdout | `ssh egov-bomet "docker logs --tail 50 digit-pgr-services-1 2>&1 \| grep 'Escalation skip'"` |
| Trace-back smoke (configurator UI) | live | `https://bometfeedbackhub.digit.org/configurator/#/crs/sla-matrix` → "Trace-back" button → enter SRID | drawer opens → three panes render: scheduler verdict (action/reason/detail), complaint summary, resolved SLA (source + value from the 5-source cascade) |

**Expected current behaviour**: every scan returns `NO_ASSIGNEES` for every complaint → 0 escalations. This is correct given the upstream ASSIGN-persistence bug (see §9 issue 2). Once upstream fixes it, the chain fires unchanged.

### Nairobi (`10.0.0.5`, `naipepea.digit.org`, tenant `ke.nairobi`)

Not yet deployed. To deploy: see PR [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) deployment runbook. The image, schemas, and configurator bundle are all tenant-agnostic — same artifacts, different seed data.

---

## 4. The architecture in 5 minutes

**Five-bullet TL;DR:**

1. **Scheduler-driven** — `EscalationScheduler.scanAndEscalate` is the cron wrapper; the manual `POST /escalation/_trigger` path calls `scanAndEscalateOnce` directly (and, from `feat/escalation-prd-alignment`, accepts `dryRun: true` — full decision path, zero mutations, breached complaints reported as `WOULD_ESCALATE`); scans open PGR complaints; per complaint resolves an SLA and escalates to supervisor if breached.
2. **SLA cascade — five sources** — the #770 baseline is three layers: `CRS.CategorySLA` (most specific) → `CRS.StateSLA` (singleton defaults) → `v0.EscalationConfig` (legacy `RAINMAKER-PGR.EscalationConfig` per-service-code overrides). First non-null wins. The source that answered is recorded as the `slaSource` OTEL attribute. From `feat/escalation-prd-alignment` two per-level steps join the cascade, making it five: `CategorySLA.slaHoursByLevel[level]` beats the per-state cell, and `EscalationPolicy.defaultSlaHoursByLevel[level]` slots between CategorySLA and StateSLA.
3. **Supporting layer: `CRS.WorkflowStateMapping`** (singleton `default`) — translates the complaint's `applicationStatus` (e.g. `PENDINGATLME`) into one of six canonical SLA-column keys (`new`, `triage`, `forwarded`, `investigation`, `awaiting`, `resolved`). Read once per scan, threaded into `resolveSlaHours`. *Not* an SLA source itself — purely a name translator.
4. **Skip is a first-class outcome** — `EscalationSkipReason` enum has 12 values on `feat/escalation-prd-alignment` (PR #770 ships 8; #775 adds `STATE_MAPPING_MISSING`; role escalation adds `ROLE_NOT_MAPPED`, `ROLE_SUPERVISOR_AMBIGUOUS`, `NO_ROLE_SUPERVISOR`): `MAX_DEPTH_REACHED`, `NO_LAST_MODIFIED_TIME`, `SLA_NOT_BREACHED`, `NO_ASSIGNEES`, `NO_SUPERVISOR_IN_HRMS`, `WORKFLOW_TRANSITION_FAILED`, `UNMAPPED_CATEGORY`, `STATE_MAPPING_MISSING`, the three role reasons, and `SUCCESS`. Each emitted as structured log + OTEL skip-breakdown counter. Operators read these to diagnose why escalation isn't firing.
5. **Configurator-driven, not code-driven** — operators edit SLAs in `CategorySlaMatrixPage` (a 2D grid of category rows × state columns), import via CSV, debug via `TraceBackDialog` (re-runs `resolveSlaHours` with full layer trace shown in a drawer). All five schemas (four before `feat/escalation-prd-alignment` adds `CRS.EscalationPolicy`) are versioned in MDMS; no code redeploy needed to change SLAs.

**If you read nothing else, read this paragraph**: a complaint that breaches its SLA without progressing gets auto-assigned to the current assignee's supervisor (per HRMS `reportingTo`). The SLA value comes from a five-source MDMS cascade (three state-indexed layers from #770 plus two per-level steps from `feat/escalation-prd-alignment`) keyed on `(path, category, subcategoryL1, workflowState)` and the escalation level. State names get translated via a supporting MDMS dictionary (`CRS.WorkflowStateMapping`). Skip reasons are logged + spanned, so when escalation doesn't fire you can tell exactly why. The configurator UI lets operators edit all of this through a matrix view + bulk CSV import, with a trace-back tool to debug a specific complaint's resolution. Full depth: [`docs/escalation-feature-design.md`](./escalation-feature-design.md).

---

## 5. Where each piece of code lives

### Backend (`backend/pgr-services/`)

| Concern | File | Role |
|---|---|---|
| Scheduler entry-point | `src/main/java/org/egov/pgr/service/EscalationScheduler.java` | `scanAndEscalate` — cron + manual trigger entry; orchestrates per-complaint resolution |
| Per-complaint escalation | `src/main/java/org/egov/pgr/service/EscalationService.java` | `escalateComplaint` — HRMS supervisor lookup + workflow transition + structured logging |
| Skip-reason enum | `src/main/java/org/egov/pgr/util/EscalationSkipReason.java` | 9 reasons; each emitted as log line + OTEL `skipBreakdown.<reason>` counter |
| Admin endpoint | `src/main/java/org/egov/pgr/web/controllers/EscalationController.java` | `POST /escalation/_trigger` — synchronous scheduler invocation for tests + configurator |
| SLA-source constants | `src/main/java/org/egov/pgr/util/PGRConstants.java` | `SLA_SOURCE_CATEGORY_LEVEL`, `SLA_SOURCE_CATEGORY`, `SLA_SOURCE_POLICY_LEVEL`, `SLA_SOURCE_STATE`, `SLA_SOURCE_V0` — the five `slaSource` OTEL attribute values |
| Manual-ESCALATE validator | `src/main/java/org/egov/pgr/validator/ServiceRequestValidator.java` | `ESCALATE_COMMENT_REQUIRED` — HTTP 400 if comment missing on manual ESCALATE |
| Backend unit tests | `src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java` | 4 cases covering layer cascade; 8 on `feat/escalation-prd-alignment` (adds per-level precedence cases) |
| Pre-breach unit tests | `src/test/java/org/egov/pgr/service/EscalationSchedulerPreBreachTest.java` | 5 cases on the `shouldEmitPreBreach` threshold-crossing function — *added by `feat/escalation-prd-alignment`* |
| Validator tests | `src/test/java/org/egov/pgr/validator/ServiceRequestValidatorTest.java` | 14 cases, 4 escalate-specific; 15/5 on `feat/escalation-prd-alignment` (adds `escalateCommentRequired=false` policy case) |

### MDMS schemas (`utilities/default-data-handler/src/main/resources/schema/`)

| Schema code | File | Role |
|---|---|---|
| `CRS.CategorySLA` | `CRS.json` (entry 1) | Per `(path, category, subcategoryL1)` row with per-state SLA map |
| `CRS.StateSLA` | `CRS.json` (entry 2) | Singleton (`singletonKey="default"`) — per-state default hours |
| `CRS.SLAAuditLog` | `CRS.json` (entry 3) | Append-only audit of CategorySLA edits |
| `CRS.WorkflowStateMapping` | `CRS.json` (entry 4) — *added by PR [#775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775)* | Singleton — translates `applicationStatus` → SLA column key |
| `CRS.EscalationPolicy` | `CRS.json` (entry 5) — *added by `feat/escalation-prd-alignment`* | Singleton — `maxDepth`, `defaultSlaHoursByLevel`, `preBreachWarning` config, `escalateCommentRequired` |

### Configurator (`configurator/src/`)

| Concern | File | Role |
|---|---|---|
| Routing + nav | `App.tsx`, `admin/DigitLayout.tsx` | SLA Matrix + Escalation Settings + Escalation Config routes (ESCALATION sidebar group) |
| SLA Matrix page | `resources/crs/sla-matrix/CategorySlaMatrixPage.tsx` | Main 2D grid editor (category rows × state columns); gains a **Levels** column for per-row `slaHoursByLevel` on `feat/escalation-prd-alignment` |
| Escalation Settings page | `resources/crs/escalation-settings/EscalationSettingsPage.tsx` | `/manage/escalation-settings` — four cards: SLA-source cascade overview (with the status-mapping gate row), escalation-behaviour policy form (`CRS.EscalationPolicy`), complaint-status-mapping editor (`CRS.WorkflowStateMapping`), and a dry-run test-scan card; reads/saves singletons at the **state** tenant with read-after-write verification — *added by `feat/escalation-prd-alignment`* |
| Client SLA resolver | `resources/crs/sla-matrix/resolveSlaPreview.ts` | Mirrors the backend `resolveSlaHours` five-step precedence client-side (range MAX collapse, level fall-through) for trace-back/cascade preview annotations; Vitest in `resolveSlaPreview.test.ts` — *added by `feat/escalation-prd-alignment`* |
| Built-in status mappings | `resources/crs/sla-matrix/standardStateMappings.ts` | Canonical 11-entry workflow-state → SLA-column table; imported by TraceBackDialog (its local `STATE_TO_KEY` copy deleted) and by the Settings page's "Add standard complaint statuses" merge — *added by `feat/escalation-prd-alignment`* |
| Level-SLA editor | `resources/crs/sla-matrix/LevelSlaEditor.tsx` | Shared per-level hours editor (Dialog body, `L0/L1/…` rows, add/remove-last, `0 < n ≤ 8760` validation); allows null holes for CategorySLA rows, rejects them in policy mode — *added by `feat/escalation-prd-alignment`* |
| Trace-back drawer | `resources/crs/sla-matrix/TraceBackDialog.tsx` | Dry-run `/_trigger` + complaint search for a specific SRID; renders scheduler-verdict / complaint panes + a six-row resolution path (gate + 5 sources) whose winner is highlighted from the server's `slaSource` response field, with client annotations labelled "estimated" on disagreement |
| Bulk import | `resources/crs/sla-matrix/BulkImportDialog.tsx` | CSV upload — uses csvParser, validates, batches MDMS upserts |
| CSV parser | `resources/crs/sla-matrix/csvParser.ts` | Header → tuple-+-cell mapping; range-cell collapse to MAX |
| CSV parser tests | `resources/crs/sla-matrix/csvParser.test.ts` | Vitest — header-case canonicalization, export→import round-trip, range cells, missing-column error — *added by `feat/escalation-prd-alignment`* |
| SLA service layer | `resources/crs/sla-matrix/slaService.ts` | MDMS-v2 search/create/update wrappers |
| Types | `resources/crs/sla-matrix/types.ts` | TypeScript view of CRS.CategorySLA / StateSLA / SLAAuditLog |
| Singleton types | `resources/crs/sla-matrix/escalationTypes.ts` | EscalationPolicy + WorkflowStateMapping record types (policy level array is `number[]` — no null holes; CategorySLA's is `(number\|null)[]`) — *added by `feat/escalation-prd-alignment`* |
| Level-value helpers | `resources/crs/sla-matrix/levelSlaValues.ts` | Parse/format/validate/normalize for level arrays (`formatLevelSummary`, `isLevelValuesEmpty`, bounds checks); Vitest in `levelSlaValues.test.ts` + `standardStateMappings.test.ts` — *added by `feat/escalation-prd-alignment`* |
| Settings page cards | `resources/crs/escalation-settings/` — `CascadeCard.tsx`, `PolicyCard.tsx`, `StateMappingCard.tsx`, `VerifyCard.tsx`, `RecentChangesCard.tsx`, `skipReasonCopy.ts` (plain-language skip-reason dictionary), `legacyConfig.ts` (v0 read for the cascade chip) | Per-card components of the Escalation Settings page — *added by `feat/escalation-prd-alignment`* |
| v0 EscalationConfig editor | `admin/themeEditor/EscalationConfigEditor.tsx` | Legacy v0 schema editor (kept for fallback tenants) |
| Per-level SLA widget | `components/widgets/SlaByLevelInput.tsx` | hh:mm:ss ↔ ms conversion |
| Per-service-code overrides | `components/widgets/ServiceOverridesEditor.tsx` | Matrix editor for v0 schema |
| Designation tree side panel | `components/widgets/DesignationTreePanel.tsx` | Read-only HRMS tree (who escalation hits) |
| Workflow Action select | `admin/WorkflowActionSelect.tsx` | Per-state action picker; respects ESCALATE comment-required |
| Schema descriptors | `admin/schemaDescriptors/escalation-config.ts`, `auto-escalation-ignore.ts`, `index.ts` | Maps MDMS schemas to UI editor configs |
| Docs pane | `components/layout/DocsPane.tsx` | Inline help panel showing relevant design-doc anchors |
| i18n strings | `providers/i18nProvider.ts` | Locale keys for matrix + drawer + the `app.nav.escalation_settings` nav entry |
| Seed/recovery scripts | `resources/crs/sla-matrix/_seed/fix-xref-schema.sql`, `example.csv` | Reset cross-ref schema; example CSV row |
| SLA-by-level schema patch | `resources/crs/sla-matrix/_seed/add-sla-by-level.sql` | Idempotent `jsonb_set` patch adding `slaHoursByLevel` to already-registered `CRS.CategorySLA` schemas (mdms-v2 has no schema `_update`) — *added by `feat/escalation-prd-alignment`* |

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
| `integration-tests/tests/lifecycle/pgr-escalation-full-flow.spec.ts` | Canonical full-flow E2E: seeded tuple-scoped 15s SLA → cron-phase sentinel → create → ASSIGN (#1674 regression read) → 60s → dryRun → escalate → post-conditions; cron-safe, self-cleaning — *added by `feat/escalation-prd-alignment`* |
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
| `crs-sla-matrix.spec.ts` | SLA Matrix page e2e — render, edit, save, trace-back, import; extended with a Levels-column-header assertion on `feat/escalation-prd-alignment` |
| `escalation-settings.spec.ts` | Escalation Settings page e2e (read-only against a live deployment) — page renders banner-or-cards, Card 1 shows the six cascade rows, the status-mapping table renders, the test-scan button is visible — *added by `feat/escalation-prd-alignment`* |

---

## 6. How to test

Five layers (matches §"Testing strategy" in [`docs/escalation-feature-design.md`](./escalation-feature-design.md#testing-strategy)).

### Layer 1 — Backend unit tests
- **What**: `EscalationSchedulerSlaResolutionTest` (4 cases on layer cascade; 8 on `feat/escalation-prd-alignment`) + `EscalationSchedulerPreBreachTest` (5 cases on threshold-crossing, `feat/escalation-prd-alignment`) + `ServiceRequestValidatorTest` (14 cases, 4 escalate-specific; 15/5 on `feat/escalation-prd-alignment`) + existing tests.
- **Run**: `cd backend/pgr-services && mvn test`
- **Expected**: all escalation + validator suites green (run: `mvn test -Dtest='Escalation*Test,ServiceRequestValidatorTest'`).
- **Edge cases follow-up**: PR [#797](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/797) adds 7 more JUnit cases for `STATE_MAPPING_MISSING` cascade.

### Layer 2 — MDMS shape validation
- **What**: Schema validation against the registered schemas (4 through PR #775; 5 with `CRS.EscalationPolicy` on `feat/escalation-prd-alignment`). Catches regressions like a bad slaHoursByState `oneOf` (see §9 issue 5).
- **Run**: `curl -X POST '<mdms-v2>/schema/v1/_validate' ...` (see design doc §"Layer 2").
- **Expected**: every schema validates clean; data rows validate or surface a specific path-error.

### Layer 3 — Configurator e2e (Playwright)
- **What**: `configurator/e2e/crs-sla-matrix.spec.ts` — render, edit, save, trace-back, CSV import.
- **Run**: `cd configurator && npx playwright test e2e/crs-sla-matrix.spec.ts`
- **Expected**: all green; trace-back drawer renders its scheduler-verdict / complaint / resolved-SLA panes; import handles range cells.
- **Escalation Settings e2e** (`feat/escalation-prd-alignment`): `cd configurator && npx playwright test e2e/escalation-settings.spec.ts` — read-only live checks: page renders banner-or-cards, six cascade rows in Card 1, status-mapping table, test-scan button visible.
- **CSV parser unit tests** (`feat/escalation-prd-alignment`): `cd configurator && npx vitest run src/resources/crs/sla-matrix/csvParser.test.ts` — header-case canonicalization, export→import round-trip, range cells, missing-column error.
- **Client resolver unit tests** (`feat/escalation-prd-alignment`): `cd configurator && npx vitest run src/resources/crs/sla-matrix/resolveSlaPreview.test.ts` — mirrors the backend resolution vectors (level beats state, policy level beats state default, null/0/out-of-bounds fall-through, range MAX collapse incl. reversed pairs, first-matching-row break, no-mapping behaviour) plus LevelSlaEditor value-logic and `standardStateMappings` shape tests.
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
- **Expected**: three panes — scheduler verdict (action/reason/detail), complaint summary, and resolved SLA showing which of the 5 sources answered plus the value; the elapsed-vs-SLA numbers ride the verdict's `detail` string.

---

## 7. How to deploy to a new tenant

**Two paragraphs + link to PR [#796](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) for the full runbook.**

Deployment is image + 5 MDMS schemas + seed rows + nginx routing. The pgr-services image (`escalation-otel-amd64-fallback-<sha>`) is tenant-agnostic; pull it from the VPC registry (`10.0.0.4:5000`) into the target server's compose. The configurator bundle is built once and rsynced to `/var/www/configurator/` on every tenant — also tenant-agnostic. The five MDMS schemas (`CRS.WorkflowStateMapping`, `CRS.StateSLA`, `CRS.CategorySLA`, `CRS.SLAAuditLog`, `CRS.EscalationPolicy`) can be registered in **any order** — nothing enforces a registration order (every schema's `x-ref-schema` is empty; an earlier revision of this doc claimed otherwise). What matters operationally is the **data** seed order: seed the WorkflowStateMapping row first, so the scheduler can translate states before any StateSLA/CategorySLA row is consulted. Each tenant then seeds its own data: one WorkflowStateMapping row (operator-defined state→column map), one StateSLA row (per-state defaults), N CategorySLA rows (one per `(path, category, subcategoryL1)` tuple), optionally one EscalationPolicy singleton (maxDepth, per-level default SLAs, pre-breach config, `escalateCommentRequired`), and zero or more v0 EscalationConfig rows (legacy fallback).

After seeding, verify with the three smoke commands in §3: `/escalation/_trigger` returns HTTP 200 with a non-zero `scanned` count, OTEL spans appear in Tempo with `slaSource` set to one of the 5 sources (`CRS.CategorySLA.level` | `CRS.CategorySLA` | `CRS.EscalationPolicy.level` | `CRS.StateSLA` | `v0.EscalationConfig`), and the configurator SLA Matrix page renders the seeded rows. Common pitfalls (full list in PR #794): the x-ref-schema regression after MDMS recreate (`fix-xref-schema.sql` recovery), persister-async means a 202 response doesn't mean the row is queryable yet (`time.sleep(3)` between schema register + data create), and the mdms-v2 `oneOf` validator quirk on `slaHoursByState` (see §9 issue 5). Full operator-facing runbook: [PR #796 — `docs/deploying-escalation-to-new-tenant.md`](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796).

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

**Recommended starting point**: **G1 (Category Taxonomy)** is the lowest-risk highest-value follow-on — it unblocks G2 (which depends on a constrained category vocab). The `CRS.WorkflowStateMapping` configurator-UI gap that G1 was once slated to absorb is now **closed** by the Escalation Settings page on `feat/escalation-prd-alignment` (§9 issue 4). After G1, build G8 if the target deployment wants Strategy A wiring, otherwise G2.

---

## 9. Known issues + outstanding work

1. **CSV parser case bug** *(FIXED on `feat/escalation-prd-alignment`)* — `configurator/src/resources/crs/sla-matrix/csvParser.ts` lowercased the CSV header then compared against the camelCase literal `'subcategoryL1'`. Earlier revisions of this doc undersold it as a lowercased-headers-only problem; in fact the `REQUIRED_COLS` lookup never matched after header lowercasing, so the bug broke **ALL imports** regardless of header casing. Fixed by canonicalizing `subcategoryl1` → `subcategoryL1` after lowercasing, with Vitest coverage in `csvParser.test.ts`. History: tracked as task #66 in the team task list since PR #770; landed on `feat/escalation-prd-alignment` (see §15.8).
2. **Upstream `egov-workflow-v2` ASSIGN-assignee persistence bug** *(blocker for downstream auto-escalation)* — workflow service silently drops `assignees` on the `ASSIGN` action; `eg_wf_assignee_v2` table stays empty. As a result the scheduler returns `NO_ASSIGNEES` for every complaint on Bomet. Tracked: noted in PR #770 body, design doc §"Assignee-persistence upstream bug", and Discussion #773. To be raised against upstream `egov-workflow-v2` repo separately. No tracking issue yet.
3. **mdms-v2 `oneOf` validator quirk on `slaHoursByState`** *(minor, upstream)* — the validator rejects `slaHoursByState` cells when shape is declared with `oneOf`. Workaround documented in design doc §"`egov-mdms-v2` validator and `oneOf` on `slaHoursByState`". Upstream `egov-mdms` fix needed. No tracking issue.
4. **`mapWorkflowStateToKey` has no configurator UI** *(RESOLVED on `feat/escalation-prd-alignment` — UI shipped)* — the Escalation Settings page (`/manage/escalation-settings`, Card 3 "Complaint-status mapping") now edits the `CRS.WorkflowStateMapping` singleton: per-row status → SLA-column selects with operator labels, inline unique-name validation, and a non-destructive "Add standard complaint statuses" merge from `standardStateMappings.ts`. Saves land at the state tenant with read-after-write verification and an audit entry. curl / Python remain valid alternatives for scripted seeding. History: design doc open-question #1; was once slated for absorption into G1 ([PR #789](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/789)) — no longer needed there.
5. **PR #770 + stack are on stale base** *(merge-blocker, not severity)* — `develop` has moved ~12+ commits since the stack was opened (PR #770 on `1e28bfb7`, follow-ups on `cdd87a84`, current `develop` at `e8cba53f`). Rebase needed before merge. No tracking issue.
6. **v0 EscalationConfig deletion (post-migration)** *(deferred)* — once all tenants migrate to CategorySLA + StateSLA, the legacy `RAINMAKER-PGR.EscalationConfig` schema + scheduler-side fallback can be removed. Tracked: design doc open-question #7. No PR yet.
7. **PR #774** is in the escalation-related set but was not in the originally listed 13-PR stack — flagged for review. It pins pgr-services image to an escalation-otel SHA. Probably intentional but worth confirming inclusion in the merge plan.
8. **Role-level (unassigned / role-inbox) escalation not implemented** *(PRD gap)* — the CMS Escalation PRD's primary user journey escalates complaints sitting unassigned in a role inbox, not only complaints held by a named assignee. The scheduler today only escalates assignee-held complaints; unassigned ones fall out as `NO_ASSIGNEES` skips. Open product decision: who is the escalation target when no assignee exists (role hierarchy? department head?). Tracked: §10 row 9; no PR yet.

---

## 10. Open architectural questions

Lifted from Discussion #773's "Open questions and deferred work" table (design doc §"Open questions"). Each: question + tracking.

| # | Question | Tracking |
|---|---|---|
| 1 | ~~No configurator UI for editing `CRS.WorkflowStateMapping` singleton~~ — **resolved on `feat/escalation-prd-alignment`**: the Escalation Settings page (Card 3) edits the singleton; curl stays available for scripted seeding | **Closed** by `feat/escalation-prd-alignment` ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)) — see §9 issue 4; no longer routed via G1 |
| 2 | Upstream DIGIT workflow ASSIGN-assignee persistence bug — blocks end-to-end escalation testing on Bomet. When does upstream land a fix? | Upstream `egov-workflow-v2`, to be raised separately |
| 3 | Category Taxonomy editor (constrained picker) — replaces free-text category/subcategoryL1 in SLA Matrix. Acceptable to ship with free-text until G1 lands? | Roadmap **G1** ([PR #789](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/789) / Discussion [#790](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/790)) |
| 4 | Path Routing Rules — `(category, subcategoryL1) → path` editable rules. Currently relies on Strategy A intake or fails silently. | Roadmap **G2** ([PR #783](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/783) / Discussion [#785](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/785)) |
| 5 | Submission Form Customisation — required for Strategy A wiring of new tenants. Should this block new-tenant rollout? | Roadmap **G8** ([PR #782](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/782) / Discussion [#787](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/787)) |
| 6 | Generic `CRS.ConfigAuditLog` supersedes escalation-specific `CRS.SLAAuditLog`. Migrate existing SLAAuditLog rows or keep both? | Roadmap **G4** ([PR #786](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/786) / Discussion [#788](https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/788)) |
| 7 | v0 EscalationConfig deletion (post-migration) — when is "all tenants migrated" declared? | Follow-up PR, no task yet |
| 8 | mdms-v2 `oneOf` validator fix — would allow declarative `slaHoursByState` cell-shape validation. Upstream fix or downstream workaround? | Upstream, no task |
| 9 | Role-level (unassigned / role-inbox) escalation — the PRD's primary user journey. Today unassigned complaints fall out as `NO_ASSIGNEES` skips. Who is the escalation target when no assignee exists? | PRD requirement, no PR — see §9 issue 8 |
| 10 | Inbox ownership / visibility semantics after escalation (does the original assignee retain visibility? does the complaint leave their inbox?) — PRD requirement; depends on upstream inbox/workflow behaviour | PRD requirement, upstream-dependent, no task |
| 11 | Business SLA clock (working hours / holidays) vs the current wall-clock elapsed-time model | PRD requirement, no PR |
| 12 | Per-stage pre-breach disable — pre-breach warning is a single tenant-wide toggle in `CRS.EscalationPolicy` today; the PRD model wants per-stage control | Follow-up on `feat/escalation-prd-alignment`, no task yet |

The canonical PRD-requirement → implementation mapping lives in the design doc's §"Requirements traceability" section ([`docs/escalation-feature-design.md`](./escalation-feature-design.md)); this table only tracks the open ends.

---

## 11. Common operations cookbook

- **Register a new tenant for escalation** — see [PR #796 runbook](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796): register the 5 schemas (any order — registration order is unenforced, see §7; seed the WorkflowStateMapping **data** row first), seed singletons (incl. the optional EscalationPolicy) — preferably via the configurator's **Escalation Settings page** (`/manage/escalation-settings`: policy form + status-mapping editor, saves at the state tenant with read-after-write verification and audit entries; curl stays available for scripted seeding) — then optional v0 fallback rows. Verify via the Settings page's test-scan card or `/escalation/_trigger` + Tempo span check.
- **Edit the escalation policy or the status mapping** — Escalation Settings page (`/manage/escalation-settings`): Card 2 for maxDepth / deployment-wide level SLAs / pre-breach warning / manual-escalation comment rule; Card 3 for the status → SLA-column mapping (with a one-click standard-set merge). Alternative for scripted setups: POST the `CRS.EscalationPolicy` / `CRS.WorkflowStateMapping` singleton to mdms-v2 via curl (note: direct writes bypass the audit log).
- **Recover from x-ref-schema regression** — run `configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql` against the mdms-v2 Postgres. Symptom: cross-reference validation errors after a schema recreate. Full recipe in PR [#794](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794).
- **Rebuild pgr-services after a code change** (canonical recipe — §15.1 uses the same one) — `cd backend/pgr-services && mvn clean package -DskipTests && docker build -t 10.0.0.4:5000/egovio/pgr-services-dev:<tag> -t registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:<tag> . && docker push 10.0.0.4:5000/egovio/pgr-services-dev:<tag> && docker push registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:<tag>`, then update the target server's compose to pin the new tag and `docker compose up -d pgr-services`. The two names are the SAME backing registry exposed two ways — VPC-direct on `10.0.0.4:5000` and nginx HTTPS on `registry.preview.egov.theflywheel.in` — push BOTH tags so compose files pinned to either name resolve the same image.
- **Redeploy configurator** — `cd configurator && npm run build`, then `cd local-setup/ansible && ./deploy.sh <tenant>` (the playbook rsyncs `dist/` to `/var/www/configurator/`).
- **Take a debug screenshot of the SLA Matrix** — `cd tests/integration-tests && BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet npx playwright test tests/admin/escalation-configurator-bomet.spec.ts --headed` — the spec already calls `page.screenshot()` on the matrix page.
- **Query a complaint's SLA-resolution path via /escalation/_trigger** — `curl -s -X POST 'https://bometfeedbackhub.digit.org/pgr-services/escalation/_trigger' -H 'Content-Type: application/json' -d '{"RequestInfo":{"authToken":"<admin-token>","userInfo":{"roles":[{"code":"SUPERUSER","tenantId":"ke"}]}},"tenantId":"ke.bomet","serviceRequestIds":["<SRID>"],"dryRun":true}' | jq '.details[]'`. Each `details[]` entry carries `serviceRequestId`, `action`, `reason`, `detail` — the elapsed/SLA numbers live inside the `detail` string — and, since `feat/escalation-prd-alignment`, `slaSource` (which of the five sources answered; `null` for `MAX_DEPTH_REACHED` / `NO_LAST_MODIFIED_TIME`, which skip before resolution runs). `fromAssignee`/`toAssignee` remain OTEL span attributes on the trigger's trace in Tempo, not response fields.
- **Inspect OTEL spans for a recent scan** — `ssh egov-bomet "curl -s 'http://localhost:13200/api/search?tags=service.name%3Dpgr-services%20span.name%3DEscalationScheduler.scanAndEscalate' | jq '.traces[0]'"`. Span attributes include `escalation.scanned`, `escalation.escalated`, `escalation.skipped`, `escalation.skipBreakdown.<reason>`, `tenantId`.
- **Force a rescan now (instead of waiting for cron)** — `POST /escalation/_trigger` — synchronous, returns the full structured result. Not an empty-body call: the controller rejects requests whose `RequestInfo.userInfo` lacks the `SUPERUSER` role, and `tenantId` is mandatory. Minimal body: `{"RequestInfo":{"authToken":"<admin-token>","userInfo":{"roles":[{"code":"SUPERUSER","tenantId":"ke"}]}},"tenantId":"ke.bomet"}`. Add `"dryRun": true` to preview the scan without mutating anything (`wouldEscalate` counts the breached complaints; `escalated` stays 0).
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
| **EscalationPolicy** | Singleton `CRS.EscalationPolicy` (`singletonKey="default"`) — tenant-wide `maxDepth`, per-level default SLA hours, pre-breach warning config, `escalateCommentRequired`. Added by `feat/escalation-prd-alignment`. |
| **v0 EscalationConfig** | Legacy `RAINMAKER-PGR.EscalationConfig` schema (per-level SLAs + per-serviceCode overrides). Kept as fallback. |
| **slaSource** | Which source answered: `CRS.CategorySLA.level` / `CRS.CategorySLA` / `CRS.EscalationPolicy.level` / `CRS.StateSLA` / `v0.EscalationConfig`. Both an OTEL span attribute and — since `feat/escalation-prd-alignment` — a per-complaint response field on `details[]` (`null` for outcomes skipped before resolution). |
| **skipReason** | One of 9 `EscalationSkipReason` values. Emitted as log + OTEL counter. |
| **dryRun** | `POST /escalation/_trigger` flag (`"dryRun": true`) — runs the full scan/decision path with zero mutations; breached complaints record `WOULD_ESCALATE` instead of escalating. Added by `feat/escalation-prd-alignment`. |
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
| CMS Escalation PRD (Draft v3.0, April 2026) | `/escalation/CMS_Escalation_PRD-latest.pdf` on the dev server — **NOT committed to the public repo** |
| Mozambique BRD "Complaints and Reports Portal" (v4.0, June 2026) | `/escalation/BRD_ Plataforma de Reclamacoes e Denuncias V4.0 ENG.docx.pdf` on the dev server — **NOT committed to the public repo** |
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
- **Upstream `egov-workflow-v2` ASSIGN-assignee bug** → FILED: [eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674) (the workflow service lives in the `core-services` repo, which redirects from `egovernments/`).
- **Upstream `egov-mdms` `oneOf` validator bug** → FILED: [eGovStack/core-services#1675](https://github.com/eGovStack/core-services/issues/1675).
- **Operator / deployment questions for Bomet** → read [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md) first, then PR [#794 ops gotchas](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/794) for symptoms + fixes, then PR [#796 deployment runbook](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/796) for new-tenant onboarding.

---

## 14. Drift between docs and live state

This section is the **drift dossier** — every place where the rest of this handoff, the design doc, or PR #770's body **implies** something that is not actually true on disk, in the live deployment, or in the repo today. A new agent picking this up must read this section first and not trust the rosy bits above without re-verifying them with the commands embedded below.

Captured 2026-06-10 against `feat/escalation-otel-configurator-designer @ cdceadb24`.

### 14.1 ~~Live Bomet `pgr-services` is NOT running the new scheduler~~ — RESOLVED 2026-06-10

> **RESOLVED 2026-06-10**: Bomet now runs `registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-prd-58db8fbfe` (PR #815 head). Verified live: `/escalation/_trigger` returns 200 with per-complaint skip reasons (`dryRun` supported); `CRS.WorkflowStateMapping` + `CRS.EscalationPolicy` schemas registered and seeded (singleton rows at `ke`); the CategorySLA `slaHoursByLevel` SQL patch applied; configurator bundle redeployed. A full end-to-end escalation was demonstrated on a test complaint (with the documented `eg_wf_assignee_v2` manual fixup for the upstream ASSIGN bug): outcome `ESCALATED fromLevel=0 toLevel=1`, status → `PENDINGATSUPERVISOR`, enriched comment "Auto-escalated to Phase0 Supervisor (DESIG_1004): …" on the timeline, and `auditDetails.lastModifiedTime` refreshed (SLA clock reset). **Deploy gotcha discovered**: the compose lacked `EGOV_BOUNDARY_HOST` for pgr-services (the code's `egov.boundary.host` defaulted to the unreachable `boundary-service.egov:8080`), which broke complaint creation until the env was added — now fixed in both `/opt/digit/docker-compose.egov-digit.yaml` on Bomet and the repo compose (PR #815). Historical analysis below kept for reference.


The live container on Bomet (`bometfeedbackhub.digit.org`) is running an **older** pgr-services build that predates the CRS-SLA scheduler and the `/escalation/_trigger` controller. The demo URLs in §3 and §4 of this doc DO NOT WORK against that image. This contradicts the impression the handoff gives that the live tenant exercises the new code.

**Verify the deployed image:**

```bash
ssh egov-bomet "docker inspect digit-pgr-services-1 --format='{{.Config.Image}}'"
# → registry.preview.egov.theflywheel.in/pgr-services-dev:latest

ssh egov-bomet "docker inspect digit-pgr-services-1 --format='{{.Image}}'"
# → sha256:e9dc6af98e88...  (the *old* :latest, retagged from pgr-services-analytics:local)

ssh egov-bomet "docker images | grep -E 'pgr-services-dev|pgr-services-analytics' | head -10"
# Shows the new tag exists on the box but is NOT what the container is running:
#   registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-otel-amd64-crs-sla-7326e9ce1   955c602120b7
#   registry.preview.egov.theflywheel.in/pgr-services-dev:latest                                            e9dc6af98e88  ← container runs this
```

**Symptom 1 — `/escalation/_trigger` returns 404 (rendered by Spring as `NoResourceFoundException`):**

```bash
ssh egov-bomet "curl -sf -X POST http://localhost:18000/pgr-services/escalation/_trigger \
  -H 'Content-Type: application/json' \
  -d '{\"RequestInfo\":{},\"tenantId\":\"ke.bomet\"}' -w 'HTTP:%{http_code}\n'"
# → HTTP:400 (because Spring's default error mapper turns NoResourceFoundException into 400 here)

ssh egov-bomet "docker logs --tail 200 digit-pgr-services-1 2>&1 | grep -E 'escalation/_trigger|NoResourceFound' | tail -3"
# → org.springframework.web.servlet.resource.NoResourceFoundException: No static resource escalation/_trigger.
```

The `EscalationController` class is not in the deployed jar.

**Symptom 2 — only aggregate `scanned/escalated/skipped` is logged per scan; per-complaint skip-reason logging is NOT firing:**

```bash
ssh egov-bomet "docker logs --tail 200 digit-pgr-services-1 2>&1 | grep 'EscalationScheduler' | tail -5"
# → ... EscalationScheduler -- Escalation scan started
# → ... EscalationScheduler -- Escalation scan complete: scanned=57, escalated=0, skipped=57
```

You see two lines per scan, never any of the 9 structured `EscalationSkipReason` values (no `NO_SUPERVISOR_IN_HRMS`, no `UNMAPPED_CATEGORY`, etc.). The structured skip-reason instrumentation introduced in `a43e4adfc` is not in this jar.

**Symptom 3 — the deployed scheduler is the OLD level-based version.** It reads `defaultSlaByLevel` from `RAINMAKER-PGR.EscalationConfig`, not the new CategorySLA-then-StateSLA chain. There is no way to confirm this from logs alone (the new version does not print which schema it queried unless OTEL is captured), but it is consistent with both Symptom 1 (no `_trigger` endpoint) and Symptom 2 (no skip-reason emission).

**Root cause hypotheses (any of these is enough):**
1. PR #774 — which pins pgr-services to `escalation-otel-amd64-crs-sla-7326e9ce1` — has not been merged.
2. The Bomet compose file (`/opt/digit/docker-compose.egov-digit.yaml`) still has `image: registry.preview.egov.theflywheel.in/pgr-services-dev:latest`. Mutable `:latest` resolves to whatever was pushed last under that tag, which is the older `pgr-services-analytics:local` retag (`e9dc6af98e88`), NOT the CRS-SLA build (`955c602120b7`).
3. Whoever last redeployed pulled `:latest`, not the SHA-tagged image.

**Recovery (in order):**

1. Build pgr-services from `feat/escalation-otel-configurator-designer @ 673005c02` (or `refactor/scheduler-state-name-mdms @ 1c8fe91f1` if you want `WorkflowStateMapping` support — see §14.2):
   ```bash
   cd /root/code/Citizen-Complaint-Resolution-System/backend/pgr-services
   mvn clean package -DskipTests
   docker build -t registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-otel-amd64-<short-sha> .
   docker push registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-otel-amd64-<short-sha>
   ```
2. Update PR #774's pinned tag to the new short-sha and merge it (or land an equivalent compose patch directly on `develop`).
3. On Bomet:
   ```bash
   ssh egov-bomet "cd /opt/digit && docker compose pull pgr-services && docker compose up -d pgr-services"
   ```
4. Re-verify with the curl in Symptom 1 — should return 200 with a real `details` array, not 400.

### 14.2 `CRS.WorkflowStateMapping` is described in the design doc as the 4th schema but only lives on PR #775

The design doc (`docs/escalation-feature-design.md`) and §6 of this handoff describe **four** CRS MDMS schemas: CategorySLA, StateSLA, SLAAuditLog, **WorkflowStateMapping**. The handoff terminology cheatsheet (§12) even has an entry for it.

**Reality on PR #770 head:**

```bash
cd /root/code/Citizen-Complaint-Resolution-System
python3 -c "import json; d=json.load(open('utilities/default-data-handler/src/main/resources/schema/CRS.json')); print([s['code'] for s in d])"
# → ['CRS.CategorySLA', 'CRS.StateSLA', 'CRS.SLAAuditLog']
```

Only THREE schemas. WorkflowStateMapping is **not** in PR #770.

**Where the 4th schema actually lives:**

```bash
git log --oneline refactor/scheduler-state-name-mdms -5
# 1c8fe91f1 test(pgr): unit tests for state-mapping resolution
# cd3567518 refactor(pgr): scheduler reads CRS.WorkflowStateMapping; drops hardcoded PGR-state switch
# 5bf57f4cd feat(mdms): CRS.WorkflowStateMapping schema (state-name → canonical SLA key)   ← here
# 7f7b48652 docs(escalation): add Configurator UI section ...
```

So `CRS.WorkflowStateMapping` is added by commit **`5bf57f4cd`** on branch `refactor/scheduler-state-name-mdms`, which is **PR #775** — not PR #770.

**Why this matters for a new agent:** if you read the design doc, then open `CRS.json` on PR #770 head, the mismatch is jarring. Any test that assumes the schema exists will fail against PR #770 in isolation (it only passes if #775 is on top).

**Two ways to reconcile (pick one before merging the foundation):**

a) **Rebase the schema-creation commit (`5bf57f4cd`) into PR #770 directly** so the design doc and the foundation PR agree on having 4 schemas. The scheduler-refactor commits (`cd3567518`, `1c8fe91f1`) stay on #775 because they touch live code paths.

b) **Reword the design doc to say "CRS.WorkflowStateMapping is introduced in stacked PR #775 — see §1 (Stack at a glance) for context."** PR #770 stays the 3-schema foundation; #775 cleanly adds the 4th.

**Recommendation: option (b).** PR #770 is already large (10K+ lines, see §14.3) and should stay a self-contained foundation. PR #775 is a clean refactor PR whose first commit is naturally the schema. The design doc forward-referencing #775 is the smaller change.

**Closing note (2026-06-10)**: resolved via option (b) on branch `feat/escalation-prd-alignment` — the design doc now carries a per-schema "Introduced in" inventory. While fixing it we found the same #775-vs-#770 drift applied to two more artifacts this handoff used to attribute to #770: the `STATE_MAPPING_MISSING` enum value (8 skip reasons in #770; the 9th lands with #775) and the `mapWorkflowStateToKey` MDMS refactor. Both are now documented as introduced by #775 (see §4 bullet 4 and the §5 schema table).

### 14.3 All 14 PRs target `develop` directly — the "stack" is NOT a git-level stack

The handoff §1 calls this "the stack." It is not. Every PR has `base = develop`:

```bash
gh pr list --repo egovernments/Citizen-Complaint-Resolution-System --state open \
  --json number,baseRefName,headRefName | python3 -c "
import json,sys
prs=json.load(sys.stdin)
target=[770,774,775,776,777,779,780,782,783,786,789,791,794,796,797]
for p in prs:
    if p['number'] in target:
        print(f\"#{p['number']:4} base={p['baseRefName']:50} head={p['headRefName']}\")"
# All 14 show: base=develop
```

**Consequence:** GitHub's diff view shows each stacked PR's diff as `develop...HEAD`, which includes the ~10K lines from PR #770 in every single one of them. Reviewers cannot see what each stacked PR *adds on top of its parent*. Review tooling is effectively blind.

**Correction (2026-06-11): re-pointing is NOT possible for this stack.** A PR's base must be a branch of the BASE repository (`egovernments/...`), but every parent head branch lives only on the fork (`ChakshuGautam/...`) — and pushing branches to the upstream repo is off-limits for this project. `gh pr edit --base <fork-branch>` fails. The feasible mitigation (DONE): every stacked PR body now opens with a "STACKED PR" note naming its parent and directing reviewers to the Commits tab. The table below is kept as the logical parent map.

The full re-base map for the existing stack:

| PR | Current base | Should target (head branch) |
|---|---|---|
| #770 | develop | develop (foundation — correct) |
| #774 | develop | `feat/escalation-otel-configurator-designer` (PR #770's head) — see §14.4 below |
| #775 | develop | `feat/escalation-otel-configurator-designer` |
| #776 | develop | `refactor/scheduler-state-name-mdms` (PR #775's head) |
| #794 | develop | `feat/escalation-otel-configurator-designer` |
| #796 | develop | `feat/escalation-otel-configurator-designer` |
| #797 | develop | `refactor/scheduler-state-name-mdms` |
| #815 (`feat/escalation-prd-alignment`) | — (PR not yet opened) | `refactor/scheduler-state-name-mdms` (PR #775's head) |
| #777 (G5) | develop | `docs/categorysla-wiring-strategies` (PR #776's head) |
| #779 (G6) | develop | `docs/categorysla-wiring-strategies` |
| #780 (G7) | develop | `docs/categorysla-wiring-strategies` |
| #782 (G8) | develop | `docs/categorysla-wiring-strategies` |
| #783 (G2) | develop | `docs/categorysla-wiring-strategies` |
| #786 (G4) | develop | `docs/categorysla-wiring-strategies` |
| #789 (G1) | develop | `docs/categorysla-wiring-strategies` |
| #791 (G3) | develop | `docs/categorysla-wiring-strategies` |

**Do all 14 in one bash loop:**

```bash
for n in 774 775 776 794 796; do gh pr edit $n --repo egovernments/Citizen-Complaint-Resolution-System --base feat/escalation-otel-configurator-designer; done
for n in 797; do gh pr edit $n --repo egovernments/Citizen-Complaint-Resolution-System --base refactor/scheduler-state-name-mdms; done
# feat/escalation-prd-alignment: when its PR (#815) opens, point it at PR #775's head too:
# gh pr edit <TBD-PRD> --repo egovernments/Citizen-Complaint-Resolution-System --base refactor/scheduler-state-name-mdms
for n in 777 779 780 782 783 786 789 791; do gh pr edit $n --repo egovernments/Citizen-Complaint-Resolution-System --base docs/categorysla-wiring-strategies; done

# Confirm:
for n in 770 774 775 776 777 779 780 782 783 786 789 791 794 796 797; do
  echo -n "#$n base=" ; gh pr view $n --repo egovernments/Citizen-Complaint-Resolution-System --json baseRefName --jq '.baseRefName'
done
```

After re-pointing, each PR's diff view will only show the commits unique to that PR on top of its parent.

### 14.4 PR #774 (pgr-services image pin) was outside the canonical 13-PR list

`#774 — fix/pgr-services-pin-crs-sla — fix(pgr-services): pin to escalation-otel-amd64-crs-sla-7326e9ce1, drop :latest` opened 2026-06-09 by the same author. State: **open**. The earlier handoff §8 lists #774 in the table but the framing across the conversation+doc treated the canonical stack as 13 PRs and #774 was sometimes omitted.

What #774 actually does:

```diff
-    image: registry.preview.egov.theflywheel.in/pgr-services-dev:latest
+    image: registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-otel-amd64-crs-sla-7326e9ce1
```

(In `local-setup/docker-compose.egov-digit.yaml`.)

**A new agent should triage one of two paths:**

a) **Rebuild a fresh image** off whatever HEAD lands (PR #770 + #775 rebased + any later commits), tag it `escalation-otel-amd64-<new-short-sha>`, push it to the VPC registry, and update PR #774 to pin that new tag. Then merge #774 alongside #770/#775.

b) **Close #774 as obsolete** and instead include the image-pin diff inside whichever PR finally bumps the base compose for the escalation stack (could be #794, the ops-gotchas PR, or a dedicated infra PR).

Option (a) is cleaner — keeps the source-→-image traceability that #774 was set up to make explicit.

Note: the currently-pinned tag `escalation-otel-amd64-crs-sla-7326e9ce1` is built off commit `7326e9ce1`, which predates the latest doc commits on PR #770 (`cdceadb24`, `673005c02`) — so even if #774 were merged as-is, the deployed jar would lag the source HEAD by a couple of commits.

### 14.5 Stale base — all PRs need rebase before merge

The merge base of `feat/escalation-otel-configurator-designer` against **upstream develop** (where PRs land) is far behind:

```bash
git fetch upstream develop
# upstream/develop tip: e8cba53f1 (Merge pull request #805 ...)
# merge base with feat/escalation-otel-configurator-designer: 72ecf830c
git rev-list --count 72ecf830c..e8cba53f1
# → 1158
```

**Upstream develop is 1158 commits ahead of where this branch was cut.** Includes:
- `egov-hrms` image bumps (`#804: hrms-pin-800-preview` — clears user-enrichment regression)
- Configurator boundary multi-hierarchy work (`#801/#802`)
- UserValidation MDMS identity refactor (`#799`)
- A long parameterization sweep across the entire E2E suite (`Refs #685`)

The fork's `develop` (`origin/develop` on `ChakshuGautam/Citizen-Complaint-Resolution-System`) is **also stale** — its tip `72ecf830c` matches the branch point exactly, so it has none of these 1158 commits either.

**Recommended rebase order** (after #14.1 / #14.2 / #14.3 / #14.4 are resolved):

1. `git fetch upstream develop && git rebase upstream/develop` on `feat/escalation-otel-configurator-designer`
2. Then chain: `refactor/scheduler-state-name-mdms` ← rebase onto new `feat/escalation-otel-configurator-designer`
3. Then: `feat/escalation-prd-alignment` (#815) ← rebase onto new `refactor/scheduler-state-name-mdms`
4. Then: `docs/categorysla-wiring-strategies` ← rebase onto new `refactor/scheduler-state-name-mdms`
5. Then: `docs/escalation-ops-gotchas-recipes` (#794), `docs/deploying-escalation-to-new-tenant` (#796) ← rebase onto new `feat/escalation-otel-configurator-designer`
6. Then: `test/escalation-state-mapping-edge-cases` (#797) ← rebase onto new `refactor/scheduler-state-name-mdms`
7. Then: the 8 G-phase drafts ← rebase onto new `docs/categorysla-wiring-strategies`

**Expected conflict zones:**
- `utilities/default-data-handler/src/main/resources/schema/CRS.json` — when #775 merges its WorkflowStateMapping schema on top, you'll get a 3→4-element JSON array merge (and a 4→5 merge when `feat/escalation-prd-alignment` adds `CRS.EscalationPolicy`).
- `backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java` — multiple refactors touched the resolution chain. Resolve by accepting the newest (PR #775's `mapWorkflowStateToKey` MDMS lookup).
- `docs/escalation-feature-design.md` — mostly additive; should merge cleanly.
- `configurator/packages/data-provider/src/providers/resourceRegistry.ts` — resource-registration order may conflict with G-phase drafts; accept the union.

If `upstream/develop`'s HRMS or workflow-v2 changes have moved the API surface, also check:
- `backend/pgr-services/src/main/java/org/egov/pgr/service/notification/NotificationService.java` (HRMS lookup)
- `backend/pgr-services/src/main/java/org/egov/pgr/util/HRMSUtil.java`

### 14.6 Two upstream bugs have no tracking issue yet

Two upstream bugs are referenced repeatedly in the design doc, Discussion #773 (prompts 2 + 8), and the §13 "Where to ask for help" table — but neither has a GitHub issue filed.

| # | Bug | Where mentioned | Tracking issue |
|---|---|---|---|
| 1 | `egov-workflow-v2 ASSIGN` action does not persist assignees to `eg_wf_assignee_v2`. The workflow record updates the `assignee` column on the parent row but does not insert the row on the join table that `nextActionsForRole` reads from. | design doc §"Upstream gaps"; Discussion #773 prompt 2 | [eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674) — FILED 2026-06-11 |
| 2 | `mdms-v2` schema validator rejects valid `oneOf` constructs (treats them as the catch-all "schema mismatch" error). Forces tenants to flatten polymorphic schemas into plain objects + client-side validation. | design doc §"Upstream gaps"; Discussion #773 prompt 8 | [eGovStack/core-services#1675](https://github.com/eGovStack/core-services/issues/1675) — FILED 2026-06-11 |

Both bugs **block reachable cleanup**:
- Bug 1 → escalation chain never completes end-to-end against a vanilla upstream workflow-v2; demo requires a patched build or manual SQL fixup.
- Bug 2 → CategorySLA's `slaHoursByState` cannot use the natural `oneOf` (object | array of overrides) shape; we ship a flat object + custom validation in the configurator.

**A new agent picking this up should file both as the first action** (see §15.6 below) so future contributors can find them by ticket search.

---

## 15. Recommended next actions (for the new agent picking this up)

Ordered checklist — what to do FIRST. Each action includes a verification command. Do not skip ahead; later actions depend on earlier ones being verified green.

### 15.1 Rebuild + redeploy pgr-services on Bomet

So the demo URLs in §3 / §4 of this doc actually work. Until this is done, every link to `https://bometfeedbackhub.digit.org/pgr-services/escalation/_trigger` is a broken demo.

```bash
# Build off current HEAD of feat/escalation-otel-configurator-designer (or stack tip after #15.5 rebases land)
cd /root/code/Citizen-Complaint-Resolution-System/backend/pgr-services
mvn clean package -DskipTests
SHORT_SHA=$(git rev-parse --short HEAD)
# Build + push BOTH tags. These are the SAME backing registry exposed two ways —
# VPC-direct on 10.0.0.4:5000, nginx HTTPS on registry.preview.egov.theflywheel.in —
# push both so compose files pinned to either name resolve the same image.
# (Same canonical recipe as the §11 cookbook entry.)
docker build \
  -t 10.0.0.4:5000/egovio/pgr-services-dev:escalation-otel-amd64-${SHORT_SHA} \
  -t registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-otel-amd64-${SHORT_SHA} .
docker push 10.0.0.4:5000/egovio/pgr-services-dev:escalation-otel-amd64-${SHORT_SHA}
docker push registry.preview.egov.theflywheel.in/egovio/pgr-services-dev:escalation-otel-amd64-${SHORT_SHA}

# Update PR #774 pin to the new tag, OR patch /opt/digit/docker-compose.egov-digit.yaml on Bomet directly:
ssh egov-bomet "sed -i 's|pgr-services-dev:latest|egovio/pgr-services-dev:escalation-otel-amd64-${SHORT_SHA}|' /opt/digit/docker-compose.egov-digit.yaml \
  && cd /opt/digit && docker compose pull pgr-services && docker compose up -d pgr-services"

# VERIFY:
ssh egov-bomet "curl -sf -X POST http://localhost:18000/pgr-services/escalation/_trigger \
  -H 'Content-Type: application/json' \
  -d '{\"RequestInfo\":{\"authToken\":\"<get-from-employee-login>\"},\"tenantId\":\"ke.bomet\"}' \
  | python3 -m json.tool | head -20"
# Should return 200 with a JSON body containing scanned/escalated/skipped + a `details` array of per-complaint skip reasons.
```

Refs: §14.1.

### 15.2 Decide the `WorkflowStateMapping` story

The handoff terminology cheatsheet (§12), design doc, and §6 all assume 4 schemas. PR #770 has 3. Pick one and act on it before any reviewer opens the foundation PR.

```bash
# Option (a): rebase the schema commit into #770 directly
cd /root/code/Citizen-Complaint-Resolution-System
git checkout feat/escalation-otel-configurator-designer
git cherry-pick 5bf57f4cd        # the schema commit from refactor/scheduler-state-name-mdms
# then on #775, drop that commit (interactive rebase or git rebase --onto)

# Option (b — recommended): forward-reference in design doc + handoff
# Edit docs/escalation-feature-design.md to note WorkflowStateMapping is introduced in PR #775.
# Edit §6 + §12 here to mark "introduced in #775, used by #775+".
```

Refs: §14.2.

### 15.3 ~~Re-point all 14 PR bases~~ — DONE the feasible way (2026-06-11)

> **DONE (alternative)**: base re-pointing is impossible for fork-hosted parents (see §14.3 correction). All 13 stacked PRs now carry a "STACKED PR" header note naming their parent and pointing reviewers at the Commits tab. The original (infeasible) commands are kept below for the record.

Until this is done, GitHub PR review is effectively unusable on the stack (every diff drowns in PR #770's 10K lines).

```bash
for n in 774 775 776 794 796; do
  gh pr edit $n --repo egovernments/Citizen-Complaint-Resolution-System --base feat/escalation-otel-configurator-designer
done
for n in 797; do
  gh pr edit $n --repo egovernments/Citizen-Complaint-Resolution-System --base refactor/scheduler-state-name-mdms
done
# feat/escalation-prd-alignment: when its PR (#815) opens, point it at PR #775's head too:
# gh pr edit <TBD-PRD> --repo egovernments/Citizen-Complaint-Resolution-System --base refactor/scheduler-state-name-mdms
for n in 777 779 780 782 783 786 789 791; do
  gh pr edit $n --repo egovernments/Citizen-Complaint-Resolution-System --base docs/categorysla-wiring-strategies
done

# Confirm:
for n in 770 774 775 776 777 779 780 782 783 786 789 791 794 796 797; do
  printf "#%-4s base=" "$n"
  gh pr view $n --repo egovernments/Citizen-Complaint-Resolution-System --json baseRefName --jq '.baseRefName'
done
```

Refs: §14.3.

### 15.4 ~~Triage PR #774~~ — DONE: closed as superseded (2026-06-11)

> **DONE**: closed — [PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815) commit `40d089cc8` pins the same file to the current build (`escalation-prd-042c61758`) and adds `EGOV_BOUNDARY_HOST`.

Either rebase its image-pin onto the new SHA from §15.1 (recommended), or close it as obsolete:

```bash
# If keeping: update PR #774 head branch's compose patch to the new SHA-tag
git fetch origin fix/pgr-services-pin-crs-sla
git checkout fix/pgr-services-pin-crs-sla
# edit local-setup/docker-compose.egov-digit.yaml to new tag from §15.1
git commit -am "fix(pgr-services): rebump pin to <new-short-sha>"
git push origin fix/pgr-services-pin-crs-sla

# If closing:
gh pr close 774 --repo egovernments/Citizen-Complaint-Resolution-System --comment "Obsolete — image-pin folded into <PR-number> after rebuild"
```

Refs: §14.4.

### 15.5 Rebase the stack onto `upstream/develop` tip

After §15.1–§15.4, in this exact order:

```bash
cd /root/code/Citizen-Complaint-Resolution-System
git fetch upstream develop

# 1. Foundation
git checkout feat/escalation-otel-configurator-designer
git rebase upstream/develop
# Resolve conflicts (expect: configurator resourceRegistry.ts, pgr-services pom for HRMS bump)
git push --force-with-lease origin feat/escalation-otel-configurator-designer

# 2. Schema + scheduler refactor
git checkout refactor/scheduler-state-name-mdms
git rebase feat/escalation-otel-configurator-designer
# Expect conflict in CRS.json (3→4 array merge), EscalationScheduler.java
git push --force-with-lease origin refactor/scheduler-state-name-mdms

# 3. PRD alignment (stacked on #775)
git checkout feat/escalation-prd-alignment
git rebase refactor/scheduler-state-name-mdms
# Expect conflict in CRS.json (4→5 array merge), EscalationScheduler.java
git push --force-with-lease origin feat/escalation-prd-alignment

# 4. Wiring-strategies doc
git checkout docs/categorysla-wiring-strategies
git rebase refactor/scheduler-state-name-mdms
git push --force-with-lease origin docs/categorysla-wiring-strategies

# 5. Ops docs + new-tenant runbook
for br in docs/escalation-ops-gotchas-recipes docs/deploying-escalation-to-new-tenant; do
  git checkout $br
  git rebase feat/escalation-otel-configurator-designer
  git push --force-with-lease origin $br
done

# 6. Edge-case tests
git checkout test/escalation-state-mapping-edge-cases
git rebase refactor/scheduler-state-name-mdms
git push --force-with-lease origin test/escalation-state-mapping-edge-cases

# 7. The 8 G-phase drafts
for br in feat/g1-category-taxonomy-draft feat/g2-path-routing-rules-draft \
          feat/g3-entity-directory-draft feat/g4-permission-matrix-draft \
          feat/g5-notification-templates-draft feat/g6-territorial-hierarchy-draft \
          feat/g7-dashboard-config-draft feat/g8-submission-forms-draft; do
  git checkout $br
  git rebase docs/categorysla-wiring-strategies
  git push --force-with-lease origin $br
done

# VERIFY each branch builds + tests pass (next step picks this up)
```

Refs: §14.5.

### 15.6 ~~File the two upstream bugs~~ — DONE (2026-06-11)

> **DONE**: [eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674) (workflow-v2 ASSIGN) and [eGovStack/core-services#1675](https://github.com/eGovStack/core-services/issues/1675) (mdms-v2 `oneOf`). Note: neither service has a standalone repo — both modules live in `core-services` (the `egovernments` org redirects to `eGovStack`). Discussion #773 prompts 2/8 and §13/§14.6 updated with the links.

Open issues against the repos that own the affected services, then link the issue URLs back into Discussion #773 (prompts 2 and 8) and into §13 of this doc.

```bash
# Bug 1: egov-workflow-v2 ASSIGN does not persist to eg_wf_assignee_v2
gh issue create --repo egovernments/egov-workflow-v2 \
  --title "ASSIGN action: assignee written to parent row, NOT inserted into eg_wf_assignee_v2" \
  --body "Symptom: after a workflow ProcessInstance with action=ASSIGN, the parent row's \`assignee\` column updates but no row appears in \`eg_wf_assignee_v2\`. \`nextActionsForRole\` then can't find the assignee, breaking re-assignment / escalation chains.

Repro: see CRS escalation design doc §'Upstream gaps' — https://github.com/egovernments/Citizen-Complaint-Resolution-System/blob/feat/escalation-otel-configurator-designer/docs/escalation-feature-design.md

Workaround in CCRS: scheduler issues a direct INSERT into eg_wf_assignee_v2 on escalation.

Originally surfaced in Discussion https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773 prompt 2."

# Bug 2: mdms-v2 oneOf validator
gh issue create --repo egovernments/egov-services \
  --title "mdms-v2 schema validator rejects valid oneOf constructs" \
  --body "Symptom: schemas using \`oneOf: [{type:object}, {type:array}]\` are flagged as schema-mismatch on create/update through mdms-v2.

Forces tenants to flatten polymorphic shapes (CategorySLA.slaHoursByState was forced from a oneOf into a plain object with client-side validation).

Refs:
- CRS escalation design doc §'Upstream gaps'
- Discussion https://github.com/egovernments/Citizen-Complaint-Resolution-System/discussions/773 prompt 8"

# After both are filed, update §13 of this doc + Discussion #773 prompts 2 and 8 with the issue URLs.
```

(If `egovernments/egov-services` is not the right repo for the mdms-v2 service, file against `egovernments/egov-mdms-service` instead — check `gh repo list egovernments` first.)

Refs: §14.6.

### 15.7 Run the e2e suites once the stack is rebased + Bomet is current

Don't request review until all three are green:

```bash
# 1. Configurator SLA matrix UI test
cd /root/code/Citizen-Complaint-Resolution-System/configurator
npx playwright test e2e/crs-sla-matrix.spec.ts

# 2. pgr-services backend unit tests
cd /root/code/Citizen-Complaint-Resolution-System/backend/pgr-services
mvn test -Dtest="Escalation*"

# 3. End-to-end against live Bomet (depends on §15.1 redeploy)
cd /root/code/Citizen-Complaint-Resolution-System/tests/integration-tests
BASE_URL=https://bometfeedbackhub.digit.org DIGIT_TENANT=ke.bomet \
  npx playwright test tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts
```

If any are red, fix before moving to §15.8.

### 15.8 Land task #66 (csvParser case-sensitivity bug) — DONE on `feat/escalation-prd-alignment`

Landed on `feat/escalation-prd-alignment` (not on PR #770 as originally planned). The header parser now canonicalizes `subcategoryl1` → `subcategoryL1` after lowercasing, and `csvParser.test.ts` (Vitest) covers all header casings plus an export→import round-trip, range cells, and the missing-column error path. Note the original framing here undersold the bug — the lowercased `REQUIRED_COLS` lookup never matched, so ALL imports were broken, not just lowercased headers (see §9 issue 1).

```bash
# Verify:
cd /root/code/Citizen-Complaint-Resolution-System/configurator
npx vitest run src/resources/crs/sla-matrix/csvParser.test.ts
```

### After §15.1 – §15.8 are complete

Then — and only then — the system's docs, code, and live state are aligned. Request reviewers on PR #770 first (the foundation), then walk reviewers up the rebased stack in dependency order: #775 → #776 → #794/#796 → #797 → G-phase drafts.

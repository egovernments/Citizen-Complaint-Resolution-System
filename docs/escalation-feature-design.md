# CRS Escalation Feature — Canonical Design Doc

> **Status**: living doc for the work shipped in [PR #770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
> on branch `feat/escalation-otel-configurator-designer`, and the stacked work
> on top of it: [PR #775](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775)
> (MDMS-driven workflow-state mapping) and branch `feat/escalation-prd-alignment`
> (PRD alignment, [PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)).
> **Audience**: platform engineers, configurator developers, deployment operators.
> **Related**: [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md) (sibling
> roadmap for non-escalation work), [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
> (operational notes from the first live deployment).

---

## Terminology cheatsheet

Short glosses of every domain acronym used in the rest of this doc.
A fuller glossary lives at the end; this strip is the "open at line 1
and you can read on" version for newcomers.

- **CRS** — Citizen Complaint Resolution System (this codebase).
  Replaces the older PGR module.
- **PGR** — Public Grievance Redressal, the legacy DIGIT module CRS
  evolved from. Bomet and Nairobi deployments still run PGR-style
  state names.
- **MDMS** — Master Data Management Service, DIGIT's config store.
  Has v1 (read) and v2 (write + schema-defined). All `CRS.*` records
  live in v2.
- **SLA** — Service-Level Agreement, the time budget before an
  escalation fires.
- **OTEL** — OpenTelemetry, the tracing standard. Spans land in Tempo.
- **Tempo** — Grafana's distributed tracing backend, deployed
  alongside each tenant.
- **HRMS** — Human Resource Management Service. Source of the
  supervisor chain via `assignment.reportingTo`.
- **BRD** — Business Requirements Document. In this doc, "BRD §5.2"
  refers to the Mozambique CRS BRD's case-lifecycle table.
- **srid** — Service Request ID, the canonical complaint identifier
  (e.g. `PG-PGR-2026-04-13-000356`).
- **Bomet, Nairobi** — two live Kenya county deployments of CRS.
- **Tenant** — a CRS deployment unit (a country, a region, a county).
  Every MDMS record is scoped to a tenant.
- **Kong** — the API gateway every public request flows through.

---

## Executive summary

The CRS escalation feature is the per-tenant, per-category SLA pipeline that the
`pgr-services` scheduler uses to decide which open complaints have breached their
service-level agreement and need to be re-assigned up the supervisor chain.
It serves three audiences at once: **citizens** whose complaints would otherwise
sit unattended; **operators** who need to debug *why* a specific complaint did or
did not escalate (and tune SLAs in response); and **platform engineers** who need
a generic, tenant-agnostic way to wire SLA targets without code changes.

Architecturally the feature is a **three-layer SLA resolution** read by
[`EscalationScheduler#resolveSlaHours`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java),
supported by a fourth MDMS schema (`CRS.WorkflowStateMapping`) that
translates a tenant's workflow state names into the canonical SLA-column
keys used by the three resolution layers:

1. **`CRS.CategorySLA`** — per-tuple (path, category, subcategoryL1) SLA rows
   with one cell per workflow state.
2. **`CRS.StateSLA`** — per-state defaults (singleton record per tenant) used
   when the matching CategorySLA cell is null.
3. **`RAINMAKER-PGR.EscalationConfig`** (v0) — the pre-existing per-level SLA
   table, kept as a safety net so a tenant that has not yet migrated does not
   lose escalation overnight.

The fourth schema, **`CRS.WorkflowStateMapping`**, is not itself an SLA layer
— it is the operator-defined dictionary that maps each workflow state name
(e.g. `PENDINGFORASSIGNMENT`) onto one of the six canonical SLA-column keys
(`new | triage | forwarded | investigation | awaiting | resolved`). Without
it, the scheduler cannot resolve which cell of the SLA layers above to read.

The selected layer is surfaced on each OTEL span as `escalation.slaSource` and,
since `feat/escalation-prd-alignment`, as a `slaSource` field on each
`/escalation/_trigger` `details[]` entry — so an operator can tell from a single
trace or trigger response which configuration answered the lookup.

Span structure: the scan span carries the **aggregates**
(`escalation.scanned/escalated/wouldEscalate/roleEscalated/preBreachWarnings/skipped.*`)
and every complaint the scan touches gets its own **child span** named
`escalation.complaint` carrying the per-complaint attributes
(`complaint.serviceRequestId`, `escalation.fromLevel/toLevel/skipReason/slaSource`,
plus `escalation.roleEscalation/resolutionStrategy/actingRole/candidateCount/departmentFiltered`
on the role path). Before the child spans, per-complaint attributes were written
last-writer-wins onto the single scan span and were only trustworthy for
single-complaint scans.

**What landed in PR #770**: three MDMS schemas — `CRS.CategorySLA`, `CRS.StateSLA`,
`CRS.SLAAuditLog` — in
[`utilities/default-data-handler/src/main/resources/schema/CRS.json`](../utilities/default-data-handler/src/main/resources/schema/CRS.json),
the scheduler patch that consumes them, the new admin endpoint `POST /pgr-services/escalation/_trigger`,
the SLA Matrix configurator page with bulk-CSV import + trace-back drawer, structured
skip-reason logging, OTEL span attributes, the mandatory-comment validator on manual
`ESCALATE`, and a workflow-designer iframe integration.
**What landed in PR #775** (stacked on #770): the fourth schema,
`CRS.WorkflowStateMapping`, and the scheduler refactor that replaced the
hardcoded PGR-state switch with the operator-defined MDMS lookup.
**What lands on `feat/escalation-prd-alignment` ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815))**: the fifth and
sixth schemas — `CRS.EscalationPolicy` and `CRS.RoleSupervisors` — plus the
PRD-alignment capabilities below.

The PRD-alignment branch extends the resolution to a five-step precedence
(see [Scheduler resolution algorithm](#scheduler-resolution-algorithm)) and
adds: per-escalation-level SLAs (the PRD's complaint-type × level model —
`CategorySLA.slaHoursByLevel` per row, `EscalationPolicy.defaultSlaHoursByLevel`
tenant-wide); a `dryRun` mode on `/escalation/_trigger` so the trace-back
drawer previews decisions without mutating breached complaints; stateless
pre-breach warning detection (configurable threshold, default 75% of SLA,
emitted on the `pgr-escalation-prebreach` Kafka topic); an enriched
`ESCALATE` workflow comment carrying the PRD audit-trail fields (supervisor
name, designation, elapsed-vs-SLA); a configurable manual-`ESCALATE`
comment requirement (`EscalationPolicy.escalateCommentRequired`); and opt-in
**role-level escalation** (PRD P4) — a complaint sitting unattended in a role
inbox with no named assignee escalates to **exactly one** resolved individual
via an R1 pin → R2 ladder → R3 reportingTo-consensus algorithm, byte-identical
to today when disabled (see
[Role-level escalation (opt-in)](#role-level-escalation-opt-in)).
The same branch ships the operator UI for the new knobs: an **Escalation
Settings** configurator page (policy form incl. the role-escalation opt-in
block, complaint-status-mapping editor,
configuration test scan — see [Escalation Settings page](#escalation-settings-page)),
a **Levels** column on the SLA Matrix for per-row `slaHoursByLevel`, and a
per-complaint `slaSource` field on the `/escalation/_trigger` response.
**What is deferred**: the constrained category taxonomy editor (free-text categories
remain until then), path-routing rules, entity directory, role-permission matrix,
notification templates, territorial hierarchy, dashboard editor and submission-form
customisation — see the General CRS Configurator roadmap
([`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)) for phases
G1–G8.

---

## Requirements traceability

### Requirements sources

| Source | Version / date | Location |
|---|---|---|
| CMS Escalation PRD | Draft v3.0, April 2026 | `/escalation/CMS_Escalation_PRD-latest.pdf` |
| Mozambique BRD "Plataforma de Reclamações e Denúncias" | v4.0, June 2026 | `/escalation/BRD_ Plataforma de Reclamacoes e Denuncias V4.0 ENG.docx.pdf` |

Both documents are deliberately **not committed** to this public repository
— they are client requirements documents. The paths above are their
locations on the working machine; cite them by title + version in reviews.
The PRD requirements are numbered **P1–P12** here for cross-referencing;
the numbering is this doc's, not the PRD's.

### Traceability table

| Requirement | Source | Status | Where |
|---|---|---|---|
| **P1** — SLAs configurable per complaint type × escalation level (L0/L1/L2 table, e.g. Pothole 5d/2d/1d), not hardcoded | PRD v3.0 | **Closed** (this branch) | `CategorySLA.slaHoursByLevel` per row + `CRS.EscalationPolicy.defaultSlaHoursByLevel` tenant-wide; precedence documented in [Scheduler resolution algorithm](#scheduler-resolution-algorithm). Both editable in the configurator on this branch: SLA Matrix → **Levels** column (per row) and the [Escalation Settings page](#escalation-settings-page) (deployment-wide level SLAs). Note: the state-based matrix (BRD shape) and the level-based model (PRD shape) now **coexist**; per-row level config takes precedence. Product sign-off on the combined model is still pending — see [Open questions](#open-questions-and-deferred-work). |
| **P2** — pre-breach warning at configurable threshold (default 75% of SLA), per workflow per tenant, sent to current owner AND supervisor, per-complaint (not bundled), suppressed if manually escalated, can be disabled per stage | PRD v3.0 | **Detection closed** (this branch); **delivery deferred (G5)** | Stateless threshold-crossing detection in the scheduler — OTEL attrs + Kafka event on `pgr-escalation-prebreach` (see [Pre-breach warnings](#pre-breach-warnings)). Enable flag + threshold are editable on the [Escalation Settings page](#escalation-settings-page) (this branch closed the previously config-API-only gap). Delivery (WhatsApp/SMS/email to owner + supervisor) is roadmap **G5**; the PRD's "to owner AND supervisor" routing is a G5 consumer concern. Suppressed-if-manually-escalated is **approximated**, not strictly implemented: a manual ESCALATE resets `lastModified` via the normal update flow but does **not** bump `escalationLevel` (only the scheduler's auto path writes that), so the clock restarts and a fresh warning at the same level can fire later in the new window — by design. **Residual gap**: per-stage disable is not implemented — only the global `preBreachWarning.enabled`. |
| **P3** — auto-escalate on breach to the HRMS-mapped supervisor; single individual only | PRD v3.0 | **Shipped** (#770, state mapping in #775) | [`EscalationService#escalateComplaintWithReason`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java) — HRMS `reportingTo` lookup + workflow ESCALATE transition. |
| **P4** — role-level escalation: complaint sitting in a role inbox (all GROs/LMEs) with no named assignee escalates to the role's direct supervisor when all members are same-department; multi-department case explicitly TBD in the PRD | PRD v3.0 | **Implemented (opt-in)** — [Role-level escalation (opt-in)](#role-level-escalation-opt-in), live-verified on Bomet across `pgr-escalation-role-flow.spec.ts` (R1 pin), `pgr-escalation-r2r3-flow.spec.ts` (R2/R3 + cross-tenant memo on the fixture tenants), `pgr-escalation-full-flow.spec.ts` (named-assignee baseline), and the UI-driven `configurator/e2e/escalation-settings-flow.spec.ts` | Panel-reviewed design: acting-role-per-state map, R1 pin → R2 ladder → R3 reportingTo-consensus resolution (exactly one individual or an actionable skip), per-scan cap, provenance fields. Hard prerequisite: the workflow ASSIGN-persistence fix ([eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674)) — the eligibility gate reads the same table the bug failed to populate; **satisfied on current deployments** (Bomet runs `egov-workflow-v2:maven-jdk21-43f925c2`), required before enabling elsewhere. While the feature is disabled, `NO_ASSIGNEES` continues to cover (and mask) this journey. |
| **P5** — on escalation: removed from subordinate inbox (all role inboxes if role-assigned), appears in supervisor inbox, supervisor becomes owner, subordinate keeps search access | PRD v3.0 | **Not addressed** | Inbox semantics live in `egov-workflow-v2` / the inbox service — upstream + open decision. |
| **P6** — state SLA clock resets on escalation; business SLA clock continues uninterrupted | PRD v3.0 | **Partial** | State clock reset works — auto-escalation refreshes `auditDetails.lastModifiedTime` on every escalation, so each level genuinely gets a fresh SLA window; a manual ESCALATE resets the clock too (via the normal update flow) but does not bump `escalationLevel` — only the scheduler's auto path writes the level. The business SLA clock is **not modeled** — open decision. |
| **P7** — escalation visible in audit trail (recipient name, designation, timestamp, comments); citizen notified + escalation entry in complaint timeline visible to citizen and employee | PRD v3.0 | **Closed** (this branch) for audit-trail fields; **notification deferred (G5)** | Enriched ESCALATE workflow comment carries supervisor name + designation + elapsed/SLA; timeline = the existing PGR workflow timeline, visible to citizen and employee — see [Escalation timeline and audit trail](#escalation-timeline-and-audit-trail). The citizen *push notification* on escalation is roadmap **G5**. |
| **P8** — manual Escalate action with mandatory comment, configurable | PRD v3.0 | **Shipped** (#770); configurability **closed** (this branch) | Manual ESCALATE + mandatory-comment validator in #770; `CRS.EscalationPolicy.escalateCommentRequired` makes the rule configurable (default required), editable via the [Escalation Settings page](#escalation-settings-page) checkbox (this branch). |
| **P9** — supervisor permitted actions configurable per level (Reassign / Reject / Send back / Send back to citizen / Forward / Comment / Escalate) | PRD v3.0 | **Deferred** | Roadmap **G4** (role-permission matrix) + the workflow designer. |
| **P10** — escalation depth ceiling configurable (max 5 for now); top of chain: complaint stays with last reachable person | PRD v3.0 | **Closed** (this branch); top-of-chain already shipped | `CRS.EscalationPolicy.maxDepth` (falls back to v0 `EscalationConfig.maxDepth`, then the static property), editable on the [Escalation Settings page](#escalation-settings-page) (this branch). Top-of-chain behaviour shipped in #770: `NO_SUPERVISOR_IN_HRMS` leaves the complaint with the last reachable person. |
| **P11** — visibility: N+1 sees direct reports' complaints from filing; N+2 and above must search | PRD v3.0 | **Not addressed** | Upstream inbox concern — open decision. |
| **P12** — notifications multi-channel configurable per role (supervisor email, GRO SMS, LME WhatsApp) | PRD v3.0 | **Deferred** | Roadmap **G5** (notification templates). |
| **BRD lifecycle + catalog** — case lifecycle NEW / IN TRIAGE (24h) / FORWARDED (48h) / UNDER INVESTIGATION / AWAITING INFORMATION / RESOLVED / REJECTED (no SLA); Appendix A catalog rows (Category, SubcategoryL1, SubcategoryL2, single SLA(h) column, values 24–360 incl. ranges like 24-120); paths IGE/IGSAE; unidirectional flow; SLA matrix by case type controls all deadlines | BRD v4.0 §5.2 + Appendix A | **Shipped** (#770/#775) | The six-state matrix (`CRS.CategorySLA` + `CRS.StateSLA`) + `CRS.WorkflowStateMapping`. **Note**: Appendix A carries a *single* SLA(h) column per catalog row while the matrix has six state cells — the column-to-cell mapping is ambiguous. Recommendation: seed the catalog SLA into the UNDER INVESTIGATION column and cover the rest via `CRS.StateSLA` defaults; flagged for the PR #796 runbook. |

---

## Goals and non-goals

### Goals

- **Per-tenant configurable SLAs** with no code changes — every value an operator
  cares about lives in MDMS.
- **Observable scheduler decisions** — every per-complaint outcome carries a
  structured `EscalationSkipReason` (or `SUCCESS`) and ends up in logs, the
  `/escalation/_trigger` response and the OTEL span.
- **No implicit policy defaults** — `DEFAULT_STATE_DEFAULTS` is all-null. The
  configurator renders an explicit "Not configured" prompt instead of fabricating
  magic numbers; the seed CSV ships generic `SAMPLE` rows that the operator must
  replace.
- **BRD-shape compatible** — the schema layout (path / category / subcategoryL1,
  six workflow-state keys) mirrors the BRD §5.2 case-lifecycle table so a
  Mozambique-style deployment can populate it directly, but **nothing**
  BRD-specific is hardcoded.
- **Generic (not MZ-coupled, not Kenya-coupled)** — same schemas, same scheduler,
  same UI for every tenant. The PR explicitly stripped Mozambique seed data
  ([commit `45d94954f`](https://github.com/egovernments/Citizen-Complaint-Resolution-System/commit/45d94954f))
  and the path-enum that initially constrained the field to `IGE`/`IGSAE`
  ([recovery SQL in `_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql)).

### Non-goals

| Out of scope | Owner |
|---|---|
| Replacing the `egov-workflow-v2` state machine | upstream DIGIT |
| Replacing the categorization taxonomy | roadmap **G1** |
| Replacing the role-permission matrix | roadmap **G4** |
| Replacing the entity directory (ministries / municipalities / agents) | roadmap **G3** |
| Building intake / submission forms | roadmap **G8** |
| Notification templates fired on escalation | roadmap **G5** |
| Dashboard indicators for SLA compliance | roadmap **G7** |

---

## Architecture

### High-level flow

```
                       +-----------------------+
   citizen UI / API -> | PGR / CRS submission  |
                       +-----------------------+
                                  |
                                  v
                       +-----------------------+         every 5 min (cron)
                       | workflow transitions  | <-----+
                       |  (egov-workflow-v2)   |       |
                       +-----------------------+       |
                                  |                    |
                                  v                    |
                       +-----------------------+       |
                       | application state set |       |
                       |  PENDINGFORASSIGNMENT |       |
                       |  PENDINGATLME ...     |       |
                       +-----------------------+       |
                                                       |
   admin / test caller  ---POST /escalation/_trigger---+ (synchronous, same code path; optional dryRun)
                                                       |
                                                       v
   +-------------------------------------------------------------------+
   | EscalationScheduler.scanAndEscalateOnce(tenantId, ids, RI,        |
   |                                         dryRun)                   |
   |  1. fetch  CRS.CategorySLA          (MDMS v1 search)              |
   |  2. fetch  CRS.StateSLA             (MDMS v1 search)              |
   |  3. fetch  CRS.WorkflowStateMapping (MDMS v1 search)              |
   |  4. fetch  CRS.EscalationPolicy     (MDMS v1 search)              |
   |  5. fetch  ServiceDefs              (build serviceCode -> tuple)  |
   |  6. fetch  EscalationConfig (v0)    (MDMS v1 search, fallback)    |
   |  for each candidate complaint:                                    |
   |    a. resolveSlaHours -> SlaResolution(slaMs, source, unmapped)   |
   |    b. compute elapsed = now - lastModified                        |
   |    c. pre-breach check: threshold crossed since previous tick?    |
   |       -> push pgr-escalation-prebreach (suppressed in dryRun)     |
   |    d. if elapsed < sla         -> skip SLA_NOT_BREACHED           |
   |    e. else getCurrentAssignees                                    |
   |       if empty + roleEscalation enabled:                          |
   |         -> resolve role target (R1 pin -> R2 ladder ->            |
   |            R3 reportingTo consensus; memoized per scan)           |
   |         -> escalate to the ONE resolved individual, or skip       |
   |            ROLE_NOT_MAPPED / ROLE_SUPERVISOR_AMBIGUOUS /          |
   |            NO_ROLE_SUPERVISOR (actionable, never a guess)         |
   |       if empty otherwise     -> skip NO_ASSIGNEES                 |
   |    f. escalateComplaintWithReason                                 |
   |       (dryRun -> previewEscalation: same lookups, zero mutations, |
   |        counted as wouldEscalate, not escalated)                   |
   |       - lookup supervisor (HRMS reportingTo)                      |
   |       - workflow ESCALATE transition                              |
   |       - refresh auditDetails.lastModifiedTime (fresh SLA window)  |
   |       - producer.push(updateTopic, escalationTopic)               |
   |       - OTEL span attrs (fromAssignee, toAssignee, etc.)          |
   +-------------------------------------------------------------------+
                                  |
                                  v
                      EscalationTriggerResponse
                      { scanned, escalated, wouldEscalate, skipped,
                        preBreachWarnings, dryRun,
                        skipBreakdown, details[] }
                      + OTEL span attrs (escalation.*)
```

### SLA + supporting layers

Five sources answer "what is the SLA for this complaint?" (the two
level-indexed ones added on `feat/escalation-prd-alignment`), plus one
supporting layer (`CRS.WorkflowStateMapping`) that translates the
workflow state name into the canonical key the state-indexed sources are
indexed by. The table is in precedence order:

| Layer | MDMS code | Key shape | Cell shape | When used | `escalation.slaSource` attribute |
|---|---|---|---|---|---|
| Category per-level | `CRS.CategorySLA` (`slaHoursByLevel`) | `(path, category, subcategoryL1)` | `slaHoursByLevel[currentLevel]` — `number` (hours) \| `null` | tuple maps to a row AND the level cell is a number | `CRS.CategorySLA.level` |
| Category per-state | `CRS.CategorySLA` (`slaHoursByState`) | `(path, category, subcategoryL1)` | `slaHoursByState.{new|triage|forwarded|investigation|awaiting|resolved}` — `number` (hours) \| `[min,max]` (range) \| `null` | tuple maps to a row AND the state cell is non-null | `CRS.CategorySLA` |
| Policy per-level default | `CRS.EscalationPolicy` (singleton `default`) | `singletonKey="default"` | `defaultSlaHoursByLevel[currentLevel]` → `number` (hours) | no usable CategorySLA cell | `CRS.EscalationPolicy.level` |
| Per-state default | `CRS.StateSLA` (singleton `default`) | `singletonKey="default"` | `stateDefaults.{...} → number` (hours) | category row missing or cell null, no policy level default | `CRS.StateSLA` |
| Legacy | `RAINMAKER-PGR.EscalationConfig` | singleton | `defaultSlaByLevel[currentLevel]` + per-`serviceCode` overrides | all of the above empty (backward-compat for not-yet-migrated deployments) | `v0.EscalationConfig` |
| State-name dictionary (supporting) | `CRS.WorkflowStateMapping` (singleton `default`) | `singletonKey="default"` | `mappings.{<workflowState>} → "new"\|"triage"\|"forwarded"\|"investigation"\|"awaiting"\|"resolved"` | every scan — read once, threaded into `resolveSlaHours` to translate the complaint's `applicationStatus` into the SLA-column key | n/a — not an SLA source |

The literal source-tag strings are defined in
[`PGRConstants.SLA_SOURCE_CATEGORY_LEVEL/CATEGORY/POLICY_LEVEL/STATE/V0`](../backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java).

> **Operator callout — seed order matters.** Seed
> `CRS.WorkflowStateMapping` **before** `CRS.StateSLA` and
> `CRS.CategorySLA`. Without the mapping, the scheduler cannot
> translate `applicationStatus` into the SLA-column key, emits
> `STATE_MAPPING_MISSING` for every candidate complaint, and falls all
> the way through to the v0 fallback regardless of how well populated
> the CRS layers are.

### Schemas

All six schemas live in
[`utilities/default-data-handler/src/main/resources/schema/CRS.json`](../utilities/default-data-handler/src/main/resources/schema/CRS.json):

| Schema | Introduced in | Role |
|---|---|---|
| `CRS.CategorySLA` | PR #770 (`slaHoursByLevel` added on `feat/escalation-prd-alignment`) | Per-tuple SLA rows: per-state cells + optional per-level cells |
| `CRS.StateSLA` | PR #770 | Per-state default SLA hours (singleton per tenant) |
| `CRS.SLAAuditLog` | PR #770 | Config-edit audit entries written by the configurator |
| `CRS.WorkflowStateMapping` | PR #775 | Workflow-state-name → canonical SLA-column-key dictionary (singleton) |
| `CRS.EscalationPolicy` | `feat/escalation-prd-alignment` ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)) | Tenant-wide escalation policy: max depth, per-level default SLAs, pre-breach warning config, comment rule, role-escalation opt-in (`roleEscalation`) (singleton) |
| `CRS.RoleSupervisors` | `feat/escalation-prd-alignment` ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)) | Optional explicit per-role escalation target — the R1 pin for [role-level escalation](#role-level-escalation-opt-in); one row per `(role, department)`, sentinel department `ALL` for the tenant-wide default |

Verbatim definitions with annotations:

#### `CRS.CategorySLA`

```json
{
  "tenantId": "{tenantid}",
  "code": "CRS.CategorySLA",
  "isActive": true,
  "definition": {
    "type": "object",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["path", "category", "subcategoryL1", "slaHoursByState", "isActive"],
    "x-unique": ["path", "category", "subcategoryL1"],
    "properties": {
      "path":          { "type": "string", "minLength": 1 },
      "category":      { "type": "string", "minLength": 1 },
      "subcategoryL1": { "type": "string", "minLength": 1 },
      "slaHoursByState": {
        "type": "object",
        "additionalProperties": true
      },
      "slaHoursByLevel": {
        "type": "array",
        "items": {}
      },
      "isActive": { "type": "boolean" }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

Annotations:

- `path` — **opaque** tenant-defined routing key. The scheduler treats it as a
  string, never an enum. (The original draft constrained it to `IGE`/`IGSAE`;
  see `_seed/fix-xref-schema.sql` for the recovery patch.)
- `category` / `subcategoryL1` — free-text strings. The configurator
  autocompletes from existing rows but does not constrain them; the constrained
  picker is roadmap **G1**.
- `slaHoursByState` — intentionally `additionalProperties: true` and **not**
  validated by JSON Schema. Cell-shape validation (`number | [min,max] | null`,
  bounds `0 < n < 8760`) is enforced application-side. The MDMS v2 validator
  throws `ClassCastException` on `oneOf` variants mixing number/array, so we
  cannot encode it declaratively.
- `slaHoursByLevel` (added on `feat/escalation-prd-alignment`, optional, not
  in `required`) — per-escalation-level SLA hours; index = escalation level
  (`[L0, L1, L2, ...]`). `items: {}` is deliberate: cells are
  `number | null` and the mdms-v2 validator chokes on `oneOf` unions the
  same way it does for `slaHoursByState`, so cell shape and bounds are
  enforced application-side (the property's JSON `description` in `CRS.json`
  says so — same precedent as `slaHoursByState`'s
  `additionalProperties: true`). A **zero or negative** entry is treated
  like `null` — it falls through silently to the next source. This is
  typo-safety (a stray `0` must not create an instantly-breached SLA) and
  matches the `0 < n < 8760` bounds already enforced on the state cells.
  Contrast: `CRS.StateSLA` defaults still honour an explicit `0` —
  pre-existing behaviour, unchanged. Tenants whose `CRS.CategorySLA` schema was
  registered before this property existed must apply the SQL patch
  [`_seed/add-sla-by-level.sql`](../configurator/src/resources/crs/sla-matrix/_seed/add-sla-by-level.sql)
  (mdms-v2 schema/v1 has no `_update`; same idempotent `jsonb_set` pattern
  as `fix-xref-schema.sql`, with a verification SELECT at the bottom).
- `x-unique` is `(path, category, subcategoryL1)` — duplicate tuples are
  rejected by MDMS at write time.

#### `CRS.StateSLA`

```json
{
  "code": "CRS.StateSLA",
  "definition": {
    "required": ["singletonKey", "stateDefaults"],
    "x-unique": ["singletonKey"],
    "properties": {
      "singletonKey": { "type": "string", "enum": ["default"] },
      "stateDefaults": {
        "type": "object",
        "required": ["new", "triage", "forwarded", "investigation", "awaiting", "resolved"],
        "properties": {
          "new":           { "type": "number", "minimum": 0, "maximum": 8760 },
          "triage":        { "type": "number", "minimum": 0, "maximum": 8760 },
          "forwarded":     { "type": "number", "minimum": 0, "maximum": 8760 },
          "investigation": { "type": "number", "minimum": 0, "maximum": 8760 },
          "awaiting":      { "type": "number", "minimum": 0, "maximum": 8760 },
          "resolved":      { "type": "number", "minimum": 0, "maximum": 8760 }
        },
        "additionalProperties": false
      }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

Annotations:

- `singletonKey` is a placeholder string fixed to `"default"`. It exists only
  to give the MDMS v2 validator a non-empty `x-unique` — otherwise the
  validator trips its own `ClassCastException`. See
  [`slaService#saveStateSla`](../configurator/src/resources/crs/sla-matrix/slaService.ts).
- The six state keys are the canonical CRS workflow states. The translation
  from a tenant's workflow state names (e.g. `PENDINGFORASSIGNMENT`) onto
  these six keys is operator-defined via `CRS.WorkflowStateMapping` (next
  subsection); the scheduler does not hardcode any tenant-specific names.

#### `CRS.WorkflowStateMapping`

```json
{
  "tenantId": "{tenantid}",
  "code": "CRS.WorkflowStateMapping",
  "isActive": true,
  "definition": {
    "type": "object",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["singletonKey", "mappings"],
    "x-unique": ["singletonKey"],
    "properties": {
      "singletonKey": { "type": "string", "enum": ["default"] },
      "mappings": {
        "type": "object",
        "additionalProperties": {
          "type": "string",
          "enum": ["new", "triage", "forwarded", "investigation", "awaiting", "resolved"]
        }
      }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

Example payload (Bomet/Nairobi PGR-style states):

```json
{
  "singletonKey": "default",
  "mappings": {
    "PENDINGFORASSIGNMENT": "new",
    "PENDINGATLME": "forwarded",
    "IN_TRIAGE": "triage",
    "FORWARDED": "forwarded",
    "UNDER_INVESTIGATION": "investigation",
    "AWAITING_INFORMATION": "awaiting",
    "RESOLVED": "resolved"
  }
}
```

Annotations:

- Singleton per tenant (`singletonKey="default"`). Same pattern as
  `CRS.StateSLA` — the placeholder key exists only to give the MDMS v2
  validator a non-empty `x-unique`.
- Values are constrained to the six canonical SLA-column keys
  (`new | triage | forwarded | investigation | awaiting | resolved`);
  the validator rejects anything else at write time.
- Keys are tenant workflow state names — opaque strings, matched
  case-sensitively against `applicationStatus` on the complaint.
- A workflow state with no mapping entry resolves to `null` in
  [`EscalationScheduler#mapWorkflowStateToKey`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java),
  which then trips the `STATE_MAPPING_MISSING` skip-reason path. With
  `stateKey` null the state-indexed layers are **guarded out** (the
  `stateKey != null` check protects both the CategorySLA per-state cell
  and the `CRS.StateSLA` lookup), so resolution goes straight to v0
  EscalationConfig — only the per-level sources, which don't need a
  state key, can still answer first. The unmapped state is surfaced in
  logs and on the OTEL span as
  `escalation.skipped.state_mapping_missing`.
- **Seed this before** `CRS.StateSLA` or `CRS.CategorySLA` — see the
  operator callout under "SLA + supporting layers" above.

#### `CRS.SLAAuditLog`

```json
{
  "code": "CRS.SLAAuditLog",
  "definition": {
    "required": ["timestamp", "userUuid", "userName", "action", "schemaCode", "recordIdentifier"],
    "x-unique": ["timestamp", "userUuid", "recordIdentifier"],
    "properties": {
      "timestamp":        { "type": "number" },
      "userUuid":         { "type": "string" },
      "userName":         { "type": "string" },
      "action":           { "type": "string", "enum": ["create", "update", "delete", "bulk-import"] },
      "schemaCode":       { "type": "string" },
      "recordIdentifier": { "type": "string" },
      "beforeJson":       { "type": "string" },
      "afterJson":        { "type": "string" },
      "reason":           { "type": "string" }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

Annotations:

- `x-unique` is `(timestamp, userUuid, recordIdentifier)` — concurrent edits to
  the same record by the same user are extremely unlikely to land in the same
  millisecond, and this scheme avoids collisions when bulk-import writes many
  audit rows.
- `beforeJson` / `afterJson` are serialised string snapshots (the schema does
  not nest objects so the audit log can be searched without paying for nested
  JSONB indexes).
- Audit-log entries are written **after** every successful MDMS data write —
  never before. A half-saved batch still produces a faithful audit trail of
  what actually landed.

#### `CRS.EscalationPolicy`

```json
{
  "tenantId": "{tenantid}",
  "code": "CRS.EscalationPolicy",
  "isActive": true,
  "description": "Tenant-wide escalation policy: max depth, per-level default SLAs (PRD complaint-type x level model), pre-breach warning config, manual-ESCALATE comment requirement. Singleton per tenant (uniqueIdentifier 'default'). All fields optional except singletonKey so tenants adopt incrementally; scheduler falls back to v0 RAINMAKER-PGR.EscalationConfig then static config when absent.",
  "definition": {
    "type": "object",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "CRS Escalation Policy",
    "required": ["singletonKey"],
    "x-unique": ["singletonKey"],
    "properties": {
      "singletonKey": { "type": "string", "enum": ["default"] },
      "maxDepth": { "type": "integer", "minimum": 1, "maximum": 10 },
      "defaultSlaHoursByLevel": {
        "type": "array",
        "items": { "type": "number", "minimum": 0, "maximum": 8760 }
      },
      "preBreachWarning": {
        "type": "object",
        "properties": {
          "enabled": { "type": "boolean" },
          "thresholdPercent": { "type": "number", "minimum": 1, "maximum": 99 }
        },
        "additionalProperties": false
      },
      "escalateCommentRequired": { "type": "boolean" },
      "roleEscalation": {
        "type": "object",
        "description": "Opt-in role-level escalation (PRD primary journey). enabled gates everything; actingRoleByState maps each watched workflow state to the role that owes action; supervisorRoleByRole is the role ladder for R2 resolution; maxPerScan caps role-escalations per scan (default 10 when absent).",
        "properties": {
          "enabled":              { "type": "boolean" },
          "actingRoleByState":    { "type": "object", "additionalProperties": { "type": "string" } },
          "supervisorRoleByRole": { "type": "object", "additionalProperties": { "type": "string" } },
          "maxPerScan":           { "type": "integer", "minimum": 1, "maximum": 100 }
        },
        "additionalProperties": false
      }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

Annotations:

- Singleton per tenant (`singletonKey="default"`) — same placeholder-key
  pattern as `CRS.StateSLA` and `CRS.WorkflowStateMapping`, for the same
  reason (the MDMS v2 validator needs a non-empty `x-unique`).
- **Every field except `singletonKey` is optional** — deliberate, so
  tenants adopt incrementally: a tenant can set only `maxDepth`, or only
  `escalateCommentRequired`, without committing to per-level SLAs. A
  tenant with **no** policy row behaves exactly as before this schema
  existed.
- **Fallback chain.** Each field has its own safety net: `maxDepth`
  falls back to v0 `EscalationConfig.maxDepth`, then the static
  `pgr.escalation.max.depth` property; `defaultSlaHoursByLevel`
  participates as step 3 of the [resolution
  precedence](#scheduler-resolution-algorithm); an absent
  `preBreachWarning` (or `enabled != true`) means no warnings; an absent
  `escalateCommentRequired` means the comment stays mandatory (today's
  behaviour).
- `defaultSlaHoursByLevel` index = escalation level: `[L0, L1, L2, ...]`
  hours. Unlike the CategorySLA cells these are plain numbers, so the
  schema *can* validate them declaratively (`number`, `0–8760`). At
  resolution time a **zero or negative** entry is ignored — it falls
  through silently to the next source, same typo-safety rule as the
  CategorySLA per-level cells. (The schema's `minimum: 0` admits a `0`,
  but the scheduler will not honour it; only `CRS.StateSLA`
  `stateDefaults` still honour an explicit `0` — pre-existing
  behaviour.)
- `roleEscalation` (added later on the same branch) — the opt-in gate and
  knobs for [role-level escalation](#role-level-escalation-opt-in). Absent
  or `enabled != true` ⇒ today's behaviour, **byte-identical** on the wire
  (pinned by a serialized-JSON key-set test). Field by field:
  - `actingRoleByState` — which role "owes action" in each watched
    workflow state, e.g.
    `{ "PENDINGFORASSIGNMENT": "GRO", "PENDINGATLME": "PGR_LME" }`.
    Explicit by design: deriving this from the workflow
    business-service's `state.actions[].roles` is not viable — every
    watched state also carries viewer/citizen/system roles, so "who owes
    action" is underivable without fragile role-class heuristics. (Same
    precedent as `CRS.WorkflowStateMapping`: an explicit operator
    dictionary replacing inference.) Using the business-service as a
    *validator* — a UI warning when a configured acting role does not
    appear in that state's action roles — was considered but descoped
    from the locked implementation; it is a noted follow-up, not shipped.
  - `supervisorRoleByRole` — the role ladder for R2 resolution, e.g.
    `{ "GRO": "PGR_SUPERVISOR" }`.
  - `maxPerScan` — blast-radius cap (default **10** when the object is
    present but the field absent); deferral and backlog-convergence
    semantics under [Review hardening](#review-hardening).
  - Schema change ⇒ idempotent SQL patch
    [`_seed/add-role-escalation.sql`](../configurator/src/resources/crs/sla-matrix/_seed/add-role-escalation.sql)
    for tenants whose `CRS.EscalationPolicy` schema was registered before
    this property existed (mdms-v2 schema/v1 has no `_update`; same
    `jsonb_set` precedent as `add-sla-by-level.sql`).
- **No `oneOf` anywhere** — the mdms-v2 validator throws
  `ClassCastException` walking `oneOf` unions (see the [operational
  gotcha](#egov-mdms-v2-validator-and-oneof-on-slahoursbystate)); this
  schema sticks to single-typed properties so it never trips that.

#### `CRS.RoleSupervisors`

```json
{
  "tenantId": "{tenantid}",
  "code": "CRS.RoleSupervisors",
  "description": "Explicit per-role escalation target (R1 pin). One row per (role, department); department ALL = tenant-wide default. assigneeUuid must be an active HRMS employee — validated at escalation time, stale pins fall through to the role ladder.",
  "isActive": true,
  "definition": {
    "type": "object",
    "title": "CRS Role Supervisors",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["role", "department", "assigneeUuid", "isActive"],
    "x-unique": ["role", "department"],
    "properties": {
      "role":         { "type": "string", "minLength": 1 },
      "department":   { "type": "string", "minLength": 1 },
      "assigneeUuid": { "type": "string", "minLength": 1 },
      "isActive":     { "type": "boolean" }
    },
    "x-ref-schema": [],
    "additionalProperties": false
  }
}
```

Example row:

```json
{ "role": "PGR_LME", "department": "DEPT_18", "assigneeUuid": "<uuid>", "isActive": true }
```

Annotations:

- Introduced on `feat/escalation-prd-alignment` ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815))
  — the optional **explicit pin** consulted first (R1) by
  [role-level escalation](#role-level-escalation-opt-in). Not an SLA
  source: it answers "*who* gets the complaint", never "*when*".
- `x-unique: ["role", "department"]`, both **required**. mdms-v2 rejects
  empty values inside a unique tuple (`UNIQUE_IDENTIFIER_EMPTY_ERR` in
  `CompositeUniqueIdentifierGenerationUtil`), so the tenant-wide default
  row uses the sentinel department **`"ALL"`** — never `""`.
- A pinned person can go stale (transfer, deactivation). The pin is
  therefore **validated at escalation time** against live HRMS: the
  target must resolve as an active employee (the escalate path already
  fetches the employee for the audit comment); a stale pin falls through
  to R2 and the outcome notes it.

### Scheduler resolution algorithm

[`EscalationScheduler#resolveSlaHours`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java)
in pseudocode:

```
SlaResolution resolveSlaHours(complaint, workflowState, crsCategorySla,
                              crsStateSlaDefaults, crsWorkflowStateMapping,
                              serviceCodeToCategory, crsEscalationPolicy,
                              currentLevel, defaultSlaByLevel, overrides):

    categoryTuple = extractCategoryTuple(complaint, serviceCodeToCategory)
    stateKey      = mapWorkflowStateToKey(workflowState, crsWorkflowStateMapping)
    unmapped      = (categoryTuple == null)

    # currentLevel = complaint.additionalDetail.escalationLevel
    # (0-based; absent => 0). Indexes the per-level arrays in steps 1 & 3.

    # ---- Step 1 + 2: CRS.CategorySLA row (level cell, then state cell) ----
    if categoryTuple and crsCategorySla:
        for row in crsCategorySla:
            if row.isActive == false: continue
            if row.path != categoryTuple.path: continue
            if row.category != categoryTuple.category: continue
            if row.subcategoryL1 != categoryTuple.subcategoryL1: continue

            # Step 1: per-level cell wins over the state cell.
            levelCell = row.slaHoursByLevel[currentLevel]
            if levelCell is a Number and levelCell > 0:
                # out-of-bounds / null / non-Number / zero / negative -> fall through silently
                return SlaResolution(levelCell*3600*1000, "CRS.CategorySLA.level", unmapped=false)

            # Step 2: per-state cell (needs a mapped state key).
            if stateKey:
                cell = row.slaHoursByState[stateKey]
                cellMs = cellToMillis(cell)   # number -> ms, [min,max] -> max*ms, null -> null
                if cellMs != null:
                    return SlaResolution(cellMs, "CRS.CategorySLA", unmapped=false)
            break   # row matched, no usable cell -> fall through

    # ---- Step 3: CRS.EscalationPolicy per-level default ----
    if crsEscalationPolicy:
        levelDefault = crsEscalationPolicy.defaultSlaHoursByLevel[currentLevel]
        if levelDefault is a Number and levelDefault > 0:
            # out-of-bounds / null / zero / negative -> fall through silently
            return SlaResolution(levelDefault*3600*1000, "CRS.EscalationPolicy.level", unmapped)

    # ---- Step 4: CRS.StateSLA ----
    if stateKey and crsStateSlaDefaults:
        defHrs = crsStateSlaDefaults[stateKey]
        if defHrs != null:
            return SlaResolution(defHrs*3600*1000, "CRS.StateSLA", unmapped)

    # ---- Step 5: v0 EscalationConfig ----
    log.info("falling back to v0 EscalationConfig srid=%s stateKey=%s", srid, stateKey)
    v0 = resolveSla(complaint.serviceCode, currentLevel, defaultSlaByLevel, overrides)
    return SlaResolution(v0, "v0.EscalationConfig", unmapped)
```

The `unmappedCategory` / `stateMappingMissing` semantics are unchanged
from PR #770/#775 — an out-of-bounds level index, a null entry, a
non-Number, or a **zero/negative** number in either per-level array
falls through **silently** to the next step; only category- and
state-mapping misses are counted and surfaced. Ignoring zero/negative
cells is typo-safety: a fat-fingered `0` must not produce an
instantly-breached SLA, and the rule mirrors the application-side
bounds already enforced on CategorySLA state cells (`0 < n < 8760`).
One pre-existing asymmetry to be aware of: `CRS.StateSLA`
`stateDefaults` still honour an explicit `0` (the schema allows
`minimum: 0` and the lookup only checks for null) — that behaviour
predates the per-level sources and is unchanged.

**Escalation level and depth.** `currentLevel` is read from the
complaint's `additionalDetail.escalationLevel` (0-based; a complaint
that has never escalated is at level 0) and is bumped by one on every
successful escalation. The depth ceiling has its own precedence:
`CRS.EscalationPolicy.maxDepth` → v0 `EscalationConfig.maxDepth` →
static `pgr.escalation.max.depth` property. The scheduler resolves it
once per scan and **passes the resolved value into**
[`EscalationService#escalateComplaintWithReason`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java)
— previously the service re-derived the ceiling from static config
only, so a tenant with a v0 `maxDepth` override could see the scheduler
and the service disagree about whether a complaint was at the ceiling;
threading the resolved value through fixes that divergence.

`extractCategoryTuple`:

```
extractCategoryTuple(complaint, serviceCodeToCategory):
    detail = complaint.additionalDetail
    if detail and detail.path and detail.category and detail.subcategoryL1:
        return { path, category, subcategoryL1 }       # Strategy A
    code = complaint.serviceCode
    if code and serviceCodeToCategory:
        return serviceCodeToCategory.get(code)         # Strategy B
    return null
```

`mapWorkflowStateToKey` — pure dictionary lookup over the operator-defined
`CRS.WorkflowStateMapping` singleton (no tenant-specific knowledge in code):

```
mapWorkflowStateToKey(workflowState, mapping):
    if workflowState == null or mapping == null:
        return null
    return mapping.get(workflowState)   # null if no entry → falls through
```

The mapping is fetched once per scan via
[`EscalationScheduler#fetchCrsWorkflowStateMapping`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java)
and threaded into `resolveSlaHours`. When a workflow state has no entry,
the scheduler sets `stateMappingMissing=true` on the `SlaResolution`; with
`stateKey` null the state-indexed steps are guarded out (`stateKey != null`),
so resolution goes straight to v0 unless a per-level source answers first.
The unmapped state is surfaced on the OTEL span
(`escalation.skipped.state_mapping_missing`) plus the
`STATE_MAPPING_MISSING` skip-reason counter. The hardcoded PGR-state switch
that used to live in this method was removed in PR #775.

Why each fallback condition exists:

- **Category miss but state matches.** The configurator allows operators to
  populate StateSLA before the per-category matrix is built out. Falling
  through gives a usable SLA even with zero CategorySLA rows.
- **No mapped state.** `CRS.WorkflowStateMapping` has no entry for the
  complaint's `applicationStatus` (e.g. a custom tenant state, or the
  singleton is unseeded). With `stateKey` null the state-indexed steps
  are **guarded out** (`stateKey != null` protects both the CategorySLA
  per-state cell and the `CRS.StateSLA` lookup), so resolution goes
  straight to v0 — only the per-level sources, which don't need a state
  key, can answer earlier — rather than refusing to escalate, and the
  resolution is tagged with `STATE_MAPPING_MISSING` so operators see an
  actionable warning.
- **`unmapped` flag.** Bubbled up even when v0 answers. The scheduler counts
  it in `skipBreakdown.UNMAPPED_CATEGORY` and logs a one-liner per scan so the
  operator knows the matrix is incomplete; the complaint is not skipped on
  that account.

### Pre-breach warnings

PRD requirement P2 asks for a warning **before** the SLA breaches, at a
configurable threshold. The detection half ships on
`feat/escalation-prd-alignment`; the delivery half is deferred.

**Config shape** — the `preBreachWarning` object on the
`CRS.EscalationPolicy` singleton:

```json
"preBreachWarning": { "enabled": true, "thresholdPercent": 75 }
```

Warnings are off unless `enabled == true`. `thresholdPercent` defaults
to **75** when absent (the PRD's default).

**Detection condition.** Evaluated in `scanAndEscalateOnce` after SLA
resolution and elapsed computation, **before** the breach check, as a
static package-private pure function (so it is unit-testable in
isolation):

```
shouldEmitPreBreach(elapsedMs, slaMs, thresholdPercent, intervalMs):
    thresholdMs = slaMs * thresholdPercent / 100.0
    return elapsedMs <  slaMs                        # not yet breached
       and elapsedMs >= thresholdMs                  # threshold crossed...
       and (elapsedMs - intervalMs) < thresholdMs    # ...since the previous tick
```

The third clause is the **stateless crossing detection**: the warning
fires only on the first scheduler tick after the threshold crossing, so
each complaint warns **once per escalation level** without any
persisted warning state (an escalation resets `lastModified`, so the
clock — and the one-shot — restart at the new level). The accepted
trade-off: if the scheduler misses the tick that spans the crossing
window (restart, downtime), that warning is silently lost.

Two further caveats of the stateless design:

- **Duplicate emission via manual trigger.** A manual non-`dryRun`
  `POST /escalation/_trigger` that lands inside the crossing window
  evaluates the same condition as the next cron tick — both can emit,
  so the same warning may go out twice. Consumers (the G5 delivery
  work) should dedupe on `(serviceRequestId, escalationLevel)`.
- **Tick drift.** The scheduler runs on `@Scheduled` with `fixedDelay`,
  so real tick spacing is *interval + scan duration*, not the bare
  interval. The crossing test assumes ticks exactly `intervalMs` apart;
  a crossing that falls inside the drift gap is missed the same way a
  restart/downtime gap misses it — this extends the missed-tick caveat
  above.

**Event.** On emit, the scheduler pushes to the Kafka topic
`pgr-escalation-prebreach` (`pgr.escalation.prebreach.topic` in
`application.properties`, surfaced via `PGRConfiguration`). The event
is pushed with the **complaint's (city) tenantId**, so per-tenant topic
prefixing behaves consistently with the escalation event:

```json
{
  "serviceRequestId": "...", "tenantId": "...",
  "escalationLevel": 0, "workflowState": "PENDINGATLME",
  "elapsedMs": 2754000, "slaMs": 3600000,
  "thresholdPercent": 75, "timestamp": 1780000000000
}
```

plus a structured `log.info` one-liner and the span attribute
`escalation.preBreachWarnings` (count, alongside
`scanned`/`escalated`/`skipped`). The `/escalation/_trigger` response
gains a `preBreachWarnings` int, and the complaint's
`SLA_NOT_BREACHED` outcome detail gains `"; prebreach warning emitted"`.

Emission is **suppressed entirely in `dryRun` mode** (see [Trace-back
tool](#trace-back-tool)) — a diagnostic call must not flood the topic.
Suppression applies to *emission only*: a dry-run scan still counts
complaints currently **inside the warning window**
(`elapsed ∈ [thresholdMs, slaMs)`, no crossing-window condition) in the
response's `preBreachWarnings`, so the Escalation Settings test scan can
show an "in warning window" count without having to land on the exact
crossing tick. The two meanings of the field: **live scan** = warnings
actually emitted this tick (crossing detection); **dry run** =
complaints currently inside the warning window.

**Delivery is deferred to roadmap G5.** The topic has no consumer yet;
routing to the current owner AND the supervisor over the per-role
channels the PRD asks for (email / SMS / WhatsApp) is the G5
notification-templates work — the event payload already carries
everything a consumer needs. Suppression after manual escalation is
**approximated** rather than strictly implemented: a manual ESCALATE
resets `lastModified` through the normal update flow but does not bump
`escalationLevel` (only the scheduler's auto path writes the level), so
the clock restarts and the same level may legitimately warn afresh in
the new window — by design. The PRD's strict
suppress-after-manual-escalation would need the business SLA clock,
which remains unmodeled (see P6 in [Requirements
traceability](#requirements-traceability)).
**Residual gap**: the PRD also allows disabling the warning per
workflow stage; only the global `enabled` flag exists today.

### Trace-back tool

The [`TraceBackDialog`](../configurator/src/resources/crs/sla-matrix/TraceBackDialog.tsx)
in the configurator is a dry-run diagnostic drawer. The operator pastes a
`serviceRequestId`, the dialog fans out:

1. `POST /pgr-services/escalation/_trigger` with `serviceRequestIds: [srid]`
   **and `dryRun: true`** — produces the scheduler's actual verdict + reason
   without mutating anything.
2. `POST /pgr-services/v2/request/_search` with the same SR id — pulls
   `applicationStatus`, `serviceCode`, the additionalDetail tuple.
3. Resolves a client-side SLA preview via the shared resolver
   ([`resolveSlaPreview.ts`](../configurator/src/resources/crs/sla-matrix/resolveSlaPreview.ts)),
   which mirrors the backend's five-step precedence **exactly** (first
   matching active row only, level cell → state cell → policy level
   default → state default → legacy; range cells collapse to MAX;
   null/zero/negative/out-of-bounds level entries fall through). The
   preview supplies per-source value annotations; the server's
   `slaSource` field on the verdict is the truth signal for which
   source actually won.

The drawer renders:

| Pane | Source | Shows |
|---|---|---|
| Scheduler verdict | `/escalation/_trigger` `details[0]` | `action` (incl. `WOULD_ESCALATE` on breached complaints), `reason` (e.g. `SLA_NOT_BREACHED`), `detail` (e.g. `elapsed=512908ms, sla=3600000ms`, or `would escalate to <uuid> (level N→N+1), ...`) |
| Complaint | `/v2/request/_search` | SR id, status, serviceCode, path, category, subcategoryL1 |
| Resolution path | server `slaSource` on `details[0]` + [`resolveSlaPreview.ts`](../configurator/src/resources/crs/sla-matrix/resolveSlaPreview.ts) | the six-row path (complaint-status-mapping gate + five SLA sources); the winner row highlighted from the **server's** `slaSource`, client-side value annotations labelled "estimated" wherever the client disagrees with the server winner |

> **Warning — `/escalation/_trigger` mutates unless told otherwise.** The
> endpoint executes **real escalations** (workflow ESCALATE transition,
> Kafka pushes, assignment change) unless the request body carries
> `dryRun: true`. The drawer always passes `dryRun: true`, so pasting a
> breached SR id is safe: `EscalationService#previewEscalation` runs the
> same lookups as a real escalation (max-depth check, HRMS supervisor
> lookup) with **zero mutations** and the verdict comes back as
> `WOULD_ESCALATE`. Operators scripting `/_trigger` directly (curl,
> runbooks) must add `"dryRun": true` themselves — a bare call on a
> breached complaint escalates it for real. Pre-breach warning emission
> is also suppressed in dry-run. Dry-run would-be escalations are
> reported in a separate `wouldEscalate` response field (and the
> `escalation.wouldEscalate` span attribute) — `escalated` stays `0` on
> a dry run.

Use case: an operator pages a citizen complaint that "should have escalated".
They paste the SR id into Trace escalation, see
`SLA_NOT_BREACHED elapsed=512908ms sla=3600000ms` and immediately understand
that the SLA for that category is set to one hour, not one minute. They open
the matrix, edit the cell, hit Save, and the next scheduler tick (≤5 min)
escalates the complaint.

### Audit log

This is the canonical description of the audit log; the configurator-UI
section below just renders these entries.

**Shape.** Each entry is one `CRS.SLAAuditLog` row written through MDMS
v2. Fields: `timestamp`, `userUuid`, `userName`, `action` (`create` |
`update` | `delete` | `bulk-import`), `schemaCode`, `recordIdentifier`,
`beforeJson`, `afterJson`, `reason`. See the schema definition above for
full annotations.

**Who writes them.** **Client-side, from the configurator only** — there
is no server-side audit hook on the MDMS write path. Every write to
`CRS.CategorySLA` or `CRS.StateSLA` from the SLA Matrix page — and, since
`feat/escalation-prd-alignment`, every write to `CRS.EscalationPolicy` or
`CRS.WorkflowStateMapping` from the Escalation Settings page — is followed
by a call to
[`slaService#writeAuditEntry`](../configurator/src/resources/crs/sla-matrix/slaService.ts).
Operators who write to MDMS directly (curl, python, dataloader) bypass
the audit log; the assumption is that direct writes are reviewed via
git on the seed scripts, not via the audit drawer.

**Write timing.** Always **after** the MDMS data write — never before.
A half-saved batch still produces a faithful audit trail of what
actually landed. The audit write is best-effort: if it fails, the MDMS
write has already landed, so a warning is logged and the data write is
not rolled back.

**What triggers entries.**

| Operation | When | Action enum | Granularity | slaService function |
|---|---|---|---|---|
| Inline row edit | after each successful row save | `create` (new row) or `update` | one entry per row | `saveCategoryRow` → `writeAuditEntry` |
| State-defaults edit | after the StateSLA singleton save returns | `create` or `update` | one entry | `saveStateSla` → `writeAuditEntry` |
| Soft-delete row | after the deactivation toggle returns | `delete` | one entry, reason `soft-delete via deactivation` | `deactivateCategoryRow` → `writeAuditEntry` |
| Bulk import | after the import-fan-out finishes | `bulk-import` | **one summary entry per import** plus one per-row entry per successfully-imported row, reason `<imported> rows imported, <failed> failed` | bulk-import handler → `writeAuditEntry` (summary) + `saveCategoryRow` per row |
| Escalation Settings — policy save | after the `CRS.EscalationPolicy` singleton save returns | `create` or `update` | one entry, recordIdentifier `policy` | `saveEscalationPolicy` → `writeAuditEntry` |
| Escalation Settings — status-mapping save | after the `CRS.WorkflowStateMapping` singleton save returns | `create` or `update` | one entry, recordIdentifier `state-mapping` | `saveWorkflowStateMapping` → `writeAuditEntry` |

This is escalation-specific scope today; a generic `CRS.ConfigAuditLog`
supersedes it in roadmap phase **G4** (see
[`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md) Cross-cutting
section).

### Escalation timeline and audit trail

The PRD (P7) requires every escalation to appear in the complaint's audit
trail with the **name of the recipient, designation, timestamp and
comments**, and the escalation entry to be visible in the complaint
timeline to both citizen and employee. This is satisfied by the
**workflow timeline**, not by `CRS.SLAAuditLog`:

- The auto-escalation's `ESCALATE` transition carries an **enriched
  comment** built by
  [`EscalationService#escalateComplaintWithReason`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java):
  `Auto-escalated to <name> (<designation>): SLA breached at level <N>
  (elapsed <X>h > SLA <Y>h)`. Name and designation come from one extra
  HRMS lookup per actual escalation
  ([`HRMSUtil#getEmployeeSummary`](../backend/pgr-services/src/main/java/org/egov/pgr/util/HRMSUtil.java)
  — escalations are rare, so the extra call is acceptable). The comment
  degrades gracefully across **three tiers** when the summary is
  partial: name + designation when both resolve, name alone when only
  the designation is missing, and finally the bare supervisor uuid when
  HRMS cannot resolve the employee at all — always with the same
  elapsed/SLA numbers.
- **Timestamp and acting user** come from the workflow `ProcessInstance`
  itself — the standard PGR audit fields; nothing extra is stored.
- The entry rides the **existing PGR workflow timeline**, rendered by
  both the employee and the citizen UI — which is exactly the PRD's
  "escalation entry in the complaint timeline visible to citizen and
  employee".
- The escalation Kafka event gains `newAssigneeName`,
  `newAssigneeDesignation`, `elapsedMs`, `slaMs` for downstream
  consumers.

**Do not confuse this with `CRS.SLAAuditLog`** (previous subsection):
that log records *configuration edits* made in the configurator (who
changed which SLA cell); the escalation timeline records what happened
to an individual complaint. The citizen **push notification** on
escalation — the other half of P7 — is deferred to roadmap **G5** with
the rest of the notification work.

---

## Role-level escalation (opt-in)

> **Status**: **Shipped** on `feat/escalation-prd-alignment`
> ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815))
> and live-verified on Bomet across the full resolution matrix — see
> [Verification](#verification). Opt-in: an absent or disabled
> `roleEscalation` config is **byte-identical** to the pre-feature
> behaviour, pinned by a serialized-JSON key-set test. This section is
> the consolidated home of the former satellite doc
> `docs/role-escalation-design.md` (now a redirect stub).

### Problem — the PRD's primary journey

The PRD's primary journey is a complaint that **no one owns**: a GRO
routes it without naming an assignee, every LME in the department sees
it in their role inbox, and nobody acts. Without this feature the
scheduler skips these with `NO_ASSIGNEES` — the PRD's main scenario
never escalates. PRD §1 requires: on breach, escalate to the role's
direct supervisor — **exactly one individual**, never a group; the
many-supervisors-across-departments case is explicitly TBD in the PRD;
and PRD p.11 warns that role↔department mapping is unreliable (role
names embed the department as a string, not a field).

### Design stance

1. **Opt-in.** Gated by the `roleEscalation` object on the
   `CRS.EscalationPolicy` singleton (schema + per-field annotations:
   [`CRS.EscalationPolicy`](#crsescalationpolicy)). Absent or
   `enabled != true` ⇒ today's behaviour, pinned by test.
2. **One individual.** Every resolution path ends in exactly one person
   or a specific, actionable skip reason. Never a role, never a
   tie-break the operator can't reconstruct.
3. **Deterministic and auditable.** Same data ⇒ same target, and the
   outcome records *which strategy* chose the person (see
   [Provenance](#provenance)).
4. **Honest about the upstream bug.** Eligibility is
   `getCurrentAssignees` returning empty — which reads the same
   `eg_wf_assignee_v2` table the upstream ASSIGN bug
   ([eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674))
   failed to populate. This feature does **not** sidestep that bug; it
   changes its failure mode (next subsection). The fix is now
   **deployed on current deployments** (Bomet runs
   `egov-workflow-v2:maven-jdk21-43f925c2`); it remains a hard
   prerequisite before enabling role escalation anywhere else.

### Interaction with the ASSIGN-persistence fix (#1674)

On a tenant whose workflow service predates the
[#1674](https://github.com/eGovStack/core-services/issues/1674) fix
(root cause + fix details: [Assignee-persistence upstream
bug](#assignee-persistence-upstream-bug)), complaints that **were**
assigned to a named person read as assignee-less. With role escalation
enabled, every one of them would be reclassified as "unattended" and
re-routed to the *role's* supervisor instead of the assignee's
supervisor — on pre-fix Bomet that was all ~55 open complaints,
escalated with a false "nobody picked this up" story. The
`history=true` fallback in `getCurrentAssignees` only covers the
self-loop quirk, not the missing-join-row case. Therefore:

- The prerequisite is **satisfied on current deployments** (the fix is
  live on Bomet) but enabling `roleEscalation` on any tenant whose
  workflow image predates it is a **misconfiguration**. The
  configurator's enable flow surfaces this as a warning, and the
  [rollout runbook](#rollout) orders the workflow-image upgrade first.
- Escalation comments are hedged to what the system actually knows:
  *"no **recorded** assignee"*, not "nobody picked this up".

### Configuration

Two MDMS surfaces, both defined verbatim — with full per-field
annotations — in the [Schemas](#schemas) section:

- **`roleEscalation`** — an optional object on the
  [`CRS.EscalationPolicy`](#crsescalationpolicy) singleton: `enabled`
  (the gate), `actingRoleByState` (which role "owes action" in each
  watched workflow state — an explicit operator dictionary, not
  inferred), `supervisorRoleByRole` (the R2 role ladder) and
  `maxPerScan` (blast-radius cap, default 10). Tenants whose policy
  schema predates the property apply the idempotent
  [`_seed/add-role-escalation.sql`](../configurator/src/resources/crs/sla-matrix/_seed/add-role-escalation.sql)
  patch.
- **`CRS.RoleSupervisors`** — the optional explicit pin
  ([schema](#crsrolesupervisors)): one active row per
  `(role, department)` naming the exact person consulted first (R1);
  the sentinel department `"ALL"` is the tenant-wide default row, and
  pins are validated against live HRMS at escalation time (stale ⇒
  fall through to R2).

### Resolution algorithm

Runs only when: the feature is enabled AND `getCurrentAssignees`
returned empty AND the complaint's SLA is breached. SLA resolution is
**completely unchanged** — the
[five-step cascade](#scheduler-resolution-algorithm) never needed an
assignee; only the escalate step gains a target.

1. `actingRole = actingRoleByState[applicationStatus]`
   → no entry ⇒ skip **`ROLE_NOT_MAPPED`**.
2. `department` = the complaint's `ServiceDefs.department` (extraction
   is new code — `buildServiceCodeMapping` previously kept only
   path/category/subcategoryL1; the raw response already carries
   department). May be null; it is only ever a *filter*, never
   required.
3. Resolve the target — first hit wins, each step memoized **per scan**
   keyed on `(tenantId, actingRole, department)` (resolution does not
   depend on the complaint, so a scan performs a handful of HRMS
   lookups, not one per complaint):
   - **R1 — explicit pin**: active `CRS.RoleSupervisors` row for
     `(actingRole, department)`, else `(actingRole, "ALL")`. The target
     must be an active HRMS employee; a stale pin ⇒ continue to R2.
   - **R2 — ladder**: applies when `supervisorRoleByRole[actingRole]`
     exists. HRMS search for employees holding that role with
     **`isActive=true`**, an explicit `limit`/`offset` (HRMS NPEs
     without offset), and candidacy restricted to employees whose
     **current assignment** (`isCurrentAssignment == true`) matches
     `department` when non-null. Exactly one candidate ⇒ target. More
     than one ⇒ skip **`ROLE_SUPERVISOR_AMBIGUOUS`**. Zero ⇒ retry
     without the department filter (same one-or-skip rule); zero again
     ⇒ skip **`NO_ROLE_SUPERVISOR`**. A configured ladder is
     authoritative: R2 exhaustion does **not** fall through to R3.
   - **R3 — reportingTo consensus**: applies only when no ladder entry
     exists for `actingRole`. Same HRMS predicate, but over holders of
     `actingRole` itself; collect their distinct non-null current
     `reportingTo` uuids. Exactly one ⇒ target; several ⇒
     `ROLE_SUPERVISOR_AMBIGUOUS`; none ⇒ `NO_ROLE_SUPERVISOR`.
4. Escalate exactly as the named-assignee path does today: `ESCALATE`
   self-loop transition with `assignes=[target]`, `escalationLevel++`,
   `lastModifiedTime` refresh (fresh clock, P6), enriched comment.
   After this the complaint HAS a named assignee — subsequent levels
   reuse the existing `reportingTo` path unchanged (the ladder
   converges into the shipped P3 machinery; no parallel escalation
   system).

#### Review hardening

Four behaviours hardened in adversarial review beyond the original
design, each pinned by unit tests (see
[Layer 1](#layer-1--backend-unit-tests)):

- **Tenant-keyed per-scan memoization.** One scan can span multiple
  city tenants; the memo key includes the tenant, so the same
  `(actingRole, department)` resolves independently per tenant — the
  cross-tenant cache-poisoning finding. Proven live by the r2r3
  suite's cross-tenant memo test (one scan, two tenants, two different
  targets).
- **HRMS truncation guard.** A raw HRMS page that comes back at the
  request limit may be truncated — an "exactly one candidate after
  filtering" verdict from such a page is unsafe and is never accepted;
  the lookup skips instead. **No exactly-one verdict from a truncated
  page.**
- **Tri-state HRMS lookups.** Found / genuinely-empty /
  transport-failure are distinguished. A transient HRMS blip
  skips-and-retries on a later scan — it is never memoized and never
  bypasses an operator pin (a pin whose validation *errored* must not
  silently fall through to R2 as if it were stale).
- **`maxPerScan` cap + backlog convergence.** At most N
  role-escalations per scan (default **10**); the rest are recorded as
  skips with detail `"deferred — maxPerScan reached"` and drain in
  subsequent scans — escalated complaints acquire a named assignee, so
  they leave the unattended pool and the backlog **converges**. This
  bounds the enable-on-a-backlog burst (a first scan could otherwise
  route up to 2×batch-size complaints to one supervisor) and the
  matching Kafka burst.

### Skip, don't guess

**On ambiguity we skip, not guess.** Arguments for picking
deterministically (round-robin, load-based) were considered: they keep
complaints moving. They lose because the misroute is invisible
(supervisor actions to hand a complaint back are not configurable yet —
P9), "why did X get this?" becomes unanswerable, and the data problem
the PRD itself marked TBD gets papered over. The skip is actionable:
the operator pins a `CRS.RoleSupervisors` row or fixes HRMS. Note the
same-department two-supervisors case is **our** conservative extension
of the PRD's cross-department TBD, not a PRD mandate. The
skip-don't-guess stance is only honest if recurring skips are visible —
see [Operator UI](#operator-ui-escalation-settings).

The three new skip reasons (enum 9 → 12; the full twelve-value enum is
in the [Glossary](#glossary) `skipReason` entry):

| Reason | Meaning | Operator fix |
|---|---|---|
| `ROLE_NOT_MAPPED` | watched state has no acting-role entry | add it in Settings |
| `ROLE_SUPERVISOR_AMBIGUOUS` | 2+ candidates matched | pin a person, or fix HRMS |
| `NO_ROLE_SUPERVISOR` | 0 candidates anywhere | create/activate the supervisor, or pin |

`NO_ASSIGNEES` remains the reason while the feature is disabled; its
plain-language explanation gains "enable 'Escalate complaints nobody
has picked up' under Escalation behaviour to act on these."

### Provenance

Every role-escalation outcome (`/escalation/_trigger` `details[]`
entry) and its Kafka event carry: `resolutionStrategy`
(`R1_PIN` | `R2_LADDER` | `R3_REPORTING`), `actingRole`,
`candidateCount`, `departmentFiltered` (bool — `false` when the
tenant-wide retry fired), plus the existing slaSource/level fields.
The same attributes land on the per-complaint `escalation.complaint`
OTEL child span — `escalation.roleEscalation` / `resolutionStrategy` /
`actingRole` / `candidateCount` / `departmentFiltered`, so provenance
survives multi-complaint scans (see the span-structure note in the
[Executive summary](#executive-summary)). The four provenance fields
are serialized `NON_NULL` at field level, so named-assignee and
disabled-tenant detail rows keep the exact pre-change wire format. The
audit comment reads: *"Auto-escalated (no recorded assignee): assigned
to %s (%s) — acting role %s%s"* with the department-fallback noted when
it fired. Without this, the moment HRMS data changes, "why did Subham
get this?" is unrecoverable.

### Concurrency

`@Scheduled(fixedDelay)` never overlaps itself, but
`/escalation/_trigger` runs the same scan concurrently with the cron.
A non-dry-run scan takes an in-process guard (atomic flag); a second
concurrent mutating scan returns HTTP 409 `SCAN_IN_PROGRESS` (dry runs
are unaffected). This is sufficient for the single-replica deployments
this stack targets; multi-replica would need a shared lock and is out
of scope.

Two live observations:

- The cron transitions under a **SYSTEM identity**, and current Bomet
  workflow builds accept its `ESCALATE` even at states whose action
  role lists do not grant it — so with `roleEscalation` enabled the
  background cron escalates unattended complaints autonomously,
  intended per the PRD. The behaviour is build-dependent and measured
  live, not assumed; details and the open upstream question are in the
  [SYSTEM transitions gotcha](#system-transitions-bypass-action-role-lists).
- E2E suites that reconfigure the production-shared
  `CRS.EscalationPolicy` singleton must be **serialized** — see
  [Verification](#verification) and
  [Testing methodology](#testing-methodology) rule 6.

### Operator UI (Escalation Settings)

The operator surface is part of the
[Escalation Settings page](#escalation-settings-page); only the
role-specific behaviour is described here.

- **Card 2 opt-in block**: checkbox *"Escalate complaints nobody has
  picked up"* → reveals per-watched-state acting-role selects (role
  list from ACCESSCONTROL-ROLES; the business-service mismatch warning
  is the descoped follow-up noted in the
  [`CRS.EscalationPolicy` annotations](#crsescalationpolicy)), the
  role→supervisor-role rows, max-per-scan, and *"Pin a specific person
  per role…"* (the `CRS.RoleSupervisors` editor: role, department or
  "All departments", HRMS employee picker).
- **Known limitation — pinning city-tenant employees**: the pin
  editor's employee look-up searches HRMS at the *page* (state) tenant,
  so an employee who exists only on a city tenant cannot be looked up —
  and therefore cannot be pinned — through the UI today. The failure is
  graceful ("No active employee found…", the Save-pin gate stays
  closed; asserted in the UI e2e spec). Until a tenant-scoped look-up
  ships, such pins are seeded via the API/MDMS (`CRS.RoleSupervisors`)
  directly.
- **Enable flow guardrails**: enabling prompts *"Run a test scan
  first"* (the dry-run twin `previewRoleEscalation` resolves through
  the same R1→R3 path, so `WOULD_ESCALATE` counts and provenance are
  exact); and warns when the tenant's workflow service predates the
  #1674 fix.
- **Verify card**: the three new skip reasons join the
  [Card 4](#card-4--check-your-configuration-the-verify-card)
  dictionary with the actionable copy above; recurring
  `ROLE_SUPERVISOR_AMBIGUOUS` counts are the operator's discovery
  signal (push alerting on recurring skips is a tracked follow-up —
  without some discovery path, skip-don't-guess would quietly recreate
  the rotting-complaint problem this feature exists to fix).

### Interim limitation: supervisor visibility

`ESCALATE` is a self-loop — the complaint stays in `PENDINGATLME` /
`PENDINGFORASSIGNMENT` with a new assignee. If the supervisor's roles
don't include those states' inbox roles, the complaint may not appear
in their default inbox view (search always works). This is the
deferred P5 (inbox-ownership semantics, upstream — item 10 in
[Open questions](#open-questions-and-deferred-work)). The
[rollout runbook](#rollout) includes a live check on the target
tenant; until P5 lands, supervisors find escalated items via
search/assigned-to-me views. Citizen notification on escalation
remains G5, same as named-assignee escalations.

### Verification

The central [Testing methodology](#testing-methodology) (pacing,
sentinels, snapshot/restore discipline, dry-run-first, fixture rules)
is binding for these suites too. Four live suites cover the matrix end
to end on Bomet:

| Suite | What it proves |
|---|---|
| [`pgr-escalation-full-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-full-flow.spec.ts) | The named-assignee baseline: tuple-scoped 15 s SLA, ASSIGN (#1674 regression read), dryRun → real escalation, OTEL trace from Tempo. |
| [`pgr-escalation-role-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-role-flow.spec.ts) | **R1** end to end (19/19 together with the full-flow spec): unassigned complaint + `GRO.ALL` pin → dryRun `WOULD_ESCALATE` with `R1_PIN` provenance → real escalation to the pinned supervisor → `escalation.complaint` child span asserted from Tempo. |
| [`pgr-escalation-r2r3-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-r2r3-flow.spec.ts) | **R2** exactly-one (real) and ambiguous (read-only skip), **R3** consensus (real) and split (skip), plus the cross-tenant memo proof (9/9) — one scan resolving the same acting role to different people on two city tenants. |
| [`escalation-settings-flow.spec.ts`](../configurator/e2e/escalation-settings-flow.spec.ts) | The operator journey through the real UI (6/6): enable → save (read-after-write) → dry-run test scan → pin-lookup limitation UX → disable, with API asserts on the exact persisted `roleEscalation` object. |

**Run cadence: serialize these suites.** All four snapshot/reconfigure
the production-shared `CRS.EscalationPolicy` singleton; the r2r3 spec
fails fast with an explicit CONCURRENT WRITER diagnostic when another
session touches the row mid-run. The R2/R3 and cross-tenant scenarios
run on the persistent fixture tenants `ke.etoeroles` / `ke.etoebeta`,
built create-or-verify-idempotently by
[`setup-role-fixture.mjs`](../tests/integration-tests/scripts/setup-role-fixture.mjs)
(re-run it for a no-op verify). The fixture layout, the safety
invariant (zero `E2E_*` holders at production `ke.bomet`) and per-suite
walkthroughs live in
[Layer 4 — Integration tests](#layer-4--integration-tests); the UI
spec's notes in [Layer 3](#layer-3--configurator-e2e-playwright); the
six role-escalation unit-test classes (module suite total 96) in
[Layer 1](#layer-1--backend-unit-tests).

### Rollout

1. Deploy a workflow image containing the #1674 fix — already live on
   Bomet (`egov-workflow-v2:maven-jdk21-43f925c2`); required before
   enabling anywhere else. Verify `eg_wf_assignee_v2` rows appear on a
   fresh ASSIGN.
2. Register/patch schemas
   ([`_seed/add-role-escalation.sql`](../configurator/src/resources/crs/sla-matrix/_seed/add-role-escalation.sql),
   [`CRS.RoleSupervisors`](#crsrolesupervisors)).
3. Configure mappings in Settings; run a dry-run scan; review
   `WOULD_ESCALATE` + provenance.
4. Enable with the default `maxPerScan`; watch the first scans drain
   the backlog gradually.

New-tenant seeding (CRSLoader / tenant bootstrap / Ansible) should
template the standard PGR mapping (`GRO`/`PGR_LME` → supervisor role)
so the PRD's primary journey is on-by-default for fresh tenants once
the feature has a deployment cycle of soak; existing tenants stay
opt-in.

### Out of scope (unchanged by this feature)

Inbox ownership transfer + N+1 visibility (P5/P11, upstream — item 10
in [Open questions](#open-questions-and-deferred-work)); pre-breach
*delivery* (G5); the business SLA clock (P6 second half — item 11
there); widening the watched-state list; multi-replica scan locking
(see [Concurrency](#concurrency)).

---

## Configurator UI

The escalation page is a **single-page editor** inside the existing
`digit-configurator` SPA. There is no separate list/show/edit triad
(react-admin's default pattern) because the matrix itself is the editor:
every cell is independently editable, the row is the unit of meaning,
and there is no per-row identifier worth surfacing in the URL.

### Information architecture

The sidebar gets a new top-level group called **ESCALATION** with three
siblings under it:

- **SLA Matrix** (`/manage/crs-sla-matrix`) — the matrix editor described
  in the rest of this section.
- **Escalation Settings** (`/manage/escalation-settings`) — the
  deployment-wide policy + complaint-status-mapping + test-scan page
  added on `feat/escalation-prd-alignment`, placed between SLA Matrix
  and Legacy SLA (nav key `app.nav.escalation_settings`). See
  [Escalation Settings page](#escalation-settings-page).
- **Legacy SLA (v0)** (`/manage/escalation-config`) — the v0
  `EscalationConfig` page, kept visible as a transition aid. It renders
  a deprecation banner pointing at SLA Matrix and is removed in the
  next major (see [v0 deprecation path](#v0-deprecation-path)).

![sidebar ESCALATION group with SLA Matrix and Legacy SLA (v0)](images/escalation/sidebar-escalation-group.png)

Route choice: `/manage/crs-sla-matrix` has no per-row id segment. The
row (path / category / subcategoryL1) is not a navigable resource —
it's a cell-set inside the matrix, and you address it by its three-tuple
inside the page, not by URL.

### Page anatomy

![populated SLA Matrix with toolbar, defaults row and grid](images/escalation/populated-state.png)

The page is structured top-to-bottom as:

- **Header** — page title, one-line explainer
  ("Per-category SLAs override the per-state defaults below."), and a
  **Trace escalation…** button top-right that opens the dry-run
  diagnostic drawer (see [Trace-back drawer](#trace-back-drawer-operator-debug-surface)).
- **Toolbar (row 1)** — **Path filter** (chips dynamically derived from
  whatever `path` values appear in the loaded rows; no enum), a
  **Search** input that filters by `category` / `subcategoryL1`
  substring, **Bulk import…** and **Add row** buttons on the right.
- **Toolbar (row 2)** — **Export CSV**, **Reload** (re-fetch from MDMS,
  warns if dirty), **Revert** (drop local edits, appears only when
  dirty), **Save changes** (disabled when clean, shows
  "N pending" badge when dirty), **Audit log** drawer trigger.
- **Defaults (StateSLA) strip** — a single row showing the per-state
  default SLA hours. When `CRS.StateSLA` is empty, this strip renders
  a "Not configured — set defaults" prompt instead of cell values
  (clicking opens the same defaults editor inline). When the policy
  singleton has deployment-wide level SLAs set, the strip renders an
  inline notice — "Deployment-wide level SLAs are set and take priority
  at levels L0–Ln for categories without their own levels — edit on the
  Escalation Settings page." (with a link) — so the cross-page
  precedence is visible exactly where the state defaults are edited.
- **Matrix grid** — sticky-left columns (`Path`, `Category`,
  `Subcategory L1`, `Active`) followed by a regular (non-sticky)
  **Levels** column and then six state columns: `NEW`, `TRIAGE`,
  `FORWARDED`, `INVESTIGATION`, `AWAITING`, `RESOLVED`. The Levels
  cell shows a compact per-escalation-level badge
  (`L0 120 · L1 48 · L2 24`, holes rendered as `—`, e.g.
  `L0 120 · L1 — · L2 24`) or, when unset/all-null, a muted `—` with a
  "+ levels" hover affordance; the column header carries the tooltip
  "hours per escalation level" and clicking a cell opens the shared
  level editor in a dialog. State cells render either a number, a
  range, or a muted dash for "use default" (see
  [Cell semantics](#cell-semantics)).
- **Empty state** — when no rows exist, the grid area is replaced by
  a full-bleed centered CTA (described below).

### UI states

The page is a small state machine driven by `(rowCount, dirty, modalOpen)`.
Each state has a screenshot and a corresponding affordance set.

**Empty** — no `CRS.CategorySLA` rows AND no `CRS.StateSLA` row. The
matrix area collapses into a centered call-to-action with two buttons:
"Bulk import from CSV" and "Edit defaults…". The toolbar's editing
controls (Save changes, Revert) stay disabled.

![empty state with centered CTA](images/escalation/empty-state.png)

**Populated** — one or more rows exist. The grid renders, sticky-left
columns stay visible while scrolling state columns horizontally. All
cells are clickable.

![populated grid](images/escalation/populated-state.png)

**Editing (cell active)** — clicking a numeric cell turns it into an
inline form: a single number input for scalars, or a number + range
checkbox + min/max inputs when "range" is toggled. Enter commits;
Escape cancels.

![cell in edit mode with number input](images/escalation/edit-cell.png)

**Dirty (unsaved changes)** — any commit to a cell or row toggles
`dirty=true`. The Save changes button enables and gains a "N pending"
badge, Revert appears, Reload warns before discarding. No dedicated
screenshot — the toolbar in `populated-state.png` shows the steady
("clean") state; in dirty mode the right-side cluster reads
**Revert · Save changes (N pending)**.

**Bulk-import preview** — the bulk-import modal opens with a preview
table showing each parsed row with a status icon and inline error
message. The footer button is dynamic: "Import 0 valid rows" while
errors exist, "Import N valid rows" once at least one row is clean.

![bulk import modal with preview table](images/escalation/bulk-import-preview.png)

**Trace-back drawer** — a right-side drawer opened from the header's
Trace escalation… button. Dry-run diagnostic over
`POST /escalation/_trigger` — the drawer always passes `dryRun: true`
(see below).

![trace-back drawer with diagnostic output](images/escalation/trace-back-drawer.png)

**Add-row form** — a modal opened from the toolbar's Add row button.
Three required string inputs (`path`, `category`, `subcategoryL1`),
optional initial values for each state column, an Active toggle
defaulting to true. Save creates the row in local state (still needs a
top-level Save changes to land in MDMS).

![add row modal form](images/escalation/add-row-form.png)

**Audit log drawer** — right-side drawer triggered from the toolbar's
Audit log button. Lists the most recent `CRS.SLAAuditLog` entries
across all actions (create, update, delete, bulk-import).

![audit log drawer entries](images/escalation/audit-log-drawer.png)

**v0 deprecation banner** — visible only when the operator visits the
legacy `/manage/escalation-config` page. Yellow banner pinned above the
v0 editor with a link to the new SLA Matrix and the removal-version
note.

![v0 deprecation banner on legacy page](images/escalation/v0-deprecation-banner.png)

### Cell semantics

Each cell in the matrix renders one of four states. The visual
distinguishes "explicitly set" from "falls through to default":

| Cell value | Visual | Meaning | Edit behaviour |
|---|---|---|---|
| number (e.g. `120`) | `120h` solid | Cell value drives scheduler SLA for this `(path, category, subcategoryL1, state)` | Click → number input |
| `[min, max]` range | `24–120h` solid | Scheduler uses MAX for math; UI shows the range so operators see the spread | Click → number + range checkbox + min/max inputs |
| `null` | `—` muted, faint "default: 48h" hint on hover | Falls through to `CRS.StateSLA[state]` | Click → number input (creating a value here promotes the cell to "explicitly set") |
| (no row at all) | n/a | Falls through to `CRS.StateSLA[state]`; if that is also empty, falls through to v0 hardcoded fallback | Add the row via the toolbar's **Add row** |
| `slaHoursByLevel` badge (Levels column) | compact `L0 120 · L1 — · L2 24` badge (holes as `—`); muted `—` with a "+ levels" hover affordance when unset/all-null | Levels with a number set here take priority over this row's state cells at that escalation level; blank (null) levels use the state cell — the badge's tooltip says exactly that | Click → Dialog with the shared level editor (holes allowed); each non-null entry validated `0 < n ≤ 8760` on Save changes, and the pending/revert flow deep-clones the array like any other cell edit |
| CSV encoding | n/a | empty=`null`, bare number=scalar (`120`), `"min-max"` single dash no spaces=range (`24-120`). Inclusive bounds `0 < n < 8760` for scalars and `0 < lo < hi < 8760` for ranges. | See [`csvParser#parseCell`](../configurator/src/resources/crs/sla-matrix/csvParser.ts) |

The "muted dash + default hint" treatment is deliberate: operators
should be able to scan the grid and instantly see which cells are
policy-overridden versus inherited from the per-state default.

> **Note — per-level cells are not in the CSV.** The optional
> `slaHoursByLevel` array on a CategorySLA row is **not** carried in the
> CSV import/export format — the columns above are state-indexed only,
> and the Export CSV button's tooltip says so ("Level SLAs are not
> included in the CSV."). Level SLAs are edited through the matrix's
> **Levels** column (dialog editor, since `feat/escalation-prd-alignment`);
> the MDMS API remains available for scripted writes.

### Empty-state UX

The empty state is intentionally not auto-seeded. SLAs are **policy**
— defaulting to magic numbers would silently commit the tenant to
values nobody chose. Instead, the empty state directs the operator
toward one of two explicit choices:

1. **Bulk import** the org's existing SLAs from a CSV (download the
   `example.csv` from the modal as a starter template), or
2. **Edit defaults…** to populate `CRS.StateSLA` first (six numbers,
   one per state), then add overrides incrementally as the org's
   categorisation matures.

Either path produces a visible audit-log entry. The page never writes
on the operator's behalf without an explicit save.

### Validation feedback

Validation runs in two layers: inline (per-cell, pre-save) and
batch (on save).

- **Per-cell** — invalid values highlight red with a tooltip
  explaining the rule: `SLA must be > 0 and < 8760` (≤ one year);
  if a range is used, `min < max`; the `(path, category, subcategoryL1)`
  triple must be unique among active rows.
- **Pre-save** — the Save changes button shows a `(N pending)` badge
  reflecting the number of rows touched. If any cell is invalid,
  Save changes stays disabled.
- **Save flow** — writes go through `slaService.persistChanges`,
  which fans out per-row MDMS updates. Writes are batched but **not
  transactional** across rows: if row K fails, rows 1…K-1 already
  landed. The UI catches this and shows a partial-success toast plus
  a per-row retry affordance on the failed rows.
- **Toasts** — success and error feedback use the existing global
  `<Toaster />` (sonner). Errors include the MDMS response body when
  the status is 4xx.

### Audit log

See [§Architecture → Audit log](#audit-log) for the canonical shape and
write semantics. The configurator drawer renders these entries with
timestamp, user, `action`, identifier
(`<path>/<category>/<subcategoryL1>` or `state-defaults`), and a JSON
diff for create/update entries.

### Trace-back drawer (operator debug surface)

The trace-back drawer is the answer to "why didn't this complaint
escalate?" — a question that previously required reading scheduler
logs.

Operator flow:

1. Open from the header's **Trace escalation…** button.
2. Paste a `serviceRequestId` from a stuck complaint, submit.
3. Drawer calls `POST /escalation/_trigger` **with `dryRun: true`** (see
   [`EscalationController`](../backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/EscalationController.java))
   and renders the per-complaint outcome: `serviceRequestId`, `action`,
   `reason`, `detail`, and `slaSource`. Note: since
   `feat/escalation-prd-alignment`, `slaSource` **is a response field**
   on every `details[]` entry (populated from the resolution that ran;
   `null` for `MAX_DEPTH_REACHED` / `NO_LAST_MODIFIED_TIME`, which skip
   before resolution) — an earlier revision of this doc said it was
   OTEL-only, which is no longer true. `fromAssignee` and `toAssignee`
   **remain** OTEL-only span attributes, visible on the trigger's trace
   in Tempo. A breached complaint comes back as `WOULD_ESCALATE`,
   rendered with the same success variant as `ESCALATED` and labelled
   "Would escalate"; in dry-run those are counted in the response's
   `wouldEscalate` field while `escalated` stays `0`.

**Resolution path.** Since `feat/escalation-prd-alignment` the dialog
renders the full six-row resolution path: the complaint-status-mapping
gate plus the five SLA sources, in precedence order. The **winner row is
highlighted from the server's `slaSource`** field whenever the trigger
call succeeded — server truth, never a client guess. The shared
client-side resolver
([`resolveSlaPreview.ts`](../configurator/src/resources/crs/sla-matrix/resolveSlaPreview.ts))
supplies the per-source value annotations, and any row where the client
disagrees with the server winner is labelled "estimated". The known
divergence case is Strategy-B tenants: the client mirrors tuple
extraction from `additionalDetail` only and cannot see the ServiceDefs
mapping, so when `additionalDetail` carries no tuple but the server says
a category source won, the dialog renders a note explaining the
discrepancy. On open the dialog loads the tenant status mapping, policy
and state defaults via `slaService`; when no tenant mapping exists it
shows a muted note — "using built-in status mapping — none configured" —
and falls back to the shared canonical table in
[`standardStateMappings.ts`](../configurator/src/resources/crs/sla-matrix/standardStateMappings.ts)
(the dialog's former local `STATE_TO_KEY` copy is deleted; the Settings
page's "Add standard complaint statuses" merge uses the same table).
The existing verdict and complaint panes are unchanged.

The endpoint **does mutate state when called without `dryRun`** — it runs
the full scheduler code path, real escalations included. The drawer
always sends `dryRun: true`, so it is safe on breached complaints: the
backend runs `previewEscalation` (same max-depth check and HRMS
supervisor lookup, zero mutations) and nothing changes — no workflow
transition, no Kafka push, no assignment change. Operators calling
`/_trigger` from scripts must pass `"dryRun": true` themselves to get
the same safety. This is the diagnostic surface for replacing
"did escalation work?" guesswork with "show me the per-complaint
decision and the SLA source that drove it."

### Bulk import workflow

1. Click **Bulk import…** in the toolbar; pick a CSV or XLSX file.
2. The modal renders a preview table. Each row has a status icon:
   `✓` for valid, `✗` for invalid with the parser/validator error
   inline. The footer button reads "Import N valid rows" and the count
   updates as the operator fixes the source file and re-uploads, or
   skips invalid rows.
3. Click **Import** → one bulk-import audit-log entry plus per-row
   `CRS.CategorySLA` writes via the same per-row fan-out as manual save.
4. Modal closes and the matrix reloads to show the new rows.

A **Download example.csv** link in the modal pulls
[`configurator/src/resources/crs/sla-matrix/_seed/example.csv`](../configurator/src/resources/crs/sla-matrix/_seed/example.csv)
as a starter template. The actual CSV format (verbatim from
[`_seed/example.csv`](../configurator/src/resources/crs/sla-matrix/_seed/example.csv)
and the
[`csvParser#parseCsv`](../configurator/src/resources/crs/sla-matrix/csvParser.ts)
column list) is:

```csv
path,category,subcategoryL1,subcategoryL2,sla_new,sla_triage,sla_forwarded,sla_investigation,sla_awaiting,sla_resolved
SAMPLE,General,Standard,Default issues,,,,72,,
SAMPLE,General,Urgent,Critical issues,,,,24,,
SAMPLE,Other,Misc,Catch-all,,,,168,,
```

10 columns. `subcategoryL2` is currently descriptive only — the parser
does not store it on `CategorySlaRecord` (it falls through as an
ignored column), but it is kept in the file so the seed is
human-readable and matches the matrix UI columns 1:1. The six
`sla_*` columns map to the canonical SLA-column keys via
[`csvParser#SLA_COL_KEYS`](../configurator/src/resources/crs/sla-matrix/csvParser.ts).
Cell encoding follows [Cell semantics](#cell-semantics) — an empty cell
is `null`, a bare number is a scalar, `"24-120"` (single dash, no
spaces) is a range. `Export CSV` round-trips the same format (minus
`subcategoryL2`) via
[`csvParser#recordsToCsv`](../configurator/src/resources/crs/sla-matrix/csvParser.ts).

### Escalation Settings page

Added on `feat/escalation-prd-alignment`: a single-page editor at
`/manage/escalation-settings` for everything escalation-wide that is not
a matrix cell — the `CRS.EscalationPolicy` singleton, the
`CRS.WorkflowStateMapping` singleton, and a verification surface over
the dry-run trigger. Like the matrix, it is built only from the existing
UI primitives (Dialog, native checkbox, the local `useToast` hook — no
new dependencies).

**Tenant scope.** All reads and saves — and the test scan — use the
**state-level tenant** (`stateTenant = tenant.split('.')[0]`), because
the scheduler and validator read the singletons at state level; a
city-tenant save would be a silent split-brain. The page header says so
in operator terms: "These settings apply to the whole deployment
(tenant: ke)."

**Setup banner.** When the status mapping is empty, a page-level warning
renders above the cards — "Complaint statuses aren't mapped yet —
per-state SLAs (the SLA Matrix) have no effect until you map them
below." — anchored to Card 3.

#### Card 1 — "How the SLA for a complaint is chosen"

A read-only rendering of the resolution precedence, opened by the
literal rule line: **"Checked top to bottom — the first source with a
value wins."** Six rows follow, each with a live chip computed from the
loaded data:

0. **Gate row** (distinct style) — "Complaint-status mapping", chip
   "N statuses mapped" or "not set — sources marked ⚠ below are
   inactive".
1. "Per-category level SLAs (SLA Matrix → Levels)" — chip "N rows",
   counting active rows with ≥1 entry > 0; links to the matrix.
2. "Per-category state SLAs (SLA Matrix cells)" — chip "N rows",
   counting active rows with ≥1 non-null state cell; when the mapping is
   empty the chip reads "⚠ blocked — statuses not mapped".
3. "Deployment-wide level SLAs (Card below)" — "set (L0–Ln)" / "not set".
4. "Deployment-wide state SLAs (SLA Matrix → Defaults row)" — "set" /
   "not configured"; same ⚠ blocked treatment when the mapping is empty.
5. "Previous SLA settings (Legacy page)" — "in use as final fallback";
   the chip shows the legacy level values when present (read from
   `RAINMAKER-PGR.EscalationConfig` via the existing escalation-config
   resource). Because the legacy layer always answers, it is **never
   rendered as a miss**.

*Gate-row rationale.* The status mapping is not an SLA source — but with
it empty, the two state-indexed sources are dead weight. Rendering the
mapping as row 0 with distinct styling makes that dependency visible
exactly where the operator reads the precedence, instead of leaving "my
matrix cells do nothing" to be discovered in production.

#### Card 2 — "Escalation behaviour" (the policy form)

- **Max escalation depth** (1–10). When unset, the helper reads "Not
  set — using the previous setting (N levels)", with N resolved from the
  legacy config's maxDepth, else 3.
- **Deployment-wide level SLAs** — the shared level editor inline, in
  policy mode (no blank levels; the MDMS schema types the entries as
  numbers, so holes are rejected at save). Helper: "Used when a
  complaint's category has no level SLAs of its own. Note: a category's
  state cells (SLA Matrix) also take priority over these for that
  category."
- **Pre-breach warning** — checkbox plus "Warn at __% of the SLA time"
  (1–99; placeholder 75, never eagerly written into the record). The
  helper states: "Warnings are recorded and visible in the test scan
  below. Notification delivery (SMS/WhatsApp/email) is not yet
  available."
- **Manual escalation** — checkbox "Require a comment when staff
  escalate manually", default checked (the backend default).
- **Role-escalation opt-in block** — the *"Escalate complaints nobody
  has picked up"* checkbox and the controls it reveals (acting-role
  selects, role→supervisor-role ladder rows, max-per-scan, the
  pinned-person editor); described with its guardrails and known
  limitation under
  [Operator UI (Escalation Settings)](#operator-ui-escalation-settings).
- **Save / Revert**, with read-after-write verification and a
  `CRS.SLAAuditLog` entry (recordIdentifier `policy`).

#### Card 3 — "Complaint-status mapping"

The `CRS.WorkflowStateMapping` editor. Table rows: a status-name text
input → an SLA-column select over the six keys, shown with operator
labels (New / Triage / Forwarded / Investigation / Awaiting info /
Resolved), plus a remove button. Status names get inline unique-name
validation — duplicates would otherwise collapse silently in the object
map. "Add a status" appends a row; "Add standard complaint statuses"
does a **non-destructive merge** from the canonical built-in table in
[`standardStateMappings.ts`](../configurator/src/resources/crs/sla-matrix/standardStateMappings.ts)
(existing entries are never overwritten). A help line notes: "The
escalation scan currently watches statuses PENDINGATLME and
PENDINGFORASSIGNMENT; other mappings are used by the complaint checker."
The empty state explains the consequence in operator terms — "Without
this mapping, per-state SLAs (matrix cells and the defaults row) are
ignored. Level SLAs still apply; complaints with neither use the
previous settings." — with `STATE_MAPPING_MISSING` as a muted code
badge. Save / Revert + read-after-write + audit entry (recordIdentifier
`state-mapping`).

#### Card 4 — "Check your configuration" (the verify card)

One button — **"Run a test scan (changes nothing)"** — POSTs
`/pgr-services/escalation/_trigger` with `{dryRun: true, tenantId:
stateTenant}` and renders **only the aggregate fields** (`scanned`,
`wouldEscalate`, `preBreachWarnings`, `skipped`, `skipBreakdown`);
`details[]` is deliberately ignored, since it can carry thousands of
entries. Five tiles:

- "Open complaints scanned" (`scanned`)
- "Would escalate now" (`wouldEscalate`)
- "In warning window" (`preBreachWarnings`)
- "Not due yet" (the `SLA_NOT_BREACHED` count)
- "Needs attention" (all other skip reasons summed)

Under "Needs attention", per-reason rows render the reason as a muted
code badge plus its count and a plain-language explanation from a static
dictionary; `UNMAPPED_CATEGORY` and `STATE_MAPPING_MISSING` are labelled
"advisory — complaint still processed".

**Tile overlap caveat.** The tile counts overlap — a complaint can be
both "not due yet" and "in warning window" — so the tiles do not sum to
`scanned`; the card's caption says so.

**Dry-run vs live `preBreachWarnings`.** On a live scan the field counts
warnings actually emitted this tick (stateless crossing detection); on a
dry run it counts complaints currently **inside** the warning window
(elapsed between threshold and SLA, no crossing condition). The dry-run
semantics are what make the "In warning window" tile meaningful in a
test scan that never emits anything (see
[Pre-breach warnings](#pre-breach-warnings)).

Error states are distinguished: a 403/UNAUTHORIZED response renders
"Your account needs the SUPERUSER role to run test scans."; a network
error or 404 renders "The scan service is unavailable." A "Check a
single complaint…" button opens the upgraded trace-back dialog
(imported), and the card shows the last-run timestamp.

#### Recent changes

A collapsible audit list at the bottom of the page, fed by the same
`CRS.SLAAuditLog` entries as the matrix drawer (via `loadAuditEntries`)
but filtered to `schemaCode ∈ (CRS.EscalationPolicy,
CRS.WorkflowStateMapping)`. The matrix page's audit dialog description
was updated to mention that settings changes appear there too.

#### Copy principles (binding for all operator-facing escalation copy)

- Operator copy **never** uses implementation jargon: no "singleton", no
  schema codes (`CRS.*`), no "fall through", no "v0", and no "dry-run" —
  the operator phrase is **"test scan (changes nothing)"**.
- Raw enum names (`STATE_MAPPING_MISSING`, `UNMAPPED_CATEGORY`, …)
  appear only as **muted code badges** next to a plain-language
  explanation — never inline in prose.
- The legacy layer is called "Previous SLA settings" and, because it
  always answers, is rendered as "in use as final fallback" — never as a
  miss or failure.
- These rules bind the matrix's Levels-column copy and the trace-back
  dialog equally, not just this page.

#### Read-after-write verification

Every singleton save re-fetches after ~1.5s and shows "Saved ✓ verified"
— or the warning "Saved but not yet visible — the data pipeline may be
delayed; reload in a few seconds." when the re-read does not yet reflect
the write. The persister-async 202 trap (see
[Operational gotchas](#persister-is-async-http-202)) has produced silent
config-write failures before; surfacing the verification result is a
hard requirement here.

### Sidebar grouping rationale

Escalation lives in its own ESCALATION sidebar group rather than under
"Complaint Management" because it is a **cross-cutting concern**:

- SLAs apply across complaint categories — the matrix is a policy
  surface, not a complaint admin tool.
- The trace-back drawer is a debugging tool for operators investigating
  scheduler behaviour, not a UI for handling complaints.
- Co-locating **SLA Matrix** (the new editor) and **Legacy SLA (v0)**
  (the deprecated editor) under one named group makes the deprecation
  handoff explicit: an operator opening Legacy SLA sees an obviously
  related sibling already waiting in the sidebar.

When the v0 page is removed, the ESCALATION group still makes sense as
the home for the Escalation Settings policy surface, trace-back tooling,
future policy extensions (e.g. holiday calendars), and any
cross-category SLA reporting.

### Accessibility and responsiveness

- **Keyboard navigation** — Tab / Shift-Tab move through cells in
  row-major order; Enter activates inline edit on the focused cell;
  Escape cancels the active edit without committing.
- **Semantic markup** — toolbar controls are real `<button>` elements
  with descriptive `aria-label` attributes; the matrix uses a real
  `<table>` (not a div grid); each header cell carries `scope="col"`
  and the sticky-left columns carry `scope="row"` on their `<th>`s.
- **Viewport** — the configurator is desktop-only (matching the rest
  of the app); the matrix targets a minimum viewport of 1280×800. No
  mobile or tablet layout is shipped — the matrix's six state columns
  plus four sticky-left columns do not fold cleanly to narrow
  viewports, and the operator persona is a desk-bound admin user.

---

## Tenant agnosticism

This is the load-bearing design property of PR #770. The schemas and the
scheduler are **deliberately tenant-agnostic**, and the implementation goes
out of its way to keep it that way:

- `path`, `category`, `subcategoryL1` are **opaque strings**. No enum coupling,
  no built-in list. The configurator chip set for the path filter is computed
  from whatever values appear in loaded rows
  ([`CategorySlaMatrixPage#distinctPaths`](../configurator/src/resources/crs/sla-matrix/CategorySlaMatrixPage.tsx)).
- `DEFAULT_STATE_DEFAULTS` is all-null
  ([`types.ts#DEFAULT_STATE_DEFAULTS`](../configurator/src/resources/crs/sla-matrix/types.ts)).
  Historically it carried a Mozambique-specific BRD §5.2 set
  (`new:0, triage:24, forwarded:48, investigation:120, awaiting:120, resolved:360`);
  that has been removed so the configurator does not lie about defaults the
  tenant has never set. The empty case renders an explicit "Not configured"
  prompt instead.
- The seed CSV ships generic `SAMPLE` rows
  ([`_seed/example.csv`](../configurator/src/resources/crs/sla-matrix/_seed/example.csv)).
  Operators substitute their own values; the same `import_csv` helper script
  works for any tenant.
- The `path` enum that initially restricted values to `IGE`/`IGSAE` has been
  stripped. The recovery SQL in
  [`_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql)
  drops the enum in place for deployments that hit the old shape (mdms-v2
  schema/v1 has no `_update` endpoint, so a DB UPDATE is the only path).
- **Workflow-state name mapping is operator-defined.** The translation
  from a tenant's workflow state names onto the six canonical CRS keys
  is configured via the `CRS.WorkflowStateMapping` MDMS singleton, not
  hardcoded.
  [`EscalationScheduler#mapWorkflowStateToKey`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java)
  is a pure `Map.get(workflowState)` lookup against that singleton — if
  a state has no entry, the lookup returns null, the scheduler marks
  the resolution as `stateMappingMissing=true`, the state-indexed steps
  are guarded out (`stateKey != null`), and the complaint resolves via
  the per-level sources or v0 EscalationConfig. The hardcoded
  PGR-state switch that previously lived in this method was removed in
  PR #775.

The implication: Bomet (Kenya, PGR), Nairobi (Kenya, PGR), and the future
Mozambique CRS deployment all run **the same code** and **the same schemas**.
They differ only in the rows they populate.

---

## Wiring strategies (tenant data → CategorySLA)

Two valid strategies for connecting a tenant's existing complaint data to the
CategorySLA lookup, both supported by
[`EscalationScheduler#extractCategoryTuple`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java).

### Strategy A — rich intake

The citizen intake form captures `path`, `category`, `subcategoryL1` on the
complaint and stores them on `additionalDetail`. Each new complaint carries
the tuple directly; the scheduler reads it on every scan.

| Property | Value |
|---|---|
| Best for | New deployments where the intake form is being built from scratch |
| Backend dependency | None — `additionalDetail` is already passed through unchanged |
| UI dependency | Submission Form Customization (**roadmap G8**) for the editor; until then the fields must be added to the form by hand |
| Migration risk | None for new complaints; pre-existing complaints have no tuple and fall through to Strategy B or the StateSLA layer |

### Strategy B — ServiceDefs extension

The tenant adds three optional extension fields (`path`, `category`,
`subcategoryL1`) to their existing MDMS `RAINMAKER-PGR.ServiceDefs` records.
At scan-time, the scheduler builds a `serviceCode → tuple` map via
[`EscalationScheduler#buildServiceCodeMapping`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java)
and resolves through it. The complaint's `serviceCode` is the join key.

| Property | Value |
|---|---|
| Best for | Existing deployments with legacy intake forms that already populate `serviceCode` |
| Backend dependency | None — fields are read from MDMS, no schema-version bump |
| UI dependency | Category Taxonomy editor (**roadmap G1**) for ergonomic management of the canonical category list |
| Migration risk | Low — adding fields to ServiceDefs is non-breaking; existing serviceCodes without the new fields silently aren't mapped |

### What happens if neither is wired

`extractCategoryTuple` returns `null` →
[`EscalationScheduler#resolveSlaHours`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java)
marks the resolution as `unmapped=true`, increments the
`skipBreakdown.UNMAPPED_CATEGORY` counter, and falls through to `CRS.StateSLA`.
The complaint **still escalates** if the StateSLA layer has a non-null value
for its current state. The `UNMAPPED_CATEGORY` warning is surfaced so the
operator can complete the mapping at their leisure without blocking escalation.

---

## v0 deprecation path

The legacy `RAINMAKER-PGR.EscalationConfig` editor stays for backwards
compatibility but is clearly marked deprecated.

1. **Side-by-side ship**. PR #770 lands the **SLA Matrix** (new) and **Legacy
   SLA** (v0) editors under the `ESCALATION` sidebar group in the configurator,
   with a deprecation banner on the v0 page. The Playwright spec
   [`crs-sla-matrix.spec.ts → 'banner is visible on /manage/escalation-config edit'`](../configurator/e2e/crs-sla-matrix.spec.ts)
   asserts the banner is visible.
2. **Migrate per-tenant**. Operators export their v0 config and either
   (a) re-enter the per-`serviceCode` overrides as CategorySLA rows, or
   (b) populate per-state defaults in StateSLA, which is often all that is
   needed. The CSV importer handles bulk migrations.
3. **Verify no v0 dependency**. Pull a per-tenant trace sample from Tempo:
   if no span has `escalation.slaSource = "v0.EscalationConfig"` over a
   representative window, that tenant no longer depends on v0.
4. **Delete in follow-up PR**. Once every supported deployment is verified
   clean, a follow-up PR deletes the v0 schema descriptor, the v0 editor,
   and the `resolveSla` (v0) fallback method. The empty v0 codepath is one
   `if`-branch in the scheduler — small and surgical.
   **Precondition**: before deleting v0, any tenant relying on it for
   `maxDepth` or per-level SLAs must have a `CRS.EscalationPolicy` row —
   the policy singleton is the post-v0 home for both (`maxDepth`,
   `defaultSlaHoursByLevel`). Without it, those tenants would silently
   drop to the static `pgr.escalation.max.depth` property and lose their
   per-level SLA table.

---

## Operational gotchas

Honest list of known traps. Anyone debugging an escalation issue should read
these first.

### x-ref-schema regression

**Symptom.** `POST /mdms-v2/v2/_create/CRS.*` returns HTTP 400 with
`org.json.JSONObject cannot be cast to org.json.JSONArray`, thrown at
`MdmsDataValidator.validateReference:140`.

**Root cause.** An earlier draft of `CRS.json` registered `x-ref-schema` as
`{}` instead of `[]`. mdms-v2 schema/v1 has no `_update` endpoint, so the
schema can't be re-uploaded.

**Fix.** Apply
[`_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql).
Safe to re-run; the WHERE clause skips already-fixed rows. The same script
also includes the `2026-06-09 follow-up` that drops the Mozambique-specific
`path` enum.

### Compose recreations knock egov-user into `Created`

**Symptom.** After re-creating `pgr-services` on Bomet (e.g. via Ansible
overlay swap), `digit-egov-user-1` is in `Created` state, not `Running`.
PGR creates fail with 500.

**Fix.** `docker start digit-egov-user-1`. The dependency graph is correct;
this is a Docker Compose v2 quirk where a non-graceful exit of a depending
service leaves the dependency in `Created`.

### mdms-v2 schema/v1 has no public `_update`

Schema definitions are write-once. Any broken schema shape can only be fixed
by a direct `UPDATE eg_mdms_schema_definition SET definition = ...`. Always
preserve `auditDetails` if doing this in production. See
[`_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql)
for the canonical pattern.

### MDMS write redelivery (Kafka → persister)

**Symptom.** A row you updated and read-verified reverts to an EARLIER
payload ~60–80 seconds later, with `lastmodifiedtime` advancing — an acked
write was REDELIVERED by the Kafka→`egov-persister` pipeline and re-applied
over your later write. Observed live during e2e cleanup on the
`CRS.EscalationPolicy` singleton.

**Implication.** "Write then verify once" is not a safe restore pattern on
this stack. Anything restoring shared config must re-read until the row is
stable across several reads spanning the redelivery window (the UI e2e
suite uses ≥3 consecutive stable reads over ≥120s).

### Persister is async (HTTP 202)

`POST /mdms-v2/v2/_update` returns 202 on success — the actual DB write
happens asynchronously via Kafka → `egov-persister`. Wait 3-5s before
re-reading. If the read still returns the old value:

- Check `egov-persister` container is up and the consumer group
  `egov-infra-persist` has 0 Kafka lag.
- If the persister died silently (it has happened — see Bomet history),
  every write returns 202 but nothing persists. Restart the persister and
  re-issue the write.

### Assignee-persistence upstream bug

> **ROOT CAUSE FOUND + FIXED (2026-06-11).** The workflow service persists
> assignees correctly — *when it receives them*. The API contract binds the
> field as `@JsonProperty("assignes")` (misspelled), and Spring's lenient
> deserialization silently drops the correctly-spelled `"assignees"` key that
> real clients (including our own E2E spec) send. Fix: `@JsonAlias("assignees")`
> on the field — deployed on Bomet as `egov-workflow-v2:maven-jdk21-43f925c2`
> (branch `fix/wf-assign-assignee-persistence`, based on the exact production
> commit). Verified live: ASSIGN with the `assignees` spelling now writes
> `eg_wf_assignee_v2` rows, and the escalation chain runs end-to-end with no
> manual SQL fixup. Upstream: corrected analysis posted on
> [eGovStack/core-services#1674](https://github.com/eGovStack/core-services/issues/1674).
> Sibling fixes in this repo: the E2E spec now sends the canonical `assignes`
> key; `pgr-services` `Workflow` accepts both spellings inbound. Remaining
> sibling (separate repo): the digit-ui-esbuild employee assign flow sends
> `assignes: null` when no employee is picked — picker fix tracked separately.
> The symptom text below is kept for historical context.

**Symptom.** On Bomet, `/escalation/_trigger` returns
`skipBreakdown: { NO_ASSIGNEES: 55 }` even though complaints have been
ASSIGNed. `SELECT * FROM eg_wf_assignee_v2 WHERE processinstanceid IN (...)`
returns 0 rows.

**Root cause.** DIGIT `egov-workflow-v2` ASSIGN action does not persist
assignees to `eg_wf_assignee_v2` — an upstream egov-workflow-v2 bug to be
raised against the workflow-v2 repo separately.

**Effect on the scheduler.** Without an assignee,
[`EscalationScheduler#scanAndEscalateOnce`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java)
trips at `NO_ASSIGNEES` and never reaches the SLA layer. This is why the
live Bomet scheduler shows `skipBreakdown.NO_ASSIGNEES` dominating.

**Workaround.** None on the CRS side — this needs an upstream fix in
`egov-workflow-v2`. The new `history=true` fallback in
[`EscalationService#getCurrentAssignees`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java)
recovers when the *current* `ProcessInstance` is empty but a historical one
carries assignees; it does nothing when the assignees were never persisted
in the first place.

**Not every `NO_ASSIGNEES` is this bug.** A complaint legitimately
sitting in a *role* inbox (all GROs / LMEs) with no named assignee trips
the same skip — and the PRD (P4) expects that complaint to escalate to
the role's direct supervisor. That portion of the `NO_ASSIGNEES` count
is a **requirements gap** (an open product decision, see
[Requirements traceability](#requirements-traceability)), not an
upstream defect.

### `egov-mdms-v2` validator and `oneOf` on `slaHoursByState`

We tried `oneOf: [number, [number, number], null]` in
`slaHoursByState.additionalProperties` and the validator threw
`ClassCastException` walking the schema. So the schema declares
`additionalProperties: true` and the application code (`cellToMillis` in
the scheduler; `parseCell` + the table-row validator in the configurator)
enforces shape and bounds. Schema-level validation will return only when
mdms-v2 stops choking on the union type.

### Trust boundary: `AUTO_ESCALATE` role

The mandatory-comment rule on manual `ESCALATE` is skipped when the
caller's `RequestInfo.userInfo.roles` on `/v2/request/_update` contains
`AUTO_ESCALATE` — that is how the scheduler's own transitions bypass it
(see `ServiceRequestValidator#validateEscalateComment`). The check
trusts **request-supplied** userInfo, which is safe only as long as the
gateway overrides caller-supplied `userInfo` with the authenticated
user's actual roles. Anything that reaches pgr-services directly —
VPC-internal callers, port-forwards — can self-assert the role and skip
the comment rule. Scope it correctly: this is an **audit-comment bypass
only**, not an authorization bypass — the workflow transition itself is
still permission-checked. The `/escalation/_trigger` endpoint is **not**
affected: it is gated on `SUPERUSER` before any role injection happens.

### SYSTEM transitions bypass action-role lists

**Symptom.** The escalation cron — which transitions under a `SYSTEM`
identity — successfully executes `ESCALATE` at workflow states whose
`actions[].roles` list only `GRO`/`AUTO_ESCALATE`/`PGR_VIEWER`, with no
`SYSTEM` anywhere. Confirmed live on the fixture tenants: the r2r3 e2e
suite's sentinel complaint was role-escalated by the background cron on
current Bomet even though the business-service grants the ESCALATE action
to none of the cron's roles. The behaviour has flipped across Bomet builds
(an earlier build rejected the same transition), so the suite measures it
live instead of assuming a branch.

**Implication.** With `roleEscalation` enabled, the background cron
autonomously escalates unattended complaints — intended per the PRD's
primary journey — but it means the workflow's per-state role lists are not
the gate you might assume for scheduler-driven transitions. Whether
`egov-workflow-v2` *should* honour SYSTEM transitions the state's role list
does not grant is an open question to raise upstream; until it is answered,
treat the role-grant model for cron transitions as build-dependent.

---

## Testing strategy

### Testing methodology

The rules below are not aspirations — each one was adopted after a concrete
failure in this project taught it. New escalation tests must follow them.

1. **Layered evidence, never a single test.** A claim of "working" requires:
   unit tests pinning the behavioral contract → a live e2e exercising the real
   stack → independent verification of the e2e's *artifacts* at layers that
   don't share a failure mode (API read + DB row + OTEL trace). Example: the
   #1674 fix was proven by the `_search` response, a `eg_wf_assignee_v2` row
   whose `createdby` showed it was an *organic* write (manual fixup rows are
   deliberately stamped `demo-fixup` so provenance is checkable), and the
   downstream escalation consuming it.

2. **A regression test must be shown failing without the fix.** New tests are
   run once with the fix stashed/reverted; if they pass anyway they prove
   nothing (the `@JsonAlias` round-trip tests fail 2/4 without the alias; the
   jargon-ban scanner was calibrated against deliberately seeded violations).
   The `tempo.ts` helper passed for weeks while returning null on every call —
   a test that cannot fail is worse than no test.

3. **Determinism over speed.** Test SLAs are ~15s, waits before triggering a
   full 60s, async-persister settles 10s, and suite timeouts assume 10+
   minutes. A tight margin (7s SLA, 10s wait) trades flakiness for speed —
   the wrong trade everywhere, and especially against a live stack.

4. **Surgical test configuration, never global.** SLA overrides are seeded as
   a dedicated `CRS.CategorySLA` tuple that only the test's complaints carry —
   never by patching the shared v0 config (a global 60s SLA plus an unlucky
   cron tick escalates the whole tenant). Same principle for role escalation:
   fixture role codes (`E2E_*`) have **zero holders in production tenants**,
   so an enabled test window resolves production complaints to a harmless
   `NO_ROLE_SUPERVISOR` skip — blast radius limited *by construction*, and the
   suites assert that invariant before running.

5. **Live interference is measured, not assumed.** The background cron runs
   the same code path every 300s. Suites anchor its phase with a *sentinel*
   complaint (observe the cron acting on a sacrificial twin → a quiet window
   opens for the real scenario) and treat the cron's capability (mutating vs
   rejected) as a **measured branch**, not a constant — it has flipped across
   builds on this stack.

6. **Shared-state discipline.** Anything touching the production-shared
   `CRS.EscalationPolicy` singleton must: snapshot before, restore
   byte-identically after (even on failure), and verify the restore with
   **≥3 stable reads spanning ≥120s** — the MDMS pipeline has redelivered an
   acked write ~60–80s after a verified restore (see Operational gotchas).
   Escalation suites are serialized; the r2r3 spec re-reads the live policy
   before every trigger and fails fast with a concurrent-writer diagnostic
   (two suites once clobbered each other mid-run).

7. **Dry-run before real.** Every mutating scenario is first asserted via
   `dryRun:true` — including a zero-mutation proof (re-read both state layers
   after the dry run). Skip scenarios (ambiguity, not-mapped) are asserted
   *only* via dry runs, since skips are read-only by definition.

8. **Fixtures are reproducible code, not snowflakes.** The role fixture is an
   idempotent script (`scripts/setup-role-fixture.mjs`): search-first,
   poll-until-visible, re-run = no-op verify. Specs re-resolve every uuid from
   HRMS at runtime — nothing hardcoded — and skip with a pointer to the setup
   script when the fixture has drifted.

9. **Before/after differentials for bug fixes.** A fix's live proof holds the
   stack constant and changes one variable (the morning run needed a manual
   SQL fixup; the evening run, same request shape and same stack with only the
   image changed, needed none).

10. **Honest residue accounting.** Every suite logs SRIDs for traceability,
    documents what it leaves behind (test complaints persist; workflow history
    is append-only), and the run report states what was *not* covered rather
    than letting a green suite imply totality.

Process-level: implementation changes go through adversarial review before
deploy (independent reviewers attempt to refute each finding; three of the
role-escalation majors — cross-tenant cache poisoning, HRMS truncation, wire-
format drift — were caught this way, before production), and agent-reported
results are independently re-verified before being claimed (re-run the suite,
or verify its artifacts read-only when re-running would mutate production).

### The five layers

Five layers, top-down.

### Layer 1 — Backend unit tests

Plain JUnit + Mockito with package-private access, all under
[`backend/pgr-services/src/test/java/org/egov/pgr/`](../backend/pgr-services/src/test/java/org/egov/pgr/):

| Test class | Tests | What it pins |
|---|---|---|
| [`EscalationSchedulerSlaResolutionTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java) | 8 | The 4 original resolution transitions — category hit (`source == CRS.CategorySLA`), `[24,120]` range collapses to MAX (`120 * 3600 * 1000 ms`), null cell falls to StateSLA, v0 fallback when CRS empty and unmapped (`unmapped=true`) — plus 4 level-precedence tests: a row-level cell beats the row's state cell; the policy level default wins per the exact step 1–5 ordering; an out-of-bounds level index falls through to the state cell; a null entry in `slaHoursByLevel` falls through. |
| [`EscalationSchedulerStateMappingTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerStateMappingTest.java) | 3 | `mapWorkflowStateToKey` dictionary semantics (PR #775): mapped state returns its key; unmapped state returns null; null/absent singleton returns null. |
| [`EscalationSchedulerPreBreachTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerPreBreachTest.java) (new) | 5 | The `shouldEmitPreBreach` pure function: below threshold → no; first tick after crossing → yes; second tick after crossing → no; past SLA → no; `thresholdPercent` honoured. |
| [`EscalationServiceTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationServiceTest.java) | 8 | 6 existing escalation-action tests + 2 PRD-alignment tests: `previewEscalation` performs zero producer pushes and zero workflow updates (mock-verified) while still returning the supervisor uuid; the enriched comment includes name + designation when the HRMS summary resolves (captured `Workflow` arg). |
| [`ServiceRequestValidatorTest`](../backend/pgr-services/src/test/java/org/egov/pgr/validator/ServiceRequestValidatorTest.java) | 15 | 14 existing + 1 new; 5 of the 15 cover the escalate-comment rule, including the new one — `escalateCommentRequired=false` policy allows a blank comment (mocked MDMS fetch path). |

Role-level escalation adds six more classes (suite total **96**):

| Test class | Tests | What it pins |
|---|---|---|
| [`EscalationServiceRoleResolverTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationServiceRoleResolverTest.java) | 18 | The R1→R2→R3 resolution: pin hit, department row beats `ALL`, stale pin falls through, R2 exactly-one / two-→`AMBIGUOUS` / zero-→retry / zero-zero-→`NO_ROLE_SUPERVISOR`, a configured ladder never falls to R3, R3 consensus and split, **tenant-keyed memoization** (two tenants sharing a key get two HRMS searches and distinct targets), **truncation guard** (a 100-row HRMS page can never yield an exactly-one verdict), and **transient-failure semantics** (an HRMS blip skips-and-retries instead of bypassing an operator pin, and is never memoized). |
| [`EscalationServiceRoleEscalationTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationServiceRoleEscalationTest.java) | 8 | `escalateToRoleTarget`: exact comment template, Kafka event provenance, clock reset, department-fallback comment, uuid fallback, workflow rejection, max-depth, `previewRoleEscalation` zero mutations. |
| [`EscalationSchedulerRoleWiringTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerRoleWiringTest.java) | 7 | The byte-identical-when-disabled pins (incl. a **serialized-JSON key-set assertion** so the wire format on disabled tenants cannot drift), `ROLE_NOT_MAPPED`, `maxPerScan` deferral, dryRun parity with provenance, real escalation to the resolved uuid. |
| [`EscalationSchedulerGuardTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerGuardTest.java) | 2 | The scan-overlap guard: a concurrent mutating scan throws `SCAN_IN_PROGRESS` (and the guard releases); dry runs bypass it. |
| [`HRMSUtilRoleSearchTest`](../backend/pgr-services/src/test/java/org/egov/pgr/util/HRMSUtilRoleSearchTest.java) | 8 | `searchEmployeesByRole` raw-page truncation detection before filtering, transport-failure vs genuinely-empty distinction, `isActiveEmployee` tri-state. |
| [`EscalationControllerTest`](../backend/pgr-services/src/test/java/org/egov/pgr/web/controllers/EscalationControllerTest.java) | 3 | `SCAN_IN_PROGRESS` → HTTP 409 with a `{code, message}` body; other `CustomException`s propagate; happy path 200. |

On top of those, the scheduler **dryRun test**
([`EscalationSchedulerDryRunTest`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerDryRunTest.java))
pins the trigger contract:
`scanAndEscalateOnce(..., dryRun=true)` on a breached complaint records
`WOULD_ESCALATE` and `escalationService.escalateComplaintWithReason` is
never invoked.

- **Run.**

  ```bash
  cd backend/pgr-services && mvn test   # 96 tests — these classes are the module's entire suite
  ```

- **Why these.** They pin every transition in the resolution algorithm
  (happy path, range collapse, each fall-through, the level/state
  precedence), the pre-breach crossing detection in isolation, and the
  two mutation contracts (preview = zero side effects; dryRun = no
  escalation call). Anything else is a combination of these.

### Layer 2 — MDMS shape validation

There is no test framework around mdms-v2 schema registration itself — the
validator is opaque and tightly coupled to a live Postgres. What we do have:

- The schema files are checked in
  ([`utilities/default-data-handler/src/main/resources/schema/CRS.json`](../utilities/default-data-handler/src/main/resources/schema/CRS.json)).
  Any change goes through code review.
- [`_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql)
  doubles as a regression script. An operator who hits the
  `ClassCastException` symptom applies it and recovers; the SELECT at the
  bottom of each block reports the fixed state.
- Pre-go-live grep: an operator should run

  ```sql
  SELECT code FROM eg_mdms_schema_definition
   WHERE code LIKE 'CRS.%'
     AND definition->'x-ref-schema' = '{}'::jsonb;
  ```

  on their target before relying on CRS schemas. Empty result = clean.

### Layer 3 — Configurator e2e (Playwright)

> **Mutating sibling**: [`configurator/e2e/escalation-settings-flow.spec.ts`](../configurator/e2e/escalation-settings-flow.spec.ts)
> drives the REAL operator journey — enable role escalation through the UI
> (acting role, ladder, max-per-scan), Save with the read-after-write toast,
> API-assert the exact persisted object, run the test scan from the Verify
> card, disable, restore. Run it file-scoped (it mutates the shared policy
> row and must not run concurrently with the lifecycle escalation suites).


- **File.** [`configurator/e2e/crs-sla-matrix.spec.ts`](../configurator/e2e/crs-sla-matrix.spec.ts)
- **Coverage** (5 tests across 2 describes):
  - Header + toolbar + matrix rows render
  - Trace escalation drawer renders structured outcome
  - SLA Matrix is present in the ESCALATION sidebar group
  - Legacy SLA editor still present (deprecation co-exists)
  - v0 EscalationConfig deprecation banner visible at `/manage/escalation-config edit`
- **Run against any deployment.**

  ```bash
  E2E_BASE_URL=https://bometfeedbackhub.digit.org \
  E2E_USERNAME=ADMIN \
  E2E_PASSWORD=eGov@123 \
  E2E_TENANT=ke \
    npx playwright test --config e2e/playwright.config.ts e2e/crs-sla-matrix.spec.ts
  ```

- **Escalation Settings e2e** (`feat/escalation-prd-alignment`):
  [`configurator/e2e/escalation-settings.spec.ts`](../configurator/e2e/escalation-settings.spec.ts)
  — read-only against a live deployment: the page renders its setup
  banner or cards, Card 1 shows the six cascade rows, the Card 3
  status-mapping table renders, and the test-scan button is visible.
  The matrix spec is extended with a Levels-column-header assertion.
- **Unit (vitest).**
  [`configurator/src/resources/crs/sla-matrix/csvParser.test.ts`](../configurator/src/resources/crs/sla-matrix/csvParser.test.ts)
  covers the CSV parser in isolation (picked up by the standard
  `src/**/*.test.ts` vitest glob): the `subcategoryL1` header in every
  casing (`subcategoryL1`, `SUBCATEGORYL1`, `subcategoryl1` — pinning the
  header-canonicalisation fix), an export → import round-trip via
  `recordsToCsv` → `parseCsv`, range cells (`"24-120"` → `[24,120]`),
  empty cell → `null`, and a missing required column still erroring.
  `feat/escalation-prd-alignment` adds
  [`resolveSlaPreview.test.ts`](../configurator/src/resources/crs/sla-matrix/resolveSlaPreview.test.ts),
  mirroring the backend's resolution test vectors against the shared
  client resolver (row-level beats row-state; policy level beats state
  default; null/0/out-of-bounds level entries fall through; range
  collapse uses MAX including reversed pairs like `[120,24]`;
  first-matching-row break; no mapping → state sources skipped, level
  sources still hit), plus value-logic tests for the shared level
  editor's pure helpers and a shape test for `standardStateMappings`.
- **Why this layer.** The configurator is the only operator-facing entry
  point; if the page can't render or the deprecation banner doesn't show,
  no amount of correct backend behaviour helps.

### Layer 4 — Integration tests

> **Test fixture.** The role-resolution scenarios run against two
> persistent fixture tenants on the Bomet box — `ke.etoeroles` /
> `ke.etoebeta` (egov-user rejects any digit in a tenantId, hence not
> `ke.e2e…`) — with fixture-only roles
> `E2E_SUP1`/`E2E_SUP2`/`E2E_ROLE3`/`E2E_ROLE4` at root `ke` and eight
> employees laid out to exercise every resolution path. The safety
> invariant that makes the suites runnable against production: those role
> codes have **zero holders at `ke.bomet`**, so any production complaint
> reaching the role path during an enabled window terminates in a
> read-only `NO_ROLE_SUPERVISOR` skip. The fixture is built
> (create-or-verify, idempotent) by
> [`scripts/setup-role-fixture.mjs`](../tests/integration-tests/scripts/setup-role-fixture.mjs)
> — re-run it for a no-op verify.

- **Files.**
  - [`tests/integration-tests/tests/lifecycle/pgr-escalation-r2r3-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-r2r3-flow.spec.ts)
    — all five role-resolution scenarios against the persistent
    multi-holder fixture (built by
    [`scripts/setup-role-fixture.mjs`](../tests/integration-tests/scripts/setup-role-fixture.mjs)
    on the fixture tenants `ke.etoeroles`/`ke.etoebeta`): R2 exactly-one
    (real), R2 ambiguous (dryRun), R3 consensus (real), R3 split (dryRun),
    and the **cross-tenant memo proof** — one scan over both tenants
    escalates each complaint to its own tenant's `E2E_SUP1` holder.
    Pre-flight hard-verifies the safety invariant (zero `E2E_*` holders at
    production `ke.bomet`) and refuses to run if another suite holds the
    shared policy row (concurrent-writer guard).
  - [`tests/integration-tests/tests/lifecycle/pgr-escalation-role-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-role-flow.spec.ts)
    — the role-escalation full-flow E2E: snapshots the live
    `CRS.EscalationPolicy` row (restores it byte-identically in cleanup,
    verified), seeds a tuple-scoped 15s SLA + `roleEscalation`
    (acting role `GRO`, `maxPerScan` 10) + a `GRO.ALL` pin, files an
    **unassigned** complaint, dryRuns (`WOULD_ESCALATE` with `R1_PIN`
    provenance), escalates for real to the pinned supervisor with the
    *"Auto-escalated (no recorded assignee)"* comment, and asserts the
    OTEL trace from Tempo — parent scan span `escalation.roleEscalated`
    plus the parent-linked `escalation.complaint` child span carrying
    `roleEscalation`/`resolutionStrategy`/`slaSource`. Both this spec and
    the full-flow spec end with a Tempo trace assertion (the trace-id
    extraction helper in `tests/utils/tempo.ts` was repaired in the same
    change — it had never worked due to a shell-quoting bug).
  - [`tests/integration-tests/tests/lifecycle/pgr-escalation-full-flow.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-full-flow.spec.ts)
    — the canonical full-flow E2E: seeds a test-scoped `CRS.CategorySLA` row
    (per-level SLA ≈15s for a dedicated tuple — never touches the global v0
    config, so it is cron-safe), calibrates the live cron phase with a
    sentinel complaint, then runs citizen-create (Strategy-A tuple) → ASSIGN
    (canonical `assignes` key; the #1674 regression read) → 60s elapse →
    dryRun preview (`WOULD_ESCALATE`, `slaSource=CRS.CategorySLA.level`,
    zero mutations) → real escalation → post-conditions (status flip,
    `escalationLevel=1`, SLA-clock reset, supervisor PI + enriched comment),
    and deactivates the seeded row in cleanup. Generous pacing by design
    (~3-5 min): determinism over speed.
  - [`tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts)
    — full API chain: create complaint → assign → cap SLA → trigger →
    assert OTEL attributes in Tempo.
  - [`tests/integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts)
    — `ESCALATE_COMMENT_REQUIRED` validator: manual ESCALATE without a
    comment must fail. The requirement is configurable since
    `feat/escalation-prd-alignment`:
    `CRS.EscalationPolicy.escalateCommentRequired` (default **true** —
    an absent policy row or a failed fetch keeps today's behaviour).
    `ServiceRequestValidator#validateEscalateComment` fetches the policy
    **only on the would-fail path** (action is ESCALATE, caller is not
    the auto-escalation, comment is blank), so normal requests pay zero
    MDMS calls.
  - [`tests/integration-tests/tests/admin/escalation-configurator-bomet.spec.ts`](../tests/integration-tests/tests/admin/escalation-configurator-bomet.spec.ts)
    — UI-drive of the configurator escalation editor.
  - [`tests/integration-tests/tests/utils/tempo.ts`](../tests/integration-tests/tests/utils/tempo.ts)
    — helper to query the per-tenant Tempo and assert OTEL span attributes.
- **Caveat.** The assignee-persistence upstream bug in `egov-workflow-v2`
  (ASSIGN action does not persist assignees to `eg_wf_assignee_v2`, to be
  raised against the workflow-v2 repo separately) blocks the full chain
  end-to-end on Bomet. The integration tests correctly **catch this
  regression** rather than masking it — they fail at the ASSIGN step, not
  the escalation step, with a clear diagnosis (`eg_wf_assignee_v2` row
  count == 0). When upstream fixes the bug, the tests pass without
  modification.

### Layer 5 — Live trace-back (operator runbook)

The fastest way to prove the scheduler is alive and reads CategorySLA on a
specific deployment. Works against any deployment.

```bash
# 1. Get an ADMIN token (replace <deployment> with bomet/nairobi etc.)
TOKEN=$(curl -sf -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=" \
  -d "grant_type=password&username=ADMIN&password=eGov%40123&tenantId=ke&scope=read&userType=EMPLOYEE&userInfo=true" \
  "https://<deployment>/user/oauth/token" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

# 2. Synchronous scheduler scan
#    CAUTION: without "dryRun": true this executes REAL escalations on
#    every breached complaint in the tenant. Keep dryRun for diagnostics;
#    drop it only when you intend to escalate.
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "authToken": "'"$TOKEN"'",
      "userInfo": { "roles": [{ "code": "SUPERUSER", "tenantId": "ke" }] }
    },
    "tenantId": "ke",
    "dryRun": true
  }' \
  "https://<deployment>/pgr-services/escalation/_trigger"

# Expected response shape:
# {
#   "scanned":   <int>,
#   "escalated": <int>,        # always 0 on a dry run
#   "wouldEscalate": <int>,    # dry-run counter: breached complaints that WOULD escalate
#   "skipped":   <int>,
#   "preBreachWarnings": <int>, # live scan: warnings emitted this tick (crossing
#                               # detection); dry run: complaints currently inside
#                               # the warning window
#   "dryRun":    true|false,
#   "skipBreakdown": { "NO_ASSIGNEES": ..., "SLA_NOT_BREACHED": ... },
#   "details": [
#     { "serviceRequestId": "...", "action": "SKIPPED|ESCALATED|WOULD_ESCALATE",
#       "reason": "...", "detail": "elapsed=... sla=...",
#       "slaSource": "CRS.CategorySLA.level|CRS.CategorySLA|CRS.EscalationPolicy.level|CRS.StateSLA|v0.EscalationConfig" },
#     ...                       # slaSource is null for MAX_DEPTH_REACHED /
#                               # NO_LAST_MODIFIED_TIME (skip before resolution runs)
#   ]
# }
```

To confirm which SLA layer fired, read the `slaSource` field on the
corresponding `details[]` entry — since `feat/escalation-prd-alignment`
it is a response field, no Tempo round-trip required (`null` only for
`MAX_DEPTH_REACHED` / `NO_LAST_MODIFIED_TIME`, which skip before
resolution runs). The same value also lands on the
`POST /pgr-services/escalation/_trigger` span as the
`escalation.slaSource` OTEL attribute. Values:
`CRS.CategorySLA.level` | `CRS.CategorySLA` | `CRS.EscalationPolicy.level` |
`CRS.StateSLA` | `v0.EscalationConfig`.

For the Bomet operator runbook (Tempo curl + log greps), see
[`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md).

---

## Open questions and deferred work

| # | Item | Tracking |
|---|---|---|
| 1 | ~~No configurator UI yet for editing the `CRS.WorkflowStateMapping` singleton~~ — **Closed (this branch)**: the [Escalation Settings page](#escalation-settings-page) (Card 3, "Complaint-status mapping") edits the singleton, with unique-name validation and a non-destructive standard-set merge; curl / python remain alternatives for scripted seeding | Closed by `feat/escalation-prd-alignment` ([PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815)) — no longer routed via G1 |
| 2 | Upstream DIGIT workflow ASSIGN-assignee persistence bug — blocks end-to-end escalation testing on Bomet | upstream `egov-workflow-v2`, to be raised against the workflow-v2 repo separately |
| 3 | Category Taxonomy editor (constrained picker) — replaces the free-text category/subcategoryL1 inputs in the SLA Matrix | Roadmap phase **G1** ([`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)) |
| 4 | Path Routing Rules — `(category, subcategoryL1) → path` editable rules | Roadmap phase **G2** |
| 5 | Submission Form Customization — required for **Strategy A** wiring of new tenants | Roadmap phase **G8** |
| 6 | Generic `CRS.ConfigAuditLog` supersedes the escalation-specific `CRS.SLAAuditLog` | Roadmap phase **G4** |
| 7 | v0 EscalationConfig deletion (post-migration) | Follow-up PR, no task yet |
| 8 | mdms-v2 `oneOf` validator fix — would allow declarative `slaHoursByState` cell-shape validation | upstream, no task |
| 9 | Role-level escalation (PRD P4) — a complaint sitting in a role inbox (all GROs / LMEs) with no named assignee should escalate to the role's direct supervisor when all members share a department; the multi-department case is explicitly TBD in the PRD itself. Implemented opt-in per [Role-level escalation (opt-in)](#role-level-escalation-opt-in) (formerly the satellite `docs/role-escalation-design.md`, now a redirect stub); live-verified on Bomet incl. OTEL provenance; disabled = byte-identical (pinned) | **Implemented** |
| 10 | Inbox ownership + visibility semantics on escalation (PRD P5/P11) — remove from the subordinate's inbox (all role inboxes if role-assigned), supervisor becomes owner, subordinate keeps search access; N+1 sees direct reports' complaints from filing, N+2+ must search | upstream `egov-workflow-v2` / inbox service + **open product decision** |
| 11 | Business SLA clock (PRD P6) — the overall complaint-age clock that continues uninterrupted across escalations is not modeled; only the state clock (reset via `lastModified` on escalation) exists | **Open product decision**, no task yet |
| 12 | State-based SLA matrix (BRD shape) vs level-based SLAs (PRD shape) — both models now coexist, with per-row level config taking precedence; product sign-off on the combined precedence is pending | **Open product decision** (sign-off) |
| 13 | Per-stage pre-breach disable (PRD P2) — only the global `preBreachWarning.enabled` flag exists; the PRD allows disabling warnings per workflow stage | Residual gap; revisit with the **G5** delivery work |

---

## Glossary

| Term | Meaning |
|---|---|
| **CRS** | Citizen Complaint Resolution System — this repo. Also the MDMS module prefix (`CRS.*`) for the schemas this feature introduces. |
| **PGR** | Public Grievance Redressal — the DIGIT-upstream module that owns complaint workflows. CCRS extends PGR; the `pgr-services` backend lives at `backend/pgr-services/`. |
| **MDMS** | Master Data Management Service — DIGIT's reference-data store. CRS schemas are registered under module `CRS`; legacy PGR config under `RAINMAKER-PGR`. |
| **MDMS v1 vs v2** | v1 is the search API the scheduler uses (`/mdms/v1/_search` shape via `serviceRequestRepository`). v2 is the create/update API the configurator uses (`/mdms-v2/v2/_create`, `/_update`). |
| **SLA** | Service Level Agreement. In this doc always a number of **hours** (config-side) or **ms** (scheduler-side, after `hoursToMillis`). |
| **CategorySLA** | A row in `CRS.CategorySLA` keyed on `(path, category, subcategoryL1)` with a per-state SLA map. |
| **StateSLA** | A singleton record in `CRS.StateSLA` holding per-state default SLA hours. Used when the matching CategorySLA cell is null. |
| **v0 EscalationConfig** | The pre-existing `RAINMAKER-PGR.EscalationConfig` schema with per-level SLAs + per-`serviceCode` overrides. Kept as a fallback for not-yet-migrated tenants. |
| **slaSource** | Which layer answered the SLA lookup. Since `feat/escalation-prd-alignment` it is both a response field on every `/escalation/_trigger` `details[]` entry (`null` for outcomes that skip before resolution — `MAX_DEPTH_REACHED`, `NO_LAST_MODIFIED_TIME`) and the OTEL span attribute `escalation.slaSource`. One of `CRS.CategorySLA.level`, `CRS.CategorySLA`, `CRS.EscalationPolicy.level`, `CRS.StateSLA`, `v0.EscalationConfig`. |
| **skipReason** | One of the twelve values in [`EscalationSkipReason`](../backend/pgr-services/src/main/java/org/egov/pgr/util/EscalationSkipReason.java): `MAX_DEPTH_REACHED`, `NO_LAST_MODIFIED_TIME`, `SLA_NOT_BREACHED`, `NO_ASSIGNEES`, `NO_SUPERVISOR_IN_HRMS`, `WORKFLOW_TRANSITION_FAILED`, `UNMAPPED_CATEGORY`, `STATE_MAPPING_MISSING`, the three role-escalation reasons (`ROLE_NOT_MAPPED`, `ROLE_SUPERVISOR_AMBIGUOUS`, `NO_ROLE_SUPERVISOR`), `SUCCESS`. `STATE_MAPPING_MISSING` is emitted when `CRS.WorkflowStateMapping` has no entry for the complaint's current workflow state; resolution falls back to v0 EscalationConfig. |
| **BRD** | Business Requirements Document. The Mozambique PRD/CRS v4.0 PDF is referenced throughout this codebase only as an industry source for the *shape* of generic CRS configuration. No BRD-specific data is seeded by PR #770. |
| **IGE / IGSAE** | BRD-specific path names — IGE (Inspecção-Geral do Estado, public-service complaints) and IGSAE (Inspecção-Geral das Actividades Económicas, economic-agent complaints). Used here only as **examples** of what a tenant might populate as their `path` value; the schema accepts any string. |
| **Tuple** | Shorthand for `(path, category, subcategoryL1)`, the join key of `CRS.CategorySLA`. |
| **Strategy A / B** | The two supported ways to wire complaint data into the CategorySLA lookup. A = rich intake (tuple on `additionalDetail`). B = ServiceDefs extension (`serviceCode → tuple` map). |

---

## Cross-references

- **Implementation PRs**: [`#770 feat/escalation-otel-configurator-designer`](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770),
  [`#775`](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/775) (state mapping, stacked),
  `feat/escalation-prd-alignment` (PRD alignment, [PR #815](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/815), stacked)
- **Requirements sources** (deliberately **not committed** to this public
  repo — client documents; paths are their location on the working machine):
  - CMS Escalation PRD, Draft v3.0, April 2026 — `/escalation/CMS_Escalation_PRD-latest.pdf`
  - Mozambique BRD "Plataforma de Reclamações e Denúncias" v4.0, June 2026 — `/escalation/BRD_ Plataforma de Reclamacoes e Denuncias V4.0 ENG.docx.pdf`
- **General CRS Configurator roadmap (sibling doc)**: [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)
- **Bomet deployment operational notes**: [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
- **Role-level escalation**: documented in [Role-level escalation (opt-in)](#role-level-escalation-opt-in) **in this doc**. The former satellite design doc [`docs/role-escalation-design.md`](./role-escalation-design.md) is a redirect stub, kept only so older PR/discussion links resolve.
- **Recovery SQL** (x-ref-schema + path-enum): [`configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql)
- **Patch SQL** (`slaHoursByLevel` backfill for already-registered tenants): [`configurator/src/resources/crs/sla-matrix/_seed/add-sla-by-level.sql`](../configurator/src/resources/crs/sla-matrix/_seed/add-sla-by-level.sql)
- **Patch SQL** (`roleEscalation` backfill for already-registered tenants): [`configurator/src/resources/crs/sla-matrix/_seed/add-role-escalation.sql`](../configurator/src/resources/crs/sla-matrix/_seed/add-role-escalation.sql)
- **Example seed CSV** (generic): [`configurator/src/resources/crs/sla-matrix/_seed/example.csv`](../configurator/src/resources/crs/sla-matrix/_seed/example.csv)

### Source-of-truth files

| Concern | File |
|---|---|
| Scheduler entry-point | [`backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java) |
| Per-complaint escalation action | [`backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java) |
| Skip-reason enum | [`backend/pgr-services/src/main/java/org/egov/pgr/util/EscalationSkipReason.java`](../backend/pgr-services/src/main/java/org/egov/pgr/util/EscalationSkipReason.java) |
| Admin endpoint | [`backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/EscalationController.java`](../backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/EscalationController.java) |
| SLA-source constants | [`PGRConstants#SLA_SOURCE_CATEGORY/STATE/V0`](../backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java) |
| MDMS schemas (incl. `CRS.EscalationPolicy`, `CRS.RoleSupervisors`) | [`utilities/default-data-handler/src/main/resources/schema/CRS.json`](../utilities/default-data-handler/src/main/resources/schema/CRS.json) |
| Role-escalation e2e fixture script | [`tests/integration-tests/scripts/setup-role-fixture.mjs`](../tests/integration-tests/scripts/setup-role-fixture.mjs) |
| Configurator page | [`configurator/src/resources/crs/sla-matrix/CategorySlaMatrixPage.tsx`](../configurator/src/resources/crs/sla-matrix/CategorySlaMatrixPage.tsx) |
| Escalation Settings page | [`configurator/src/resources/crs/escalation-settings/EscalationSettingsPage.tsx`](../configurator/src/resources/crs/escalation-settings/EscalationSettingsPage.tsx) |
| Shared client SLA resolver | [`configurator/src/resources/crs/sla-matrix/resolveSlaPreview.ts`](../configurator/src/resources/crs/sla-matrix/resolveSlaPreview.ts) |
| Built-in status-mapping table | [`configurator/src/resources/crs/sla-matrix/standardStateMappings.ts`](../configurator/src/resources/crs/sla-matrix/standardStateMappings.ts) |
| Shared level-SLA editor | [`configurator/src/resources/crs/sla-matrix/LevelSlaEditor.tsx`](../configurator/src/resources/crs/sla-matrix/LevelSlaEditor.tsx) |
| Configurator types | [`configurator/src/resources/crs/sla-matrix/types.ts`](../configurator/src/resources/crs/sla-matrix/types.ts) |
| Configurator service layer | [`configurator/src/resources/crs/sla-matrix/slaService.ts`](../configurator/src/resources/crs/sla-matrix/slaService.ts) |
| Trace-back drawer | [`configurator/src/resources/crs/sla-matrix/TraceBackDialog.tsx`](../configurator/src/resources/crs/sla-matrix/TraceBackDialog.tsx) |
| Bulk import dialog | [`configurator/src/resources/crs/sla-matrix/BulkImportDialog.tsx`](../configurator/src/resources/crs/sla-matrix/BulkImportDialog.tsx) |
| CSV parser | [`configurator/src/resources/crs/sla-matrix/csvParser.ts`](../configurator/src/resources/crs/sla-matrix/csvParser.ts) |
| CSV parser unit tests (vitest) | [`configurator/src/resources/crs/sla-matrix/csvParser.test.ts`](../configurator/src/resources/crs/sla-matrix/csvParser.test.ts) |
| Client resolver unit tests (vitest) | [`configurator/src/resources/crs/sla-matrix/resolveSlaPreview.test.ts`](../configurator/src/resources/crs/sla-matrix/resolveSlaPreview.test.ts) |
| `slaHoursByLevel` schema backfill SQL | [`configurator/src/resources/crs/sla-matrix/_seed/add-sla-by-level.sql`](../configurator/src/resources/crs/sla-matrix/_seed/add-sla-by-level.sql) |
| Backend unit tests | [`backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java) and siblings (see [Layer 1](#layer-1--backend-unit-tests)) |
| Configurator e2e tests | [`configurator/e2e/crs-sla-matrix.spec.ts`](../configurator/e2e/crs-sla-matrix.spec.ts), [`configurator/e2e/escalation-settings.spec.ts`](../configurator/e2e/escalation-settings.spec.ts) |
| Integration tests | [`tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts), [`pgr-manual-escalate-comment.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts), [`escalation-configurator-bomet.spec.ts`](../tests/integration-tests/tests/admin/escalation-configurator-bomet.spec.ts) |

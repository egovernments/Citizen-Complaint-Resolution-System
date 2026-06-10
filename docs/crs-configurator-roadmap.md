# General CRS Configurator Roadmap

> **Source of truth**: `/escalation/BRD_ Plataforma de Reclamacoes e Denuncias V4.0 ENG.docx.pdf`
> (Mozambique PRD/CRS, version 4.0, Maputo June 2026). All citations below are to that
> document — e.g. `(BRD §5.2)`, `(BRD Appendix A)`. The BRD is referenced here as a
> real-world industry source that informs the *shape* of these future phases.
>
> **Important.** Nothing from the BRD is auto-seeded by PR #770. The escalation feature
> ships only the MDMS schemas, the scheduler patch, the configurator UI and a tiny
> generic `example.csv` placeholder. Any tenant that wants BRD-style content (Mozambique
> IGE/IGSAE included) populates it by hand via the configurator UI, by importing their
> own CSV via the bulk-import dialog, or by running the `import_csv.py` helper against
> their own file. The future phases below (G1–G8) likewise only ship schemas + editors;
> they do not auto-populate any BRD-specific data.

## Scope

This roadmap covers the **non-escalation** Complaints and Reports Portal (PRD/CRS)
administrative configuration surface called out by the BRD — category taxonomy, IGE/IGSAE
auto-routing, the entity directory (Ministries / CSREPs / PECs / Municipalities / Economic
Agents), the role-permission matrix, notification templates, the four-level territorial
hierarchy, dashboard configuration, and citizen submission form customisation. It does
**NOT** cover escalation: the SLA matrix, per-state SLA defaults, the scheduler/OTEL work,
the mandatory `ESCALATE` comment validator, or the trace-back tool. All of those ship in
PR #770 on this same branch (`feat/escalation-otel-configurator-designer`) under
`/manage/crs-sla-matrix` and `/manage/crs-sla-trace`. This document is the home for
everything **else** the BRD calls out so the team has somewhere stable to plan from.

## Relationship to PR #770 (Escalation)

| Shipped in #770 (escalation) | Owned by this roadmap (general CRS config) |
|---|---|
| `CRS.CategorySLA` MDMS (SLA hours per category/L1/L2) | `CRS.CategoryTaxonomy` — the category names themselves. Initially free-text in the SLA Matrix; later constrained by the Taxonomy editor (Phase G1). |
| `CRS.StateSLA` MDMS + per-state defaults at `/manage/crs-sla-matrix` (BRD §5.2 case-lifecycle table) | (none — purely escalation) |
| `CRS.SLAAuditLog` MDMS + write-on-save audit trail | Generalised as `CRS.ConfigAuditLog` in Phase G4 (see cross-cutting concerns) |
| `EscalationScheduler` reads the new schemas | (none) |
| Trace-back tool at `/manage/crs-sla-trace` | (none) |
| `POST /pgr-services/escalation/_trigger` admin endpoint | The Phase G4 Permission Matrix will gate this endpoint (it's currently ADMIN-only by token role; G4 makes role binding explicit) |
| Mandatory comment validator on manual `ESCALATE` action | (none) |

**Free-text → constrained-picker migration path.** The SLA Matrix editor shipping in
#770 takes the category, sub-category L1 and sub-category L2 as **free-text-with-autocomplete**
strings (autocomplete is fed from whatever rows already exist on the tenant). When the
Taxonomy editor lands in Phase G1, the same three fields switch to a **strict picker** sourced from
`CRS.CategoryTaxonomy`. No data migration is required if operators have been disciplined
about spelling — the SLA records key on these strings and the picker will produce the same
strings. If operators have drifted, a one-shot dedup script reconciles SLA records against
the canonical taxonomy by case-insensitive match and writes back the canonical spelling;
the script is in scope for the G1 cutover, not for #770.

---

## Phase G1 — Category Taxonomy

### Why
The BRD enumerates ~17 IGSAE categories and ~13 IGE categories with multi-level sub-categories
(BRD Appendix A). Today, categories are typed as free text into the SLA Matrix. Operators
need a single source of truth that the SLA matrix, the citizen submission form (BRD §5.1 D),
the dashboard "Distribution by category" indicator (BRD Appendix C), and the IGE/IGSAE
auto-routing (BRD §5.2 "Routing Logic") can all consume.

### Scope
**In:** CRUD UI for categories, subcategory L1, subcategory L2; per-row tag for path
(`IGE` | `IGSAE` | `BOTH`); soft-delete with reason; bulk import from XLSX matching the
BRD Appendix A shape; ordering hints for citizen-facing display.

**Not in:** Localised category names (handled in cross-cutting i18n); category-specific
sub-fields on the submission form (that's Phase G8); routing rules per category (that's
Phase G2).

### MDMS schemas
- **`CRS.CategoryTaxonomy`** (module `crs`, master `CategoryTaxonomy`)
  ```
  { code, path: "IGE"|"IGSAE"|"BOTH", category, subcategoryL1, subcategoryL2,
    displayOrder, allowsOther: bool, active: bool, deprecatedReason?, createdAt }
  ```

### Configurator routes
- `/manage/crs-categories` — list + filter by path
- `/manage/crs-categories/new` — create
- `/manage/crs-categories/:code/edit` — edit/soft-delete
- `/manage/crs-categories/import` — XLSX bulk import (BRD Appendix A shape)

### API endpoints touched
- MDMS v2 `/mdms-v2/v2/_create`, `/mdms-v2/v2/_search` — same shape as PR #770 uses for
  `CRS.CategorySLA`. No new backend service.

### Dependencies on prior phases
None. This is the foundational phase.

### Acceptance criteria
- BRD Appendix A IGE table loads via bulk import and renders identically in the list view.
- BRD Appendix A IGSAE table loads via bulk import.
- The SLA Matrix in #770 successfully resolves a CategorySLA row against a taxonomy code
  by name match (validates the migration path described above).
- Soft-delete of an in-use category surfaces a warning citing the SLA / submission rows
  referencing it.
- Creating a duplicate `(path, category, subcategoryL1, subcategoryL2)` is rejected by
  the editor (matches MDMS unique-key behaviour).

### Estimated effort
**M (~2-3 days)** — straight MDMS CRUD; the only nontrivial piece is the XLSX importer
and the in-use-warning on soft-delete.

---

## Phase G2 — Path Routing Rules (IGE vs IGSAE auto-detection)

### Why
BRD §5.2 ("Routing Logic"): "The citizen does not choose the institution — they choose
the nature of the problem, and the system forwards it automatically." Today, routing is
implicit (the citizen picks a category whose `path` is IGE or IGSAE and the workflow
runs accordingly). The BRD wants this rule editable and auditable, including overrides
for the "Other" free-text option (BRD Appendix A note: each category has an "Other"
option for cases that don't fit the catalog) and for category words that map ambiguously.

### Scope
**In:** Rule editor that maps `(category, subcategoryL1?)` → `path`; a fallback default
for the "Other" option; a per-rule "manual triage required" flag (BRD §5.2: IGE path
requires manual triage; IGSAE goes directly to a Case Manager); preview UI that lets an
operator paste a category name and see the routing decision.

**Not in:** ML-based auto-categorisation (explicitly excluded by BRD §1.3); free-text NLP
on the description.

### MDMS schemas
- **`CRS.PathRoutingRule`** (module `crs`, master `PathRoutingRule`)
  ```
  { code, categoryRef, subcategoryL1Ref?, path: "IGE"|"IGSAE",
    requiresManualTriage: bool, priority: int, active: bool }
  ```
- **`CRS.PathRoutingDefault`** (single record per tenant)
  ```
  { tenantId, defaultPathForOther: "IGE"|"IGSAE", defaultRequiresTriage: bool }
  ```

### Configurator routes
- `/manage/crs-routing` — list rules ordered by priority
- `/manage/crs-routing/preview` — paste-a-category preview tool

### API endpoints touched
- MDMS v2 create/search. The PGR submission backend already reads the category's `path`
  field; this phase adds a thin lookup against `PathRoutingRule` ahead of that, with the
  category's own `path` as the fallback. Backend change: 1 helper in `pgr-services`
  (~30 LOC) plus a unit test.

### Dependencies on prior phases
**G1 (Category Taxonomy)** — rules reference taxonomy codes.

### Acceptance criteria
- A `Complaint / Public Service` row routes to `IGE` with `requiresManualTriage=true`
  matching BRD §5.2.
- A `Business / Establishment / Food poisoning` row routes to `IGSAE` and skips manual
  triage.
- The "Other" subcategory respects the per-tenant default.
- Editing a rule's `priority` re-orders evaluation predictably (lower number wins).
- The preview tool returns a decision in < 200 ms (MDMS search latency).

### Estimated effort
**M (~2-3 days)** — schema + UI + 1 backend hook + preview screen.

---

## Phase G3 — Entity Directory

### Why
BRD Appendix E enumerates the entities to configure: 18 Ministries (Central Bodies),
11 CSREPs (Council of State Representation Services in the Province), 10 PECs (Provincial
Executive Councils), and 65+ Municipalities — for the IGE path. The IGSAE path adds
Economic Agents (BRD §5.2). For each entity, the BRD requires at least one Case Manager
and at least one Supervisor (BRD §4.2 Internal Roles). Without an editable directory,
all of this is hand-seeded MDMS today.

### Scope
**In:** CRUD for the four entity types (Ministry, CSREP, PEC, Municipality) with their
parent linkages (Municipality → District → Province); a separate, lighter Economic Agent
registry for IGSAE; per-entity staffing widget that lists current Case Managers and
Supervisors with quick links to add/remove via HRMS; bulk import from XLSX seeded with
BRD Appendix E content.

**Not in:** HRMS employee creation itself (that already exists in the configurator);
delegation chains beyond Case Manager / Supervisor (that's escalation-config, already
shipped under `/manage/escalation-config`).

### MDMS schemas
- **`CRS.Entity`** (module `crs`, master `Entity`)
  ```
  { code, type: "MINISTRY"|"CSREP"|"PEC"|"MUNICIPALITY",
    name, parentEntityCode?, boundaryCode?, active, createdAt }
  ```
- **`CRS.EconomicAgent`** (module `crs`, master `EconomicAgent`)
  ```
  { code, name, sector, registrationNumber?, address?, district?, province?, active }
  ```
- **`CRS.EntityStaffing`** (read-only projection — derived from HRMS, cached as MDMS for
  list-view performance; the editor writes through to HRMS, not to this projection)
  ```
  { entityCode, caseManagerEmployeeIds: [], supervisorEmployeeIds: [], updatedAt }
  ```

### Configurator routes
- `/manage/crs-entities` — list with type filter
- `/manage/crs-entities/:code` — detail + staffing widget
- `/manage/crs-entities/import` — XLSX bulk import (BRD Appendix E)
- `/manage/crs-economic-agents` — lighter list view for IGSAE targets

### API endpoints touched
- MDMS v2 for `Entity` / `EconomicAgent`.
- HRMS `egov-hrms/_search`, `_update` for the staffing widget (no schema change).
- The submission backend reads `Entity` to validate `Related Institution / Public Service`
  (BRD Appendix B Section III) when the IGE path is taken.

### Dependencies on prior phases
**G6 (Territorial Hierarchy)** — `boundaryCode` references the boundary tree.
**G1 (Category Taxonomy)** loosely — the entity directory works without it, but the
preview tool in G2 becomes much more useful once entities are wired.

### Acceptance criteria
- All 18 Ministries from BRD Appendix E load via bulk import and are visible.
- All 11 CSREPs / 10 PECs / 65+ Municipalities load with correct parent linkages.
- The staffing widget enforces BRD §4.2 minimum: at least one Case Manager + at least
  one Supervisor before the entity is marked `active`.
- Deactivating an Entity that owns open cases surfaces a warning with the case count.
- The Economic Agent registry is searchable by `name` and `registrationNumber`.

### Estimated effort
**L (~1 week)** — four entity types, two registries, staffing widget that talks to HRMS,
and a non-trivial XLSX importer with parent-linkage resolution.

---

## Phase G4 — Role Permission Matrix

### Why
BRD §5.2 "Permission Matrix" defines six roles (Reception Technician, Screening Technician,
Case Manager, Supervisor, Leadership, Administrator) × five functions (View Cases, Edit
Cases, Assign, Close, View Dashboard) with explicit Yes/No/Read-only cells. Today these
are baked into the PGR workflow and the configurator's left-sidebar role gates. The BRD
wants this matrix editable (within a constrained set of cell values) so country deployments
can adjust without code changes — and so the matrix becomes the source of truth that gates
the existing `/escalation/_trigger` endpoint shipped in #770.

### Scope
**In:** Read/edit UI for the 6×5 matrix; per-cell value picker constrained to
`{ "yes", "no", "read-only", "operational", "executive" }` (mirroring the BRD values
including the dashboard column's `Operational`/`Executive`); a sibling `CRS.ConfigAuditLog`
schema that records every save (see cross-cutting); a backend permission middleware in
`pgr-services` that consults this matrix before serving `_trigger`, `_close`, `_assign`,
etc.

**Not in:** Adding new roles beyond the BRD's six; adding new functions; per-tenant
*function* customisation (only per-tenant cell-value customisation).

### MDMS schemas
- **`CRS.RolePermissionMatrix`** (module `crs`, master `RolePermissionMatrix`,
  single record per tenant)
  ```
  { tenantId, version,
    cells: [ { role: "RECEPTION_TECHNICIAN"|"SCREENING_TECHNICIAN"|
                     "CASE_MANAGER"|"SUPERVISOR"|"LEADERSHIP"|"ADMINISTRATOR",
               function: "VIEW_CASES"|"EDIT_CASES"|"ASSIGN"|"CLOSE"|"VIEW_DASHBOARD",
               value: "yes"|"no"|"read-only"|"operational"|"executive" } ],
    updatedBy, updatedAt }
  ```
- **`CRS.ConfigAuditLog`** (introduced here, used by G1-G8 going forward)
  ```
  { id, tenantId, schemaCode, recordCode, action: "CREATE"|"UPDATE"|"DELETE",
    beforeJson, afterJson, actorUserId, actorRoles, at }
  ```

### Configurator routes
- `/manage/crs-permissions` — the 6×5 grid editor
- `/manage/crs-audit` — generic config audit-log viewer (filters by schema, actor, date)

### API endpoints touched
- MDMS v2 for matrix + audit log.
- New `pgr-services` filter (~50 LOC) that reads the matrix once per request from Redis
  cache (key `crs.permission.matrix.<tenant>`) and applies the 6×5 grid to the action being
  invoked. Cache invalidation on matrix save (mirroring the `validationRules` pattern from
  CCRS mobile-validation).

### Dependencies on prior phases
None hard. Lands cleanly any time after #770.

### Acceptance criteria
- The default seed of the matrix exactly reproduces BRD §5.2.
- Editing the `Supervisor / Close` cell from `Yes` to `No` causes a Supervisor's `_close`
  request to return 403.
- Every save writes a `CRS.ConfigAuditLog` row with before/after JSON and the actor.
- The Redis cache key invalidates on save (verified by curl: edit → 1-request lag → new
  behaviour without a service restart).
- `/escalation/_trigger` requires the actor to have `value=yes` in the
  `(ADMINISTRATOR, EDIT_CASES)` cell, or returns 403 with a structured reason.

### Estimated effort
**M (~2-3 days)** — small grid UI, one MDMS schema, one shared backend filter, one
ConfigAuditLog schema reused by later phases.

---

## Phase G5 — Notification Templates

### Why
BRD §5.1 E ("Citizen Notifications") specifies SMS messages per workflow state with
variable substitution: `[NRSEQ]`, `[YEAR]`, and implicitly `[CITIZEN_NAME]` (the BRD's
default messages don't use the name today but the slot exists in the BRD's submission
form — Full Name field). The defaults from BRD §5.1 E need to be editable per-tenant
without a redeploy.

### Scope
**In:** CRUD per (workflow state, channel) tuple; variable substitution preview;
per-tenant overrides; a "reset to BRD default" button per row.

**Not in:** Email templates (BRD only specifies SMS for citizen notifications);
WhatsApp template approval flow (that's a separate WhatsApp Business API onboarding
piece, BRD §8.2); A/B testing.

### MDMS schemas
- **`CRS.NotificationTemplate`** (module `crs`, master `NotificationTemplate`)
  ```
  { code, tenantId, state: "SUBMITTED"|"IN_SCREENING"|"FORWARDED"|
                           "UNDER_INVESTIGATION"|"AWAITING_INFO"|"RESOLVED"|"REJECTED",
    channel: "SMS"|"WHATSAPP",
    locale: "pt_MZ"|"en_US",
    body, variablesUsed: [ "NRSEQ", "YEAR", "CITIZEN_NAME", ... ],
    active, updatedAt }
  ```

### Configurator routes
- `/manage/crs-notifications` — list per (state, channel, locale)
- `/manage/crs-notifications/:code/edit` — body editor + live preview pane

### API endpoints touched
- MDMS v2.
- Reads from existing Novu bridge consumer (already wired for SMS dispatch in CCRS) —
  the bridge needs a small change to look up `NotificationTemplate` by `(state, channel,
  locale)` instead of the current hardcoded templates. One PR against `novu-bridge`
  (~80 LOC + tests).

### Dependencies on prior phases
None hard.

### Acceptance criteria
- The seven default messages from BRD §5.1 E load verbatim on a fresh tenant.
- Edit + Save of the `RESOLVED` template surfaces the new body on the very next state
  transition (no service restart).
- The preview pane renders `[NRSEQ]` → `0000123` and `[YEAR]` → `2026` correctly.
- "Reset to BRD default" restores the exact BRD §5.1 E body.
- A template with an unknown variable token (e.g. `[FOO]`) is rejected on save with
  a clear error.

### Estimated effort
**M (~2-3 days)** — CRUD + preview + novu-bridge integration; the novu integration
is the slowest piece.

---

## Phase G6 — Territorial Hierarchy

### Why
BRD §6.1 ("Territorial Hierarchy") specifies four levels: Province (11) → District (154)
→ Administrative Post (490) → Location (1,052). This is used both to determine the
administrative area of a complaint (BRD Appendix B Section I Province/District/Admin Post
fields) and to drive the "Distribution by province" / geographic-map dashboard indicators
(BRD Appendix C).

### Scope
**In:** Tree editor with drag-to-reparent within the 4-level constraint; bulk import
from XLSX matching the BRD §6.1 totals (11/154/490/1052); attach lat/long bounding box
per node (optional, for map dashboard); deactivation that prevents new complaints on
the node but preserves history.

**Not in:** Postal codes (the BRD acronym table mentions "ZIP code = Provincial Executive
Council" — there's no consumer postal-code concept); a fifth hierarchy level.

### MDMS schemas
- Use the existing DIGIT **`boundary` service** schema (`tenant-boundary` /
  `boundary-relationship`) — this is well-trodden ground (the configurator already has
  a Boundaries page). Add one CRS-specific overlay:
- **`CRS.BoundaryLabelOverride`** (module `crs`, master `BoundaryLabelOverride`)
  ```
  { boundaryCode, displayLabel_ptMZ, displayLabel_en, abbreviation?, active }
  ```

### Configurator routes
- `/manage/boundaries` — already exists; this phase extends it with the 4-level constraint
  validator and an MZ-shaped XLSX import.
- `/manage/crs-boundary-labels` — locale overrides

### API endpoints touched
- DIGIT `egov-location` / `boundary-service` `_create`/`_update`/`_search`. No
  schema change to the boundary service itself; the CRS-side change is the validator
  that the tree depth is exactly 4 and the labels overlay.

### Dependencies on prior phases
None hard, but G3 (Entity Directory) reads `boundaryCode` from this tree, so this
phase should land before G3 is considered "done" — see Recommended Sequencing.

### Acceptance criteria
- Bulk import from BRD §6.1 produces the exact totals: 11 / 154 / 490 / 1052 nodes.
- Reparenting a District to a Location is rejected (4-level constraint).
- The submission form's Province → District → Admin Post → Location dropdowns
  (BRD Appendix B Section I) populate correctly via cascading lookups.
- A Portuguese-locale browser sees the `pt_MZ` overlay labels; an English-locale
  browser sees `en`.
- The dashboard's geographic-map indicator (BRD Appendix C) renders all 11 provinces
  with non-zero hit-count for at least the seeded sample.

### Estimated effort
**L (~1 week)** — the editor extensions are small, but the XLSX import for ~1,700
hierarchical rows with lat/long is non-trivial, plus the locale overrides.

---

## Phase G7 — Dashboard Configuration

### Why
BRD §5.3 ("Dashboard Requirements") and BRD Appendix C ("Dashboard Formulas and Indicators")
specify ~15 indicators across the IGE and IGSAE dashboards with explicit formulas
(e.g. `Resolution Rate = Cases Resolved ÷ Cases Received × 100`,
`% SLA Compliance = Cases within timeframe ÷ Total cases × 100`). Today these are
hardcoded in the dashboard widget. The BRD wants them editable so country deployments
can swap a denominator without a frontend rebuild.

### Scope
**In:** A registry of indicators with their formula expression (a constrained mini-DSL,
e.g. `count(state=RESOLVED) / count(*) * 100`); per-dashboard layout (IGE vs IGSAE);
operational vs executive grouping (matches BRD §5.2 Permission Matrix's
`Operational`/`Executive` distinction); date-range presets.

**Not in:** Arbitrary SQL; user-defined indicators (only edits to the BRD-Appendix-C
seed set are in scope for v1); export to CSV (that's a separate, smaller follow-up).

### MDMS schemas
- **`CRS.DashboardIndicator`** (module `crs`, master `DashboardIndicator`)
  ```
  { code, dashboard: "IGE"|"IGSAE"|"BOTH",
    group: "VOLUME"|"PERFORMANCE"|"OTHER"|"SPECIFIC",
    accessLevel: "OPERATIONAL"|"EXECUTIVE",
    label, formulaExpr, unit: "count"|"pct"|"hours"|"days"|"rating",
    displayOrder, active }
  ```
- **`CRS.DashboardLayout`** (module `crs`, master `DashboardLayout`,
  one per tenant per dashboard)
  ```
  { tenantId, dashboard, rows: [ { indicators: [ code, ... ] } ] }
  ```

### Configurator routes
- `/manage/crs-dashboards` — indicator list + formula editor
- `/manage/crs-dashboards/:dashboard/layout` — drag-to-arrange layout editor

### API endpoints touched
- MDMS v2.
- The dashboard service (`pgr-dashboard` or equivalent) needs a small evaluator for the
  formula DSL — out of scope for the configurator PR, tracked separately.

### Dependencies on prior phases
**G4 (Role Permission Matrix)** — the `accessLevel` field gates indicators by role
(Operational vs Executive). G6 (Territorial Hierarchy) — the geographic indicators need
the boundary tree to exist.

### Acceptance criteria
- All BRD Appendix C indicators (Total Cases Received, Resolution Rate, Avg Resolution
  Time, Avg Screening Time, % SLA Compliance, % Outside SLA, Distribution by type,
  Distribution by category, Ranking of institutions, Territorial distribution,
  Citizen Satisfaction, Trends) load on a fresh tenant.
- Editing the `% SLA Compliance` formula and saving immediately changes the rendered
  dashboard number on next refresh.
- A `LEADERSHIP` role sees Executive-only indicators; a `CASE_MANAGER` role sees
  Operational ones (per BRD §5.2).
- An invalid formula expression is rejected at save time with a parse error.

### Estimated effort
**L (~1 week)** — UI is straightforward; the formula DSL evaluator is the bulk of the
work and is shared with the separate dashboard-service PR.

---

## Phase G8 — Submission Form Customization

### Why
BRD Appendix B specifies the citizen intake form in three sections: General Information
(I), IGSAE complaints (II), and IGE complaints (III), with per-field Type / Mandatory /
Validation / Applicable-path metadata. Today these fields are hardcoded in the citizen
portal. The BRD wants them editable so a country deployment can drop "Household" or
add a country-specific field without a UI release.

### Scope
**In:** CRUD per form section per field; field type picker (Text, Long Text, List,
Dependent List, Number, Email, Yes/No, Checkbox, Date, Upload, GPS); validation rules
(maxChars, regex, mimeTypes, sizeMb); mandatory toggle; per-path applicability
(`IGE`/`IGSAE`/`BOTH`); reorder via drag-and-drop; live preview that renders the form
as a citizen would see it.

**Not in:** Conditional logic beyond Dependent List (e.g. "show this field iff category
== X"); per-tenant *new* field types beyond the BRD-Appendix-B set.

### MDMS schemas
- **`CRS.SubmissionFormField`** (module `crs`, master `SubmissionFormField`)
  ```
  { code, section: "GENERAL"|"IGSAE"|"IGE",
    label_ptMZ, label_en,
    type: "TEXT"|"LONG_TEXT"|"LIST"|"DEPENDENT_LIST"|"NUMBER"|"EMAIL"|
          "YES_NO"|"CHECKBOX"|"DATE"|"UPLOAD"|"GPS",
    mandatory: bool,
    validation: { maxChars?, minChars?, regex?, mimeTypes?, maxSizeMb?,
                  dependsOn?, listSource? },
    applicablePaths: [ "IGE"|"IGSAE" ],
    displayOrder, active }
  ```

### Configurator routes
- `/manage/crs-submission-form` — list per section
- `/manage/crs-submission-form/:code/edit` — field editor with live preview

### API endpoints touched
- MDMS v2.
- The citizen-portal SPA needs to consume `SubmissionFormField` instead of its hardcoded
  config — separate PR against the citizen portal, ~half-day's work on top of the
  configurator UI.

### Dependencies on prior phases
**G1 (Category Taxonomy)** — the Category and SubcategoryL1/L2 dropdown fields (BRD
Appendix B II/III) need the taxonomy as their `listSource`. **G6 (Territorial Hierarchy)** —
the Province/District/Admin Post fields (BRD Appendix B I) need the boundary tree.

### Acceptance criteria
- The default seed exactly reproduces BRD Appendix B Sections I, II, III.
- Toggling `Witnesses (Name / Contact)` from optional to mandatory immediately changes
  the citizen form validation.
- Dependent List for District correctly cascades from Province.
- The live preview matches what the citizen portal renders pixel-equivalently.
- Adding a new field with `applicablePaths: ["IGSAE"]` does not appear on the IGE form.

### Estimated effort
**XL (multi-week)** — large schema, many widget kinds, dependent-list semantics, locale
duplication for every label, plus the corresponding citizen-portal consumer changes.
The configurator side alone is ~1 week; the portal-consumer side adds another week.

---

## Cross-cutting concerns

### Tenant scoping
- All eight schemas above store at the **city tenant** level (e.g. `ke.bomet`,
  `ke.nairobi`) with **root-tenant inheritance** — i.e. operators can seed shared
  defaults at `ke` and override per city. This matches the inheritance behaviour of
  the SLA Matrix in #770 and the existing MDMS v2 behaviour documented in
  `~/CLAUDE.md` ("MDMS v2 Behaviour" section).
- The `Entity` / `EconomicAgent` registries (G3) and the `SubmissionFormField` (G8) are
  the most likely to want per-city overrides; the `RolePermissionMatrix` (G4) is the
  most likely to want a root-level lock with no city overrides.
- Per-tenant override is a per-schema decision and should be called out explicitly in
  the open-questions list (see below).

### Audit logging
- The escalation work in #770 introduces `CRS.SLAAuditLog` — narrow, escalation-only.
- Phase G4 generalises this as **`CRS.ConfigAuditLog`** with `schemaCode` + `recordCode`
  + before/after JSON. From G4 onwards, every save in G1-G8 writes a `ConfigAuditLog`
  row through a shared helper (~30 LOC, lives in `configurator/src/admin/audit/`).
- G1-G3 ship without audit logging (they're foundational and pre-date G4); when G4
  lands, a one-shot backfill task synthesises retroactive `ConfigAuditLog` rows from
  MDMS `auditDetails.createdTime` / `lastModifiedTime` so the audit-log view is not
  empty for older records.

### i18n
- BRD §3 ("Portal Identity") implicitly targets Portuguese (Mozambique) primary, with
  English as the secondary working language (the BRD itself is the English translation
  of a Portuguese source). Every user-facing label in G1-G8 must have a `label_ptMZ`
  and a `label_en` column.
- The configurator uses the existing DIGIT localisation service for its own chrome;
  in-content labels (category names, entity names, indicator labels) live in the MDMS
  records themselves alongside the data.
- The "fix-missing-keys" skill in `~/.claude/skills/fix-missing-keys/` handles the
  configurator-chrome localisation drift; in-content drift is a per-phase G-task
  concern, not a global concern.

### Migration from existing data
| Phase | Initial data source |
|---|---|
| G1 Category Taxonomy | BRD Appendix A (IGE table + IGSAE table) → XLSX importer |
| G2 Path Routing | Derived from G1's `path` column — first seed is identity rules |
| G3 Entity Directory | BRD Appendix E (Ministries / CSREPs / PECs / Municipalities) → XLSX importer; Economic Agents from country-specific registries (Mozambique-side input) |
| G4 Role Permission Matrix | BRD §5.2 verbatim |
| G5 Notification Templates | BRD §5.1 E verbatim, per-locale duplicated |
| G6 Territorial Hierarchy | BRD §6.1 totals (11/154/490/1052); the actual names come from Mozambique's national territorial dataset (operator-provided XLSX) |
| G7 Dashboard Configuration | BRD Appendix C verbatim |
| G8 Submission Form Fields | BRD Appendix B Sections I/II/III verbatim |

For Bomet / Nairobi (Kenya), the BRD-Mozambique seeds are inappropriate. Each Kenyan
tenant needs its own seed run — the operator-prepared XLSX is the right vehicle, and
the `digit-xlsx-onboard` skill already does this for the SLA Matrix today.

---

## Recommended sequencing

1. **G1 Category Taxonomy** — first. Unblocks G2 and the SLA-Matrix free-text → picker
   migration. No dependencies. M-size.
2. **G6 Territorial Hierarchy** — second, in parallel with G1. Unblocks G3 and the
   Province/District fields in G8. No dependencies. L-size.
3. **G2 Path Routing** — third, after G1. Needed before the citizen portal can route
   correctly post-Taxonomy. M-size.
4. **G3 Entity Directory** — fourth, after G1 + G6. Lights up `Related Institution`
   (BRD Appendix B Section III) and unblocks dashboard "Ranking of institutions"
   (BRD Appendix C). L-size.
5. **G4 Role Permission Matrix** — fifth. Independent of G1-G3 but pairs naturally
   with the introduction of `CRS.ConfigAuditLog` which then becomes the cross-cutting
   audit primitive for G5-G8. M-size.
6. **G5 Notification Templates** — sixth. Pulls in novu-bridge changes that are
   already-touched code in this repo, so the slow part is the integration test not
   the schema. M-size.
7. **G7 Dashboard Configuration** — seventh, after G4 + G6. Needs role-gating and
   the geographic tree. L-size.
8. **G8 Submission Form Customization** — last. Highest-cost (XL) and depends on G1 +
   G6 for its `listSource`s. Best to land after the foundational pieces are stable
   so the citizen-portal consumer change is a one-shot rewrite rather than a series
   of incremental ones.

Total: ~6-8 weeks of focused work for one engineer, or ~4-5 weeks parallelised across
two with G1+G6 in parallel and G3+G4 in parallel.

---

## Open questions for product / ops

- **Permission Matrix per-tenant editability (G4):** is the 6×5 matrix editable per
  tenant, or is it globally locked at the root tenant with city-level read-only? BRD
  §5.2 doesn't say.
- **"Other" category handling (G1 / G2):** when a citizen picks "Other" with a free-text
  description, does the case go to manual triage (BRD §5.2 IGE pattern) or get routed
  per the per-tenant `PathRoutingDefault`? The BRD Appendix A note is silent on this.
- **Economic Agent registry source (G3):** is the IGSAE Economic Agent list maintained
  inside CRS, or pulled from an external CUOE registry (BRD acronyms: "Single Registry
  of Economic Operators")? If external, we need an integration spec.
- **Boundary lat/long source (G6):** does the country deployment provide bounding-box
  geometry per node, or do we depend on Google Maps reverse geocoding (BRD Appendix D
  mentions Google Maps as an integration)?
- **Notification template approval (G5):** can an `ADMINISTRATOR` push a template
  change live immediately, or does it need a Supervisor / Leadership approval step?
- **Dashboard formula DSL surface (G7):** how much expressivity should the formula
  editor expose? Just the BRD-Appendix-C set with denominator-swap, or arbitrary
  count/sum/avg over the case table?
- **Submission form versioning (G8):** when a tenant edits a field on a live form, do
  in-flight submissions use the old schema or the new one? (Suggests we may need a
  `formVersion` column on the case record.)
- **Locale fallback policy:** if a `label_ptMZ` is missing on a record, do we fall back
  to `label_en`, raise a localisation alert, or block the save?
- **Soft-delete semantics:** should `active: false` on a Category, Entity, or
  SubmissionFormField hide it from new submissions only, or also hide it from
  retrospective dashboard / search filters? (Probably hide-from-new-only, but worth
  confirming.)
- **Backfill of `CRS.ConfigAuditLog` (cross-cutting):** is the one-shot retroactive
  backfill from MDMS `auditDetails` good enough, or does product want an explicit
  "no history available before <date>" banner on the audit view?

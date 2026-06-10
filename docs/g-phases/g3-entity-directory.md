# G3: Entity Directory

> **Status:** Design — no implementation yet. This document scopes the work; the
> companion draft PR carries only the MDMS schema stub + this doc. Architectural
> feedback should land in the linked GitHub Discussion (see Cross-references).

## Why

Per-tenant directory of the organizational entities that own complaints once the
routing layer (G2) hands them off — Ministries, Council of State Representation
Services in the Province (CSREPs), Provincial Executive Councils (PECs),
Municipalities for the IGE path, and Economic Agents for the IGSAE path. Each
entity needs at least one **Case Manager** and at least one **Supervisor** (BRD
§4.2 Internal Roles) before workflow assignment can resolve a real human owner.

Today every Entity row + every Case-Manager/Supervisor mapping is hand-seeded
into MDMS by an operator with shell access. That blocks country onboarding,
prevents tenant admins from reorganizing their own ministries without engineering
help, and leaves the BRD-mandated `Related Institution / Public Service` dropdown
populated by ad-hoc JSON edits. G3 makes the directory editable from the
configurator and the staffing widget writes through to HRMS.

Reference: BRD Appendix E (entity enumeration), BRD §4.2 (internal roles), BRD
Appendix B Section III (`Related Institution / Public Service` field).

## Scope

**In:**

- CRUD for the four IGE entity types — Ministry, CSREP, PEC, Municipality —
  with parent linkages (`Municipality → District → Province`).
- Separate lighter CRUD for Economic Agents (IGSAE path).
- Per-entity Staffing widget: lists current Case Managers + Supervisors,
  resolves them from HRMS by employee UUID, supports add/remove that
  writes through to HRMS (no shadow source of truth in MDMS).
- Bulk XLSX importer seeded with BRD Appendix E content (18 Ministries,
  11 CSREPs, 10 PECs, 65+ Municipalities) with parent-linkage resolution.
- "Activate" gate: an entity stays `active=false` until it has ≥1 Case
  Manager and ≥1 Supervisor (BRD §4.2 minimum).
- Deactivate-with-open-cases warning surfaced to the operator.

**Out (explicitly deferred):**

- HRMS employee creation itself — the configurator already has an editor
  for this; G3 only links existing employees to entities.
- Escalation chains beyond the Case Manager / Supervisor pair — that's
  the escalation-config surface that shipped under `/manage/escalation-config`
  (see PR #770).
- The Category Taxonomy (G1) and Path Routing (G2) editors — G3 reads
  nothing from them.
- Country-specific Economic Agent registry imports (e.g. IGSAE Mozambique).
  G3 ships the schema + manual CRUD; the importer is a follow-up.

## MDMS schemas

Three new codes reserved by the stub at
`utilities/default-data-handler/src/main/resources/schema/CRS.G3.json`. Final
property shape lands in the implementation PR; the stub keeps each schema
permissive (`additionalProperties: true`) so unfinished work can't break the
registration loop.

### `CRS.Entity`

```
{
  "code":              string  (unique, e.g. "MIN.HEALTH")
  "type":              "MINISTRY" | "CSREP" | "PEC" | "MUNICIPALITY",
  "name":              string,
  "parentEntityCode":  string?  (e.g. Municipality's parent District)
  "boundaryCode":      string?  (link to G6 territorial hierarchy)
  "active":            boolean   (gated on ≥1 CaseManager + ≥1 Supervisor)
  "createdAt":         number
}
```

`x-unique: ["code"]`, `x-ref-schema: []`, `additionalProperties: false` in the
final form. Parent linkages are validated application-side (we cannot express
"parent must be of type District" in JSON-Schema alone given the egov-mdms-v2
validator's quirks — same lesson as `CRS.CategorySLA.slaHoursByState`).

### `CRS.EconomicAgent`

```
{
  "code":                string (unique),
  "name":                string,
  "sector":              string,
  "registrationNumber":  string?,
  "address":             string?,
  "district":            string?,
  "province":            string?,
  "active":              boolean
}
```

Searchable by `name` and `registrationNumber` from the configurator's
list view.

### `CRS.EntityStaffing`

Read-only projection. Keyed by `entityCode`. Holds two arrays of HRMS employee
UUIDs (`caseManagerEmployeeIds`, `supervisorEmployeeIds`) plus an `updatedAt`
timestamp. The editor never writes here directly — every staffing change goes
to HRMS first and the projection is refreshed by a small backend job (or, in
v1, by a lazy refresh on the next list-view load). HRMS stays the source of
truth so the existing reportingTo chain (used by escalation) is consistent.

## Configurator routes + UI sketch

New nav group **"Organization"** in the configurator sidebar, sitting under
the existing **"Workflow"** group (which currently hosts `/manage/escalation-config`).

| Route                                | Purpose                                       |
|--------------------------------------|-----------------------------------------------|
| `/manage/crs/entities`               | List view with type filter + search           |
| `/manage/crs/entities/:code`         | Detail page + staffing widget                 |
| `/manage/crs/entities/import`        | XLSX bulk import (Appendix E seed available)  |
| `/manage/crs/economic-agents`        | Lighter list view for IGSAE targets           |
| `/manage/crs/economic-agents/:code`  | Detail page                                   |

### List-view wireframe

```
+--------------------------------------------------------------------------+
| Entities                                       [+ New Entity] [Import]   |
+--------------------------------------------------------------------------+
| Type: [ All ▾ ]   Search: [_______________]   Status: [ Active ▾ ]       |
+------+----------------------+------------+----------------+--------------+
| Code | Name                 | Type       | Parent         | Staffing     |
+------+----------------------+------------+----------------+--------------+
| MIN. | Ministry of Health   | MINISTRY   | —              | 2 CM / 1 SV  |
| HEAL |                      |            |                | ● active     |
+------+----------------------+------------+----------------+--------------+
| MUN. | Maputo Municipality  | MUNICIPAL. | DIST.MAPUTO    | 0 CM / 0 SV  |
| MAP  |                      |            |                | ○ inactive   |
+------+----------------------+------------+----------------+--------------+
```

### Detail-view wireframe (staffing widget centre stage)

```
+--------------------------------------------------------------------------+
| ← Entities  /  MIN.HEALTH — Ministry of Health           [Save] [Delete] |
+--------------------------------------------------------------------------+
| Code:           MIN.HEALTH   (immutable)                                 |
| Name:           Ministry of Health                                       |
| Type:           MINISTRY                                                 |
| Parent:         (none)                                                   |
| Boundary:       [ ke.bomet ▾ ]                                           |
| Active:         [✓]   (requires ≥1 Case Manager + ≥1 Supervisor)         |
+--------------------------------------------------------------------------+
| Staffing                                                                 |
|                                                                          |
|   Case Managers (2)                                  [+ Add]             |
|   ─────────────────────────────────                                      |
|   • Jane Doe        (jane.doe@health.gov)            [Remove]            |
|   • John Smith      (john.smith@health.gov)          [Remove]            |
|                                                                          |
|   Supervisors (1)                                    [+ Add]             |
|   ─────────────────────────────────                                      |
|   • Alice Lee       (alice.lee@health.gov)           [Remove]            |
+--------------------------------------------------------------------------+
```

The `[+ Add]` action opens an HRMS-employee picker scoped to the current
tenant (no new picker UI invented — reuse the one already in escalation-config).

## API endpoints touched

| Surface       | Operation                                                    |
|---------------|--------------------------------------------------------------|
| mdms-v2       | `/v2/_create`, `/v2/_search`, `/v2/_update` on `crs.Entity` and `crs.EconomicAgent`. |
| mdms-v2       | `/v2/_search` on `crs.EntityStaffing` (read-only).            |
| egov-hrms     | `/_search`, `/_update` for staffing widget. **No schema change.** |
| crs-services  | New `/entities/_staffingRefresh` endpoint (POST) that recomputes the `CRS.EntityStaffing` projection for a given entityCode after HRMS write-through. Synchronous, idempotent. |
| pgr-services  | Read `crs.Entity` to validate `Related Institution / Public Service` on complaint create (IGE path). Failure is non-fatal in v1 — log + accept. |

No new backend service. The staffing-refresh endpoint lives in the existing
`crs-services` module alongside the escalation triggers added in PR #770.

## Dependencies on prior phases

**Hard dependencies (must ship first):**

- PR #770 — escalation foundation (provides the HRMS-picker component reused
  by the staffing widget, plus the `/manage/...` sidebar group registration).
- PR #A — `refactor/scheduler-state-name-mdms` (`CRS.WorkflowStateMapping`).
  Not a logical dependency of G3 itself; sequenced because the PR is stacked.
- PR #B — `docs/categorysla-wiring-strategies`. Sequencing-only; the wiring
  strategies doc affects how G2's path routing surfaces, and G3 reads
  `boundaryCode` whose semantics G6 owns.
- **G6 (Territorial Hierarchy)** — `boundaryCode` references the boundary
  tree. G3 can ship its CRUD without G6 and accept opaque strings, but
  the `[boundary ▾]` picker in the detail view depends on G6.

**What G3 blocks:**

- The BRD `Related Institution / Public Service` field on the complaint
  submission form (G8) cannot be a proper dropdown until G3 is live.
- The eventual designation-tree visualizer (currently a flat list in
  digit-configurator) gets per-entity grouping once G3 ships.

## Acceptance criteria

1. An operator can create a new Entity from the configurator UI without
   editing MDMS JSON or running a CLI tool.
2. Bulk import of BRD Appendix E (18 Ministries, 11 CSREPs, 10 PECs, 65+
   Municipalities) completes from a single XLSX upload and resolves all
   parent linkages without manual intervention.
3. Adding a Case Manager / Supervisor in the staffing widget round-trips to
   HRMS (verifiable by hitting `/egov-hrms/_search` directly afterwards) and
   appears in the next list-view load.
4. An Entity with zero Case Managers OR zero Supervisors cannot be marked
   `active=true` from the UI; the toggle is disabled with a tooltip
   explaining the BRD §4.2 minimum.
5. Deactivating an Entity that has open PGR cases surfaces a warning with
   the open-case count and requires an explicit confirm.
6. The Economic Agent list view is searchable by both `name` and
   `registrationNumber` and returns within 500 ms for a 1k-row registry.
7. `pgr-services` accepts complaint creates whose `additionalDetail.entityCode`
   resolves to a live `CRS.Entity`; unknown codes are logged but do not
   reject the complaint (v1 graceful fallback).

## Estimated effort

**L (~1 week)** — four entity types, two registries, a staffing widget that
talks to HRMS, an XLSX importer with parent-linkage resolution, and one new
backend endpoint. Most of the UI work is list/detail patterns the configurator
already has; the importer + the staffing widget's HRMS write-through are the
genuine new surface.

## Open questions

1. **Economic Agent registry source.** Is the Mozambique IGSAE Economic Agent
   list maintained anywhere queryable, or does each tenant manually onboard
   their own? (Affects whether the XLSX importer needs a country-specific seed
   alongside Appendix E.)
2. **Boundary `boundaryCode` vs free string.** Should G3 hard-reference the
   G6 boundary tree (and therefore block until G6 ships), or accept opaque
   strings now and tighten to a FK later? Recommendation: accept strings; the
   importer can validate against G6 if present, warn if not.
3. **Staffing projection refresh model.** Synchronous on every HRMS write
   (simpler, but couples the editor to projection write latency) vs lazy on
   list-view (faster edits, eventually-consistent list)? Recommendation:
   lazy + a manual "refresh" button on the list view.
4. **Multi-Case-Manager dispatch.** If an entity has 3 Case Managers, which one
   receives a new complaint? Round-robin, least-loaded, or explicit primary?
   This crosses into workflow assignment (out-of-scope for G3 the editor) but
   must be answered before the assignment resolver can use the data.
5. **Cross-entity employee assignment.** Can the same HRMS employee be a Case
   Manager for two entities? The schema permits it (HRMS write-through doesn't
   block); but operationally, escalation chains may get confused if one user
   has two reporting paths.

## Cross-references

- **Discussion:** _(filled in after the Discussion is created)_
- **Roadmap:** [docs/crs-configurator-roadmap.md](../crs-configurator-roadmap.md) — Phase G3 section
- **Escalation design:** [docs/escalation-feature-design.md](../escalation-feature-design.md)
- **CategorySLA wiring strategies (PR #B):** [docs/categorysla-wiring-strategies.md](../categorysla-wiring-strategies.md)
- **PR #770 — escalation foundation:** https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770
- **Schema stub:** [`utilities/default-data-handler/src/main/resources/schema/CRS.G3.json`](../../utilities/default-data-handler/src/main/resources/schema/CRS.G3.json)

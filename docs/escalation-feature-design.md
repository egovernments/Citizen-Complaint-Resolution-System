# CRS Escalation Feature — Canonical Design Doc

> **Status**: living doc for the work shipped in [PR #770](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
> on branch `feat/escalation-otel-configurator-designer`.
> **Audience**: platform engineers, configurator developers, deployment operators.
> **Related**: [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md) (sibling
> roadmap for non-escalation work), [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
> (operational notes from the first live deployment).

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
[`EscalationScheduler.resolveSlaHours`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L476):

1. **`CRS.CategorySLA`** — per-tuple (path, category, subcategoryL1) SLA rows
   with one cell per workflow state.
2. **`CRS.StateSLA`** — per-state defaults (singleton record per tenant) used
   when the matching CategorySLA cell is null.
3. **`RAINMAKER-PGR.EscalationConfig`** (v0) — the pre-existing per-level SLA
   table, kept as a safety net so a tenant that has not yet migrated does not
   lose escalation overnight.

The selected layer is surfaced on each OTEL span as `escalation.slaSource`, so an
operator can tell from a single trace which configuration answered the lookup.

**What landed in PR #770**: the three MDMS schemas (`utilities/default-data-handler/src/main/resources/schema/CRS.json`),
the scheduler patch that consumes them, the new admin endpoint `POST /pgr-services/escalation/_trigger`,
the SLA Matrix configurator page with bulk-CSV import + trace-back drawer, structured
skip-reason logging, OTEL span attributes, the mandatory-comment validator on manual
`ESCALATE`, and a workflow-designer iframe integration.
**What is deferred**: the constrained category taxonomy editor (free-text categories
remain until then), path-routing rules, entity directory, role-permission matrix,
notification templates, territorial hierarchy, dashboard editor and submission-form
customisation — see the General CRS Configurator roadmap
([`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)) for phases
G1–G8.

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
   admin / test caller  ---POST /escalation/_trigger---+ (synchronous, same code path)
                                                       |
                                                       v
   +----------------------------------------------------------------+
   | EscalationScheduler.scanAndEscalateOnce(tenantId, ids, RI)     |
   |  1. fetch  CRS.CategorySLA          (MDMS v1 search)           |
   |  2. fetch  CRS.StateSLA             (MDMS v1 search)           |
   |  3. fetch  ServiceDefs              (build serviceCode -> tuple)|
   |  4. fetch  EscalationConfig (v0)    (MDMS v1 search, fallback)  |
   |  for each candidate complaint:                                  |
   |    a. resolveSlaHours -> SlaResolution(slaMs, source, unmapped) |
   |    b. compute elapsed = now - lastModified                      |
   |    c. if elapsed < sla         -> skip SLA_NOT_BREACHED         |
   |    d. else getCurrentAssignees                                  |
   |       if empty               -> skip NO_ASSIGNEES               |
   |    e. escalateComplaintWithReason                               |
   |       - lookup supervisor (HRMS reportingTo)                    |
   |       - workflow ESCALATE transition                            |
   |       - producer.push(updateTopic, escalationTopic)             |
   |       - OTEL span attrs (fromAssignee, toAssignee, etc.)        |
   +----------------------------------------------------------------+
                                  |
                                  v
                      EscalationTriggerResponse
                      { scanned, escalated, skipped,
                        skipBreakdown, details[] }
                      + OTEL span attrs (escalation.*)
```

### The three SLA layers

| Layer | MDMS code | Key shape | Cell shape | When used | `escalation.slaSource` attribute |
|---|---|---|---|---|---|
| Category-specific | `CRS.CategorySLA` | `(path, category, subcategoryL1)` | `slaHoursByState.{new|triage|forwarded|investigation|awaiting|resolved}` — `number` (hours) \| `[min,max]` (range) \| `null` | tuple maps to a row AND the cell is non-null | `CRS.CategorySLA` |
| Per-state default | `CRS.StateSLA` (singleton `default`) | `singletonKey="default"` | `stateDefaults.{...} → number` (hours) | category row missing or cell null | `CRS.StateSLA` |
| Legacy | `RAINMAKER-PGR.EscalationConfig` | singleton | `defaultSlaByLevel[currentLevel]` + per-`serviceCode` overrides | both above empty (backward-compat for not-yet-migrated deployments) | `v0.EscalationConfig` |

The literal source-tag strings are defined in
[`PGRConstants.SLA_SOURCE_CATEGORY/STATE/V0`](../backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java#L179-L181).

### Schemas

The three schemas live in
[`utilities/default-data-handler/src/main/resources/schema/CRS.json`](../utilities/default-data-handler/src/main/resources/schema/CRS.json).
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
  [`slaService.saveStateSla`](../configurator/src/resources/crs/sla-matrix/slaService.ts#L114).
- The six state keys are the canonical CRS workflow states. Their mapping to
  the PGR/DIGIT workflow state names is wired in
  [`EscalationScheduler.mapWorkflowStateToKey`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L551)
  — see the [Tenant agnosticism](#tenant-agnosticism) caveat.

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

### Scheduler resolution algorithm

[`EscalationScheduler.resolveSlaHours`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L476)
in pseudocode:

```
SlaResolution resolveSlaHours(complaint, workflowState, crsCategorySla,
                              crsStateSlaDefaults, serviceCodeToCategory,
                              currentLevel, defaultSlaByLevel, overrides):

    categoryTuple = extractCategoryTuple(complaint, serviceCodeToCategory)
    stateKey      = mapWorkflowStateToKey(workflowState)
    unmapped      = (categoryTuple == null)

    # ---- Layer 1: CRS.CategorySLA ----
    if categoryTuple and stateKey and crsCategorySla:
        for row in crsCategorySla:
            if row.isActive == false: continue
            if row.path != categoryTuple.path: continue
            if row.category != categoryTuple.category: continue
            if row.subcategoryL1 != categoryTuple.subcategoryL1: continue
            cell = row.slaHoursByState[stateKey]
            cellMs = cellToMillis(cell)   # number -> ms, [min,max] -> max*ms, null -> null
            if cellMs != null:
                return SlaResolution(cellMs, "CRS.CategorySLA", unmapped=false)
            break   # row matched, cell null -> fall through

    # ---- Layer 2: CRS.StateSLA ----
    if stateKey and crsStateSlaDefaults:
        defHrs = crsStateSlaDefaults[stateKey]
        if defHrs != null:
            return SlaResolution(defHrs*3600*1000, "CRS.StateSLA", unmapped)

    # ---- Layer 3: v0 EscalationConfig ----
    log.info("falling back to v0 EscalationConfig srid=%s stateKey=%s", srid, stateKey)
    v0 = resolveSla(complaint.serviceCode, currentLevel, defaultSlaByLevel, overrides)
    return SlaResolution(v0, "v0.EscalationConfig", unmapped)
```

`extractCategoryTuple` (same file, line 575):

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

`mapWorkflowStateToKey` (line 551, hardcoded switch — see the caveat below):

```
mapWorkflowStateToKey(workflowState):
    PENDINGFORASSIGNMENT          -> "new"
    PENDINGATLME                  -> "forwarded"
    IN_TRIAGE | TRIAGE            -> "triage"
    FORWARDED                     -> "forwarded"
    UNDER_INVESTIGATION | INVESTIGATION -> "investigation"
    AWAITING_INFORMATION | AWAITING     -> "awaiting"
    RESOLVED                      -> "resolved"
    default                       -> null      # falls through to v0
```

Why each fallback condition exists:

- **Category miss but state matches.** The configurator allows operators to
  populate StateSLA before the per-category matrix is built out. Falling
  through gives a usable SLA even with zero CategorySLA rows.
- **No mapped state.** The complaint is in a workflow state the schema does not
  cover (e.g. a custom tenant state). The scheduler falls all the way through
  to v0 rather than refusing to escalate.
- **`unmapped` flag.** Bubbled up even when v0 answers. The scheduler counts
  it in `skipBreakdown.UNMAPPED_CATEGORY` and logs a one-liner per scan so the
  operator knows the matrix is incomplete; the complaint is not skipped on
  that account.

### Trace-back tool

The [`TraceBackDialog`](../configurator/src/resources/crs/sla-matrix/TraceBackDialog.tsx)
in the configurator is a read-only diagnostic drawer. The operator pastes a
`serviceRequestId`, the dialog fans out:

1. `POST /pgr-services/escalation/_trigger` with `serviceRequestIds: [srid]` —
   produces the scheduler's actual verdict + reason.
2. `POST /pgr-services/v2/request/_search` with the same SR id — pulls
   `applicationStatus`, `serviceCode`, the additionalDetail tuple.
3. Resolves the SLA from the in-memory matrix (CategorySLA → StateSLA) using
   the **same precedence as the backend scheduler** so the preview agrees with
   the verdict for unbreached complaints.

The drawer renders:

| Pane | Source | Shows |
|---|---|---|
| Scheduler verdict | `/escalation/_trigger` `details[0]` | `action`, `reason` (e.g. `SLA_NOT_BREACHED`), `detail` (e.g. `elapsed=512908ms, sla=3600000ms`) |
| Complaint | `/v2/request/_search` | SR id, status, serviceCode, path, category, subcategoryL1 |
| Resolved SLA | local computation from `rows` + `stateDefaults` | source (CategorySLA / StateSLA), value, raw cell |

Use case: an operator pages a citizen complaint that "should have escalated".
They paste the SR id into Trace escalation, see
`SLA_NOT_BREACHED elapsed=512908ms sla=3600000ms` and immediately understand
that the SLA for that category is set to one hour, not one minute. They open
the matrix, edit the cell, hit Save, and the next scheduler tick (≤5 min)
escalates the complaint.

### Audit log

Every successful write to `CRS.CategorySLA` or `CRS.StateSLA` is followed by
a `CRS.SLAAuditLog` entry via
[`slaService.writeAuditEntry`](../configurator/src/resources/crs/sla-matrix/slaService.ts#L135):

| Operation | When | Action enum | Granularity |
|---|---|---|---|
| Inline row edit | after each successful row save in `handleSaveAll` | `create` (new row) or `update` | one entry per row |
| State-defaults edit | after `saveStateSla` returns | `create` or `update` | one entry |
| Soft-delete row | after `deactivateCategoryRow` returns | `delete` | one entry, reason `soft-delete via deactivation` |
| Bulk import | after the import-fan-out finishes | `bulk-import` | **one summary entry per import**, reason `<imported> rows imported, <failed> failed` |

The audit write is best-effort: if it fails, the MDMS write has already
landed, so a warning is logged and the data write is not rolled back.
This is escalation-specific scope today; a generic `CRS.ConfigAuditLog`
supersedes it in roadmap phase **G4** (see
[`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md) Cross-cutting
section).

---

## Configurator UI

The escalation page is a **single-page editor** inside the existing
`digit-configurator` SPA. There is no separate list/show/edit triad
(react-admin's default pattern) because the matrix itself is the editor:
every cell is independently editable, the row is the unit of meaning,
and there is no per-row identifier worth surfacing in the URL.

### Information architecture

The sidebar gets a new top-level group called **ESCALATION** with two
siblings under it:

- **SLA Matrix** (`/manage/crs-sla-matrix`) — the new editor described
  in the rest of this section.
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
  **Trace escalation…** button top-right that opens the read-only
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
  (clicking opens the same defaults editor inline).
- **Matrix grid** — sticky-left columns (`Path`, `Category`,
  `Subcategory L1`, `Active`) followed by six state columns:
  `NEW`, `TRIAGE`, `FORWARDED`, `INVESTIGATION`, `AWAITING`,
  `RESOLVED`. Cells render either a number, a range, or a muted dash
  for "use default" (see [Cell semantics](#cell-semantics)).
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
Trace escalation… button. Read-only diagnostic over
`POST /escalation/_trigger` (see below).

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

The "muted dash + default hint" treatment is deliberate: operators
should be able to scan the grid and instantly see which cells are
policy-overridden versus inherited from the per-state default.

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

Every save produces audit entries:

- **Per-row** writes (create / update / soft-delete) produce one
  `CRS.SLAAuditLog` row each.
- **Bulk import** produces a single summary entry with
  `action = bulk-import` and a reason of the shape
  `"<imported> rows imported, <failed> failed"`, plus one row entry per
  successfully-imported row (so per-row provenance is preserved).
- The drawer renders the last N entries with timestamp, user,
  `action`, identifier (`<path>/<category>/<subcategoryL1>` or
  `state-defaults`), and a JSON diff for create/update entries.

Audit is escalation-specific today. The generic `CRS.ConfigAuditLog`
under roadmap **G4** supersedes this drawer with a cross-feature
"recent changes" view (see
[`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)
Cross-cutting section).

### Trace-back drawer (operator debug surface)

The trace-back drawer is the answer to "why didn't this complaint
escalate?" — a question that previously required reading scheduler
logs.

Operator flow:

1. Open from the header's **Trace escalation…** button.
2. Paste a `serviceRequestId` from a stuck complaint, submit.
3. Drawer calls `POST /escalation/_trigger` (read-only; see
   [`EscalationController`](../backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/EscalationController.java))
   and renders the per-complaint outcome: `action`, `reason`, `detail`,
   `slaSource`, `fromAssignee`, `toAssignee`.

The endpoint **does not** mutate state — it runs the same decision
function the scheduler runs, but the actual escalation only happens on
the scheduler's tick. This is the diagnostic surface for replacing
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
as a starter template. The CSV format mirrors the matrix columns
(`path,category,subcategoryL1,active,new,triage,forwarded,investigation,awaiting,resolved`).

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
the home for trace-back tooling, future per-tenant escalation policies
(e.g. holiday calendars), and any cross-category SLA reporting.

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
  ([`CategorySlaMatrixPage.tsx` line 162-165](../configurator/src/resources/crs/sla-matrix/CategorySlaMatrixPage.tsx#L162)).
- `DEFAULT_STATE_DEFAULTS` is all-null
  ([`types.ts` line 101-108](../configurator/src/resources/crs/sla-matrix/types.ts#L101)).
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
- **Known wart:**
  [`mapWorkflowStateToKey`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L551)
  today hardcodes a switch from DIGIT-PGR state names
  (`PENDINGFORASSIGNMENT`, `PENDINGATLME`, ...) to the CRS canonical keys.
  This is the one piece of tenant-specific knowledge baked into the scheduler.
  Future work (see follow-up PR linked from this PR's description) replaces it
  with a `CRS.WorkflowStateMapping` MDMS record so each tenant can wire their
  own workflow state names. Until that follow-up lands, a tenant whose
  workflow uses non-PGR state names falls through to v0 for any complaint not
  in one of the seven mapped states.

The implication: Bomet (Kenya, PGR), Nairobi (Kenya, PGR), and the future
Mozambique CRS deployment all run **the same code** and **the same schemas**.
They differ only in the rows they populate.

---

## Wiring strategies (tenant data → CategorySLA)

Two valid strategies for connecting a tenant's existing complaint data to the
CategorySLA lookup, both supported by
[`extractCategoryTuple`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L575).

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
[`buildServiceCodeMapping`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L645)
and resolves through it. The complaint's `serviceCode` is the join key.

| Property | Value |
|---|---|
| Best for | Existing deployments with legacy intake forms that already populate `serviceCode` |
| Backend dependency | None — fields are read from MDMS, no schema-version bump |
| UI dependency | Category Taxonomy editor (**roadmap G1**) for ergonomic management of the canonical category list |
| Migration risk | Low — adding fields to ServiceDefs is non-breaking; existing serviceCodes without the new fields silently aren't mapped |

### What happens if neither is wired

`extractCategoryTuple` returns `null` →
[`resolveSlaHours`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L476)
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
   [`crs-sla-matrix.spec.ts` line 127-140](../configurator/e2e/crs-sla-matrix.spec.ts)
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

**Symptom.** On Bomet, `/escalation/_trigger` returns
`skipBreakdown: { NO_ASSIGNEES: 55 }` even though complaints have been
ASSIGNed. `SELECT * FROM eg_wf_assignee_v2 WHERE processinstanceid IN (...)`
returns 0 rows.

**Root cause.** DIGIT `egov-workflow-v2` ASSIGN action does not persist
assignees to `eg_wf_assignee_v2` — an upstream egov-workflow-v2 bug to be
raised against the workflow-v2 repo separately.

**Effect on the scheduler.** Without an assignee,
[`EscalationScheduler` line 191-199](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java#L191)
trips at `NO_ASSIGNEES` and never reaches the SLA layer. This is why the
live Bomet scheduler shows `skipBreakdown.NO_ASSIGNEES` dominating.

**Workaround.** None on the CRS side — this needs an upstream fix in
`egov-workflow-v2`. The new `history=true` fallback in
[`EscalationService.getCurrentAssignees`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java#L206)
recovers when the *current* `ProcessInstance` is empty but a historical one
carries assignees; it does nothing when the assignees were never persisted
in the first place.

### `egov-mdms-v2` validator and `oneOf` on `slaHoursByState`

We tried `oneOf: [number, [number, number], null]` in
`slaHoursByState.additionalProperties` and the validator threw
`ClassCastException` walking the schema. So the schema declares
`additionalProperties: true` and the application code (`cellToMillis` in
the scheduler; `parseCell` + the table-row validator in the configurator)
enforces shape and bounds. Schema-level validation will return only when
mdms-v2 stops choking on the union type.

---

## Testing strategy

Five layers, top-down.

### Layer 1 — Backend unit tests

- **File.** [`backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java)
- **What it covers** (4 tests):
  1. `resolveSlaHours_categorySla_hit` — `(path, category, subcategoryL1)`
     hits a row with a concrete cell; expect MS value and
     `source == CRS.CategorySLA`.
  2. `resolveSlaHours_categorySla_range_collapses_to_max` — `[24, 120]`
     range cell resolves to `120 * 3600 * 1000 ms` (MAX); source still
     `CRS.CategorySLA`.
  3. `resolveSlaHours_stateSla_fallback` — row exists but its cell is null;
     falls to StateSLA; expect StateSLA hours; source `CRS.StateSLA`.
  4. `resolveSlaHours_v0_fallback_when_crs_empty_and_unmapped` — no tuple,
     no CategorySLA, no StateSLA; v0 answers; expect v0 ms value; source
     `v0.EscalationConfig`; `unmapped=true`.
- **Run.**

  ```bash
  cd backend/pgr-services && mvn test -Dtest=EscalationSchedulerSlaResolutionTest
  ```

- **Why these four.** They pin every transition in the resolution algorithm:
  the happy path, the range-collapse rule, the two boundary fall-throughs.
  Anything else is a combination of these.

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

- **Why this layer.** The configurator is the only operator-facing entry
  point; if the page can't render or the deprecation banner doesn't show,
  no amount of correct backend behaviour helps.

### Layer 4 — Integration tests

- **Files.**
  - [`tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts)
    — full API chain: create complaint → assign → cap SLA → trigger →
    assert OTEL attributes in Tempo.
  - [`tests/integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts)
    — `ESCALATE_COMMENT_REQUIRED` validator: manual ESCALATE without a
    comment must fail.
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
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {
      "apiId": "Rainmaker",
      "authToken": "'"$TOKEN"'",
      "userInfo": { "roles": [{ "code": "SUPERUSER", "tenantId": "ke" }] }
    },
    "tenantId": "ke"
  }' \
  "https://<deployment>/pgr-services/escalation/_trigger"

# Expected response shape:
# {
#   "scanned":   <int>,
#   "escalated": <int>,
#   "skipped":   <int>,
#   "skipBreakdown": { "NO_ASSIGNEES": ..., "SLA_NOT_BREACHED": ... },
#   "details": [
#     { "serviceRequestId": "...", "action": "SKIPPED|ESCALATED",
#       "reason": "...", "detail": "elapsed=... sla=..." },
#     ...
#   ]
# }
```

To confirm which SLA layer fired, pull the corresponding trace from Tempo
and look for the `escalation.slaSource` attribute on the
`POST /pgr-services/escalation/_trigger` span. Values:
`CRS.CategorySLA` | `CRS.StateSLA` | `v0.EscalationConfig`.

For the Bomet operator runbook (Tempo curl + log greps), see
[`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md).

---

## Open questions and deferred work

| # | Item | Tracking |
|---|---|---|
| 1 | Hardcoded PGR→CRS state-name mapping in `mapWorkflowStateToKey` — replace with a `CRS.WorkflowStateMapping` MDMS record per tenant | see follow-up PR linked from this PR's description |
| 2 | Upstream DIGIT workflow ASSIGN-assignee persistence bug — blocks end-to-end escalation testing on Bomet | upstream `egov-workflow-v2`, to be raised against the workflow-v2 repo separately |
| 3 | Category Taxonomy editor (constrained picker) — replaces the free-text category/subcategoryL1 inputs in the SLA Matrix | Roadmap phase **G1** ([`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)) |
| 4 | Path Routing Rules — `(category, subcategoryL1) → path` editable rules | Roadmap phase **G2** |
| 5 | Submission Form Customization — required for **Strategy A** wiring of new tenants | Roadmap phase **G8** |
| 6 | Generic `CRS.ConfigAuditLog` supersedes the escalation-specific `CRS.SLAAuditLog` | Roadmap phase **G4** |
| 7 | v0 EscalationConfig deletion (post-migration) | Follow-up PR, no task yet |
| 8 | mdms-v2 `oneOf` validator fix — would allow declarative `slaHoursByState` cell-shape validation | upstream, no task |

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
| **slaSource** | OTEL span attribute set by the scheduler indicating which layer answered the SLA lookup. One of `CRS.CategorySLA`, `CRS.StateSLA`, `v0.EscalationConfig`. |
| **skipReason** | One of the eight values in [`EscalationSkipReason`](../backend/pgr-services/src/main/java/org/egov/pgr/util/EscalationSkipReason.java): `MAX_DEPTH_REACHED`, `NO_LAST_MODIFIED_TIME`, `SLA_NOT_BREACHED`, `NO_ASSIGNEES`, `NO_SUPERVISOR_IN_HRMS`, `WORKFLOW_TRANSITION_FAILED`, `UNMAPPED_CATEGORY`, `SUCCESS`. |
| **BRD** | Business Requirements Document. The Mozambique PRD/CRS v4.0 PDF is referenced throughout this codebase only as an industry source for the *shape* of generic CRS configuration. No BRD-specific data is seeded by PR #770. |
| **IGE / IGSAE** | BRD-specific path names — IGE (Inspecção-Geral do Estado, public-service complaints) and IGSAE (Inspecção-Geral das Actividades Económicas, economic-agent complaints). Used here only as **examples** of what a tenant might populate as their `path` value; the schema accepts any string. |
| **Tuple** | Shorthand for `(path, category, subcategoryL1)`, the join key of `CRS.CategorySLA`. |
| **Strategy A / B** | The two supported ways to wire complaint data into the CategorySLA lookup. A = rich intake (tuple on `additionalDetail`). B = ServiceDefs extension (`serviceCode → tuple` map). |

---

## Cross-references

- **Implementation PR**: [`#770 feat/escalation-otel-configurator-designer`](https://github.com/egovernments/Citizen-Complaint-Resolution-System/pull/770)
- **BRD source (in repo)**: `/escalation/BRD_ Plataforma de Reclamacoes e Denuncias V4.0 ENG.docx.pdf`
- **General CRS Configurator roadmap (sibling doc)**: [`docs/crs-configurator-roadmap.md`](./crs-configurator-roadmap.md)
- **Bomet deployment operational notes**: [`docs/escalation-feature-bomet.md`](./escalation-feature-bomet.md)
- **Recovery SQL** (x-ref-schema + path-enum): [`configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql`](../configurator/src/resources/crs/sla-matrix/_seed/fix-xref-schema.sql)
- **Example seed CSV** (generic): [`configurator/src/resources/crs/sla-matrix/_seed/example.csv`](../configurator/src/resources/crs/sla-matrix/_seed/example.csv)

### Source-of-truth files

| Concern | File |
|---|---|
| Scheduler entry-point | [`backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationScheduler.java) |
| Per-complaint escalation action | [`backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java`](../backend/pgr-services/src/main/java/org/egov/pgr/service/EscalationService.java) |
| Skip-reason enum | [`backend/pgr-services/src/main/java/org/egov/pgr/util/EscalationSkipReason.java`](../backend/pgr-services/src/main/java/org/egov/pgr/util/EscalationSkipReason.java) |
| Admin endpoint | [`backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/EscalationController.java`](../backend/pgr-services/src/main/java/org/egov/pgr/web/controllers/EscalationController.java) |
| SLA-source constants | [`backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java`](../backend/pgr-services/src/main/java/org/egov/pgr/util/PGRConstants.java) (lines 179-181) |
| MDMS schemas | [`utilities/default-data-handler/src/main/resources/schema/CRS.json`](../utilities/default-data-handler/src/main/resources/schema/CRS.json) |
| Configurator page | [`configurator/src/resources/crs/sla-matrix/CategorySlaMatrixPage.tsx`](../configurator/src/resources/crs/sla-matrix/CategorySlaMatrixPage.tsx) |
| Configurator types | [`configurator/src/resources/crs/sla-matrix/types.ts`](../configurator/src/resources/crs/sla-matrix/types.ts) |
| Configurator service layer | [`configurator/src/resources/crs/sla-matrix/slaService.ts`](../configurator/src/resources/crs/sla-matrix/slaService.ts) |
| Trace-back drawer | [`configurator/src/resources/crs/sla-matrix/TraceBackDialog.tsx`](../configurator/src/resources/crs/sla-matrix/TraceBackDialog.tsx) |
| Bulk import dialog | [`configurator/src/resources/crs/sla-matrix/BulkImportDialog.tsx`](../configurator/src/resources/crs/sla-matrix/BulkImportDialog.tsx) |
| CSV parser | [`configurator/src/resources/crs/sla-matrix/csvParser.ts`](../configurator/src/resources/crs/sla-matrix/csvParser.ts) |
| Backend unit tests | [`backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java`](../backend/pgr-services/src/test/java/org/egov/pgr/service/EscalationSchedulerSlaResolutionTest.java) |
| Configurator e2e tests | [`configurator/e2e/crs-sla-matrix.spec.ts`](../configurator/e2e/crs-sla-matrix.spec.ts) |
| Integration tests | [`tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-escalation-trigger-bomet.spec.ts), [`pgr-manual-escalate-comment.spec.ts`](../tests/integration-tests/tests/lifecycle/pgr-manual-escalate-comment.spec.ts), [`escalation-configurator-bomet.spec.ts`](../tests/integration-tests/tests/admin/escalation-configurator-bomet.spec.ts) |

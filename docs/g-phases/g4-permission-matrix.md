# G4: Role Permission Matrix editor

> Status: **DESIGN — NOT IMPLEMENTED**. This document scopes the SHAPE of
> the phase. The companion draft PR reserves the MDMS schema codes
> (`CRS.RolePermissionMatrix`, `CRS.ConfigAuditLog`) so a future
> implementation PR can fill them in without re-litigating the
> registration. Architectural feedback should land on the linked GitHub
> Discussion.

---

## Why

Every CRS tenant runs the same six PGR/CRS workflow roles against the same
small set of complaint-lifecycle functions — view, edit, assign, close, see
the dashboard, change configuration. Today the mapping is split across
three places:

1. The PGR backend workflow state machine (which roles can fire which
   action).
2. The configurator's left-sidebar role gates (which roles see which
   menu entry).
3. The new `/escalation/_trigger` admin endpoint shipped in PR #770
   (ADMIN-only by hardcoded role check).

This phase generalises (1)–(3) into a **single editable surface** — a
per-tenant matrix of `roles × functions` with constrained cell values,
plus a sibling audit log that captures every save. Once this lands, the
matrix becomes the single source of truth that subsequent phases (G5–G8)
gate against.

Reference: BRD §5.2 "Permission Matrix" (six roles × five functions with
explicit Yes / No / Read-only cells); CRS Configurator roadmap
`docs/crs-configurator-roadmap.md` §"Phase G4 — Role Permission Matrix".

---

## Scope

**In this phase:**
- Read/edit UI for the 6×5 matrix (roles down, functions across).
- Per-cell value picker constrained to
  `{ yes, no, read-only, operational, executive }` — mirroring the BRD,
  including the dashboard column's `Operational` / `Executive` variants.
- New MDMS schema `CRS.RolePermissionMatrix` (single record per tenant).
- New MDMS schema `CRS.ConfigAuditLog` (introduced here, reused by every
  later G-phase that mutates configurator state).
- Backend permission middleware in `pgr-services` that reads the matrix
  once per request (Redis-cached, invalidated on save) and enforces it
  for `_close`, `_assign`, and the `_trigger` endpoint from PR #770.
- "Reset to BRD defaults" button that re-seeds the matrix from the
  BRD §5.2 verbatim values.

**Explicitly OUT (deferred):**
- Adding new roles beyond the BRD's six (would invalidate the workflow
  state machine; needs its own phase).
- Adding new functions beyond the BRD's five (same reason).
- Per-tenant *function* customisation (only per-tenant *cell-value*
  customisation is in scope).
- Cross-tenant matrix templates / import-export (G6 territorial phase
  may revisit this).
- History-diff UI for the audit log; G4 ships the raw audit-log viewer
  only. A richer diff view is a follow-up.
- Migrating the configurator's existing sidebar role gates to consult
  the matrix at render time — G4 only enforces server-side. The sidebar
  migration is a sibling track.

---

## MDMS schemas

Two new schema codes are reserved by this PR. Both are committed as
empty-shell stubs in
`utilities/default-data-handler/src/main/resources/schema/CRS.G4.json`
with `isActive: false` so MDMS won't accept records against them until
the implementation PR fills the shape in.

### `CRS.RolePermissionMatrix`

Single record per tenant. Holds the full 6×5 grid.

```json
{
  "tenantId": "ke.bomet",
  "version": 1,
  "cells": [
    { "role": "RECEPTION_TECHNICIAN", "function": "VIEW_CASES",     "value": "yes" },
    { "role": "SUPERVISOR",           "function": "CLOSE",          "value": "yes" },
    { "role": "LEADERSHIP",           "function": "VIEW_DASHBOARD", "value": "executive" }
  ],
  "updatedBy": "user-uuid",
  "updatedAt": 1717891200000
}
```

Schema-level constraints (`required`, `x-unique`, `additionalProperties:
false`) match the rest of the `CRS.*` family. Per-cell enum validation
for `role` / `function` / `value` is JSON-Schema-native (no
application-side workaround needed — unlike `slaHoursByState`, which
had to defer numeric/array cell-shape validation to the client).

### `CRS.ConfigAuditLog`

Append-only. One row per save across all CRS.* configurator screens
from G4 onwards.

```json
{
  "id": "uuid",
  "tenantId": "ke.bomet",
  "schemaCode": "CRS.RolePermissionMatrix",
  "recordCode": "ke.bomet",
  "action": "UPDATE",
  "beforeJson": "...",
  "afterJson": "...",
  "actorUserId": "user-uuid",
  "actorRoles": ["ADMINISTRATOR"],
  "at": 1717891200000
}
```

---

## Configurator routes + UI sketch

### New routes (under `/manage/crs/...`)

- `/manage/crs-permissions` — the 6×5 grid editor.
- `/manage/crs-audit` — generic config audit-log viewer with filters by
  `schemaCode`, actor, and date range.

### Sidebar nav

Both routes land in the **Governance** sidebar group (existing group;
currently holds escalation-config + designation-tree). New group only
if Governance ends up with more than ~6 entries by end of G-phases.

### Page anatomy — `/manage/crs-permissions`

- **Header**: tenant name + "Role Permission Matrix" + last-saved
  timestamp + "Reset to BRD defaults" button (with confirm modal).
- **Toolbar**: search box (filter rows by role name); "Save changes"
  button (disabled when no diff vs. last saved state).
- **Body**: the matrix itself. Wireframe:

```
                       View   Edit   Assign  Close   Dashboard
Reception Technician   [yes]  [no ]  [no  ]  [no ]   [no   ]
Screening Technician   [yes]  [yes]  [yes ]  [no ]   [no   ]
Case Manager           [yes]  [yes]  [yes ]  [no ]   [no   ]
Supervisor             [yes]  [yes]  [yes ]  [yes]   [opera]
Leadership             [yes]  [r/o]  [no  ]  [no ]   [execu]
Administrator          [yes]  [yes]  [yes ]  [yes]   [opera]

                                              [Save changes]
```

Each `[...]` cell is a dropdown constrained to the five allowed values.
Cells with non-default values render with a subtle background so the
operator can see at a glance what's been customised.

### Page anatomy — `/manage/crs-audit`

Standard configurator list page: filter panel (`schemaCode`
multi-select, actor combobox, date range), virtualised table with
columns `at`, `actor`, `schemaCode`, `recordCode`, `action`, and a
"view diff" expander reusing the JSON-diff component from the
EscalationConfig editor (#770).

---

## API endpoints touched

### MDMS v2 (the default path)

- `POST /mdms-v2/v2/_create/CRS.RolePermissionMatrix` — write.
- `POST /mdms-v2/v2/_search` with `schemaCode=CRS.RolePermissionMatrix`
  — read.
- `POST /mdms-v2/v2/_create/CRS.ConfigAuditLog` — write (called
  server-side by the configurator-bff on every successful save).
- `POST /mdms-v2/v2/_search` with `schemaCode=CRS.ConfigAuditLog` —
  read for the audit viewer.

### Backend services that need new endpoints

None new. But one **new middleware** in `pgr-services` (~50 LOC):

- Reads the matrix once per request from Redis cache key
  `crs.permission.matrix.<tenant>` (mirrors the `validationRules`
  pattern from the CCRS mobile-validation work).
- On cache miss, falls through to MDMS v2 and re-populates Redis.
- Cache key is invalidated by the configurator-bff `_create` /
  `_update` call (publish to a dedicated Redis pub/sub topic
  `crs.permission.matrix.invalidate`; pgr-services subscribes).
- Filter applies to: `pgr-services/v2/_assign`,
  `pgr-services/v2/_close`, `pgr-services/escalation/_trigger`.

---

## Dependencies on prior phases

**Hard dependencies (must ship first):**
- PR #770 — escalation foundation. The `/escalation/_trigger` endpoint
  is the headline thing G4 enforces against.

**Soft dependencies (nice to have first, not blocking):**
- PR #A (state-name MDMS), PR #B (wiring-strategies doc) — orthogonal.
- G1 / G3 — would benefit from `CRS.ConfigAuditLog` if they ship after
  G4; if they land first they get retrofitted.

**What this phase blocks:**
- G5 (Notification Templates) — wants `CRS.ConfigAuditLog` for save
  history.
- G6 (Territorial Hierarchy) — same.
- G7 (Dashboard Configuration) — depends on the matrix for the
  `accessLevel` field (Operational / Executive cells gate which
  indicators a role sees).
- G8 (Submission Forms) — same audit-log dependency.

---

## Acceptance criteria

Operator-runnable checks that confirm G4 is fully shipped:

1. **Seed parity** — On a fresh tenant, the matrix loads with the BRD
   §5.2 verbatim defaults; all 30 cells match exactly.
2. **Edit-then-enforce** — Flipping `Supervisor / Close` from `yes` to
   `no` causes a Supervisor's `POST /pgr-services/v2/_close` to return
   HTTP 403 within one request (no service restart), with a structured
   `reason` field naming the denying tuple.
3. **Audit-log row** — Every save writes exactly one
   `CRS.ConfigAuditLog` row with non-empty `beforeJson` / `afterJson`,
   the correct `actorUserId`, and an `at` within ±2s of the save.
4. **Cache invalidation** — `redis-cli GET crs.permission.matrix.<tenant>`
   is deleted within 500ms of a save.
5. **Escalation gate** — `POST /escalation/_trigger` 403s when
   `(ADMINISTRATOR, EDIT_CASES)` flips to `no`.
6. **Reset-to-defaults** — "Reset to BRD defaults" produces an
   audit-log row whose `afterJson` matches the BRD seed byte-for-byte.
7. **Audit viewer** — `/manage/crs-audit` filtered by
   `schemaCode=CRS.RolePermissionMatrix` shows the last N saves in
   reverse-chronological order with a working diff expander.

---

## Estimated effort

**M (~3–4 days)** — small grid UI, one MDMS schema with strict enums,
one shared backend filter, one ConfigAuditLog schema that pays for
itself across G5–G8. Bulk of the work is the Redis-cache invalidation
plumbing (mirror the validationRules pattern) and the audit-viewer
diff component (reuse from EscalationConfig editor).

---

## Open questions

1. **Sidebar gating vs. server enforcement parity** — should the
   configurator sidebar consult the matrix at render time, or stay on
   the existing hardcoded role gates and let server-side 403s be the
   only enforcement? Server-side is the authoritative answer, but a
   sidebar that shows a menu the user can't actually use is a poor UX.
2. **Audit-log retention** — does `CRS.ConfigAuditLog` get a TTL, or
   grow unbounded? MDMS v2 has no native TTL; we'd need a periodic
   purge job. If we go unbounded, the audit-viewer needs server-side
   pagination from day one.
3. **Dashboard cell values** — the BRD uses `Operational` /
   `Executive` only for the dashboard column. Do we constrain the
   value picker per-column (dashboard column gets a different option
   set than the other four), or accept any of the five values in any
   cell and treat mismatched values as "no" at enforcement time?
4. **Migration of existing roles** — DIGIT ships with roles like
   `EMPLOYEE`, `CITIZEN`, `ULB_ADMIN` that don't map 1:1 to the BRD's
   six. Do we auto-create the six BRD roles in keycloak/eg_userrole
   on tenant bootstrap, or document a manual setup step?
5. **Per-cell vs. atomic save** — should each cell-edit POST
   individually (more audit rows, finer-grained undo), or does the
   whole grid save atomically as one record (one audit row per save,
   simpler invalidation)? Roadmap currently assumes atomic.

---

## Cross-references

- **Discussion** — (filled in after the Discussion is created and
  cross-linked from the draft PR)
- **Roadmap** — [docs/crs-configurator-roadmap.md](../crs-configurator-roadmap.md)
  §"Phase G4 — Role Permission Matrix"
- **Escalation design doc** — [docs/escalation-feature-design.md](../escalation-feature-design.md)
  (the `/escalation/_trigger` endpoint that G4 gates)
- **PR #770** — escalation foundation (provides the endpoint, the
  OTEL spans, and the SLA scheduler that G4 enforces against)
- **CategorySLA wiring strategies** — [docs/categorysla-wiring-strategies.md](../categorysla-wiring-strategies.md)
  (sibling doc from PR #B; G4 is orthogonal but operators reading
  the G-phase docs in order will hit them together)

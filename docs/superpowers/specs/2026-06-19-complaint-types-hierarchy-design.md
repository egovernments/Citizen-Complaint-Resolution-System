# Complaint Types — Hierarchical Type → Sub-Type UI

**Date:** 2026-06-19
**Status:** Design approved (pending written-spec review)
**Area:** `configurator/` — Complaint Management section, `complaint-types` resource

## Problem

Today `/complaint-types` is a **flat list of sub-types**. Each row is a single
`RAINMAKER-PGR.ServiceDefs` MDMS record. Operators have no way to see the
**Complaint Types** (the `menuPath` groups) and the **Sub-Types** beneath each
one, nor a clean flow to create/edit a type or add/edit/delete a sub-type in
that hierarchy.

We want a two-level UI: see Complaint **Types** first, expand one to see its
**Sub-Types**, and manage both levels — delivered **incrementally**, one
shippable increment at a time.

## Data model reality (the constraint everything follows from)

A "Complaint Type" is **not a stored entity**. It is the `menuPath` value
shared across sub-type records. There are two distinct things in two places:

- **The code (`menuPath`)** — an internal grouping ID (e.g. `SANITATION`)
  stamped onto *every* sub-type's MDMS record. Not shown to users. It is also
  what the localization key is derived from. Acts like a primary-key/slug.
- **The display name** — the human label users see, stored in the
  **localization service** under `SERVICEDEFS.<MENUPATH_UPPER>`, once per
  locale. Acts like a freely-editable title.

Consequences:
- A type cannot exist in the data until it has ≥1 sub-type.
- Renaming the **display name** = one localization upsert per locale + cache
  bust (cheap, safe).
- Renaming the **code** = fan-out update across all sub-types + orphaned old
  label key (expensive, risky) — **out of scope**.
- Deleting the **last** sub-type empties a type, so the type disappears.

## Available APIs (already in the frontend — no backend changes)

All operations compose existing primitives; no new endpoints required.

- **react-admin data provider** (`packages/data-provider`), used via hooks:
  - `getList('complaint-types')` → fetch all + client-side filter/sort
    (supports grouping/filtering by `menuPath` in the component).
  - `create` → `mdmsCreate` (add sub-type / create type's first sub-type).
  - `update` → `mdmsUpdate(record, true)` (edit sub-type).
  - `delete` → `mdmsUpdate(record, false)` — **soft delete** (`isActive:false`);
    MDMS has no hard delete.
- **Localization service** (`src/api/services/localization.ts`):
  - `uploadComplaintTypeLocalizations(...)` emits the sub-type keys **and** the
    parent type label `SERVICEDEFS.<MENUPATH_UPPER>`.
  - `cacheBust()` — must follow any label change.
- **i18n** — `useTranslate()` (ra-core) resolves `SERVICEDEFS.<MENUPATH_UPPER>`
  for display, falling back to the raw `menuPath`.

## UX design — decisions

| Decision | Choice |
|---|---|
| Navigation pattern | **Expandable accordion rows** (Types → expand → nested Sub-Types) |
| Create Type | **Combined form**: new Type + its first Sub-Type in one submit |
| Edit Type | **Display name only** (localization); code stays fixed |
| Add Sub-Type | Create form with `menuPath` pre-filled from the type |
| Edit Sub-Type | Existing edit form / inline |
| Delete Sub-Type | Soft-delete; deleting the **last** sub-type warns strongly, then removes the type |
| Delete Type | **Out of scope** (emptying all sub-types is how a type is removed) |
| Code rename | **Out of scope** |

## Incremental delivery plan

Each increment is independently shippable and useful on its own. Order is fixed
and approved.

1. **Read-only accordion view** — restructure `/complaint-types` into expandable
   Type rows with nested Sub-Types. *No CRUD changes.* (Detailed below.)
2. **Add Sub-Type** — "+ Add Sub-Type" inside an expanded Type, `menuPath`
   pre-filled; reuses existing create + localization seeding.
3. **Edit / Delete Sub-Type** — row actions: edit (existing form) + soft-delete
   with the last-sub-type warning.
4. **Create Complaint Type** — combined Type + first-Sub-Type form, seeding the
   type label.
5. **Edit Complaint Type** — rename display name via localization + cache bust.

Increments 2–5 each get their own spec → plan → implementation cycle. This
document specifies **increment 1** in detail and outlines 2–5.

---

## Increment 1 — Read-only accordion view (detailed)

### Scope
Replace the flat `ComplaintTypeList` with a two-level accordion. **View only.**
No add/edit/delete affordances (those are later increments). No search (deferred).

### Behavior
- **Grouping:** fetch all sub-type records (`useGetList('complaint-types')`,
  large `perPage` since the set is small — tens to low hundreds per tenant) and
  group by `menuPath`. Records with no `menuPath` fall into an
  **"Uncategorized"** group rendered last.
- **Type display name:** `translate('SERVICEDEFS.' + menuPath.toUpperCase())`,
  falling back to the raw `menuPath` string when no label key exists.
- **Type ordering:** by the group's **minimum `order`** value (ascending),
  tie-broken by display name; Uncategorized always last.
- **Sub-type ordering within a group:** by `order` ASC, tie-broken by
  `serviceCode` ASC.
- **Default state:** **all collapsed** on load. Expand/collapse is local
  component state.
- **Type row content:** chevron · display name · sub-type **count** · **active
  rollup** (e.g. "2 active" derived from each record's `active` field).
- **Sub-type nested table columns:** Sub-Type (`name`) · Service Code
  (`serviceCode`) · Department (`department`) · SLA (`slaHours`) · Status
  (`active` → Active/Inactive chip).
- **Clicks:** clicking a Type row toggles expand/collapse; clicking a Sub-Type
  row navigates to the existing Sub-Type **Show** page
  (`/manage/complaint-types/:id/show`).

### Component design (isolation/testability)
- `ComplaintTypeList.tsx` — rewritten as the accordion container: data
  fetching, render of Type rows + expansion state.
- `groupComplaintTypes(records, translate)` — **pure helper** (own file) that
  returns the grouped structure: `[{ menuPath, label, count, activeCount,
  subTypes[] }]` with Uncategorized last. Unit-tested.
- `SubTypeTable` — presentational nested table for one group's sub-types.
- Reuse existing `StatusChip`/`Badge` for status and rollup chips.

### Edge cases
- No complaint types at all → empty state ("No complaint types yet").
- Group with all sub-types inactive → "0 active" rollup, still expandable.
- Missing `SERVICEDEFS.<MENUPATH>` label → show raw `menuPath` code.
- `menuPath` casing: group case-insensitively on the upper-cased code so
  `Sanitation`/`SANITATION` don't split into two groups; display uses the label.

### Testing
- Unit tests (vitest) for `groupComplaintTypes`: grouping, count + active
  rollup, Uncategorized bucket, label fallback, case-insensitive grouping,
  ordering by `order` (type-level min-order and sub-type-level), Uncategorized
  last.
- Manual verification in the running dev server against a real tenant.

### Files touched
- `src/resources/complaint-types/ComplaintTypeList.tsx` (rewrite)
- `src/resources/complaint-types/groupComplaintTypes.ts` (new)
- `src/resources/complaint-types/groupComplaintTypes.test.ts` (new)
- `src/resources/complaint-types/SubTypeTable.tsx` (new)
- No changes to `App.tsx`, the data provider, or the registry.

### Out of scope for increment 1
Add/edit/delete (increments 2–5), search/filter, delete-type, code rename,
drag-reorder of `order`.

---

## Increments 2–5 — outline

- **2. Add Sub-Type:** action in an expanded Type opens the create form with
  `menuPath` pre-filled and locked; reuses `ComplaintTypeCreate` +
  `afterCreate` localization seeding.
- **3. Edit / Delete Sub-Type:** per-row edit (existing `ComplaintTypeEdit`) and
  delete via `dataProvider.delete` (soft). Confirmation dialog; when it is the
  last sub-type in the group, a stronger warning notes the whole type will be
  removed.
- **4. Create Complaint Type:** "+ Add Complaint Type" opens a combined form
  capturing the new type's display name + its first sub-type; creates one MDMS
  record under the new `menuPath` and seeds `SERVICEDEFS.<MENUPATH>` + sub-type
  label keys, then cache-busts.
- **5. Edit Complaint Type:** rename the type's display name only — localization
  upsert of `SERVICEDEFS.<MENUPATH>` across locales + `cacheBust()`. No record
  changes.

## Non-goals
- Hard delete of any record (MDMS has none).
- Renaming a `menuPath` code / merging or splitting types.
- A standalone "Delete Complaint Type" action.
- Backend/MDMS/data-provider/registry changes (feature is frontend-only).

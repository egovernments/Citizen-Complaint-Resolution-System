# G1: Category Taxonomy editor

> **Status:** Design only. Implementation tracked in draft PR (linked in Cross-references).
> Architectural discussion belongs in the linked GitHub Discussion; this doc captures the
> committed design.

## Why

The CRS Configurator currently lets operators type a free-text category into the SLA
Matrix (`CRS.CategorySLA.category`, `subcategoryL1`) shipped in PR #770. This is fragile —
typos divorce SLA rows from real complaints, and there is no single source of truth that
the citizen submission form, the dashboard's "Distribution by category" indicator
(BRD Appendix C), and the IGE/IGSAE auto-routing (BRD §5.2 "Routing Logic") can all
share.

Phase G1 introduces `CRS.CategoryTaxonomy` — a 3-level tree editor
(**Category → Subcategory L1 → Subcategory L2**) — and switches the SLA Matrix
combobox from free text to a strict picker sourced from the taxonomy. BRD Appendix A
enumerates ~17 IGSAE categories and ~13 IGE categories with multi-level sub-categories;
that table becomes the first-seed XLSX bulk import.

## Scope

**In:**

- CRUD UI under `/manage/crs/categories` (list + filter, create, edit, soft-delete).
- New MDMS schema `CRS.CategoryTaxonomy` (full property shape — see below; this PR ships
  only the stub envelope).
- Per-row tag for path (`IGE` | `IGSAE` | `BOTH`).
- Soft-delete with a `deprecatedReason` field. Deleting an in-use category surfaces a
  warning that lists the SLA Matrix rows still referencing it.
- Bulk XLSX importer that accepts the BRD Appendix A shape (Category, Subcategory L1,
  Subcategory L2, Path) and writes through MDMS v2 `_create`.
- Display-order hint (`displayOrder`) for citizen-facing dropdowns.
- A read-only "picker" component the SLA Matrix can mount in place of its current
  free-text combobox (the SLA Matrix code change itself ships in a follow-up PR; this
  phase only exports the component).

**Not in (deferred):**

- Localised category names → cross-cutting i18n phase; this phase stores `displayName`
  in English only.
- Category-specific sub-fields on the citizen submission form → Phase G8 (Submission
  Form Customization).
- Routing rules per category (which category goes to IGE vs IGSAE workflow) → Phase G2
  (Path Routing).
- ConfigAuditLog integration → Phase G4 introduces the audit log; G1 ships without it
  and gets retrofitted (matches the G1-G3 / G4 split in the roadmap).
- "Other" free-text handling → recorded as an open question per category via
  `allowsOther: bool`; the actual citizen-portal behaviour ships with the submission
  form work in G8.

## MDMS schemas

This PR commits **`CRS.G1.json`** as an inert stub (`isActive: false`, empty `x-unique`,
no `properties`) at
`utilities/default-data-handler/src/main/resources/schema/CRS.G1.json`. The stub reserves
the schema code so the configurator UI and the importer can target a stable identifier
without waiting on schema review.

The full schema, to be filled in during implementation:

```json
{
  "tenantId": "{tenantid}",
  "code": "CRS.CategoryTaxonomy",
  "isActive": true,
  "definition": {
    "type": "object",
    "$schema": "http://json-schema.org/draft-07/schema#",
    "required": ["code", "path", "category", "subcategoryL1", "active"],
    "x-unique": ["path", "category", "subcategoryL1", "subcategoryL2"],
    "x-ref-schema": [],
    "additionalProperties": false,
    "properties": {
      "code":             { "type": "string", "minLength": 1 },
      "path":             { "type": "string", "enum": ["IGE", "IGSAE", "BOTH"] },
      "category":         { "type": "string", "minLength": 1 },
      "subcategoryL1":    { "type": "string", "minLength": 1 },
      "subcategoryL2":    { "type": "string" },
      "displayOrder":     { "type": "number", "minimum": 0 },
      "allowsOther":      { "type": "boolean" },
      "active":           { "type": "boolean" },
      "deprecatedReason": { "type": "string" },
      "createdAt":        { "type": "number" }
    }
  }
}
```

Conventions match the existing `CRS.*` family (object type; explicit `x-unique`; empty
`x-ref-schema`; `additionalProperties: false`).

## Configurator routes + UI sketch

- `/manage/crs/categories` — list + filter by `path` + search by name.
- `/manage/crs/categories/new` — create form.
- `/manage/crs/categories/:code/edit` — edit + soft-delete.
- `/manage/crs/categories/import` — XLSX bulk importer.

Sidebar nav: a new **"CRS"** group (or extend the existing one already used by the SLA
Matrix). Entry label: **"Category Taxonomy"**. Ordered above SLA Matrix because the
matrix will depend on it.

ASCII wireframe of the list page:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ CRS > Category Taxonomy                              [ Import XLSX ] [+ Add ]│
├──────────────────────────────────────────────────────────────────────────────┤
│ Path: [All ▾]   Search: [ road                          ]   Show inactive ☐ │
├──────────────────────────────────────────────────────────────────────────────┤
│ Path   │ Category       │ Subcategory L1   │ Subcategory L2  │ Order │ Status│
│ IGSAE  │ Roads          │ Potholes         │ —               │  10   │ ●     │
│ IGSAE  │ Roads          │ Potholes         │ Trunk road      │  11   │ ●     │
│ IGSAE  │ Roads          │ Streetlights     │ —               │  20   │ ●     │
│ IGE    │ Public Safety  │ Noise complaint  │ Construction    │  30   │ ●     │
│ BOTH   │ Other          │ —                │ —               │  99   │ ○ (in)│
├──────────────────────────────────────────────────────────────────────────────┤
│ Showing 5 of 47.   [ < prev ]   page 1 of 4   [ next > ]                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Edit page anatomy: header crumb, form (path / category / L1 / L2 / order / allowsOther /
active), in-use panel (list of `CRS.CategorySLA` rows referencing the same
`(path, category, subcategoryL1)` tuple — purely informational; soft-delete is still
allowed but operator must confirm).

## API endpoints touched

- **MDMS v2 reads/writes** — same shape as PR #770 uses for `CRS.CategorySLA`:
  - `POST /mdms-v2/v2/_create/CRS.CategoryTaxonomy`
  - `POST /mdms-v2/v2/_search` (filter by `path`, `active`)
  - `POST /mdms-v2/v2/_update/CRS.CategoryTaxonomy`
- **No new backend service.** The bulk importer is a configurator-side feature that loops
  over `_create` calls (MDMS v2 has no native bulk endpoint; the importer batches client-
  side and reports per-row outcomes).
- **`CRS.SLAAuditLog` writes** (already shipped by PR #770) — out of scope for G1, since
  the roadmap leaves audit-log integration to G4.

## Dependencies on prior phases

**Must ship first:**

- PR #770 (escalation foundation) — defines the `CRS.CategorySLA` consumer that this
  taxonomy feeds. Stacked here.
- PR #A (`refactor/scheduler-state-name-mdms`, stacked on #770) — orthogonal but in the
  same stack.
- PR #B (`docs/categorysla-wiring-strategies`) — orthogonal design doc; in the same
  stack.

**This phase blocks:**

- **G2 (Path Routing)** — the routing rule editor maps `(category, subcategoryL1?) →
  path`, so it needs the picker source.
- **G8 (Submission Form Customization)** — per-category sub-fields key off the taxonomy
  code.
- **SLA Matrix combobox migration** — switching the combobox from free text to a strict
  picker is a follow-up to G1, not part of G1 itself (so PR #770's free-text combobox
  keeps working during the rollout).

## Acceptance criteria

An operator with the `CRS_CONFIG_ADMIN` role should be able to:

- [ ] Open `/manage/crs/categories` on a fresh tenant and see an empty-state with a
      "Bulk import" CTA.
- [ ] Bulk-import the BRD Appendix A IGE table (~13 categories with sub-categories) via
      XLSX and see every row land in the list view.
- [ ] Bulk-import the BRD Appendix A IGSAE table (~17 categories) the same way.
- [ ] Create a new row inline (path / category / L1 / L2) and have it persist across a
      page reload.
- [ ] Attempt to create a duplicate `(path, category, subcategoryL1, subcategoryL2)` and
      receive a clear validation error (MDMS unique-key rejection surfaced
      operator-friendly).
- [ ] Soft-delete a row that is referenced by a `CRS.CategorySLA` row and see a warning
      that lists the referencing SLA rows by `(category, subcategoryL1)`.
- [ ] Mount the picker component in a sandbox page and confirm it filters by `path` and
      hides `active: false` rows by default.

## Estimated effort

**M (~2-3 days)** — straight MDMS CRUD on top of the patterns already established by the
SLA Matrix in PR #770. The nontrivial pieces are the XLSX importer (parsing + per-row
error reporting) and the in-use-warning panel on soft-delete. The picker export is
trivial.

## Open questions

1. **Should `code` be operator-supplied or auto-generated** from
   `slugify(path-category-subcategoryL1-subcategoryL2)`? Auto-generated keeps imports
   deterministic; operator-supplied lets two tenants share a category code for cross-
   tenant reporting.
2. **How does soft-delete interact with existing complaints** that already reference the
   `(category, subcategoryL1)` tuple? Proposal: it doesn't — the complaint keeps its
   denormalised category strings; only NEW SLA Matrix rows and NEW complaints lose the
   option from the picker.
3. **Does the importer support upsert by `code`, or is it create-only**? Roadmap is
   silent. Proposal: create-only for v1 (importer rejects rows whose `code` collides);
   upsert ships in G1.1 if operators ask for it.
4. **Should "Other" be a flag (`allowsOther: bool`) on each L1, or a magic row** the
   importer auto-inserts per category? The roadmap mentions both. Proposal: flag on L1;
   the citizen-portal renders the "Other" free-text option only when the picked L1 has
   `allowsOther: true`.
5. **Is the picker component shipped from `digit-configurator` or from `digit-ui-esbuild`**?
   The SLA Matrix lives in the configurator today; the citizen portal lives in the
   esbuild bundle. Proposal: ship two thin wrappers (one per bundle) over a shared MDMS
   `_search` call, since the bundles can't import from each other.

## Cross-references

- **GitHub Discussion:** _(filled in once the Discussion is opened — see PR comment trail)_
- **Roadmap doc:** [`docs/crs-configurator-roadmap.md`](../crs-configurator-roadmap.md) — Phase G1 section.
- **Escalation design doc:** [`docs/escalation-feature-design.md`](../escalation-feature-design.md)
- **CategorySLA wiring strategies:** [`docs/categorysla-wiring-strategies.md`](../categorysla-wiring-strategies.md) (PR #B)
- **PR #770** — escalation foundation (ships `CRS.CategorySLA`, `CRS.StateSLA`,
  `CRS.SLAAuditLog`, the SLA Matrix page, and the scheduler patch this taxonomy will
  eventually constrain).

# G8: Submission Form Customization

## Why

The citizen intake form is the entry point for every complaint flowing through CRS.
Today the field set is hardcoded in the citizen portal SPA: a new field, a renamed
label, or a tweaked validation rule needs a UI release, a CI build, and a
re-deployment. BRD Appendix B specifies the form in three sections — General
Information (I), IGSAE complaints (II), and IGE complaints (III) — with per-field
Type / Mandatory / Validation / Applicable-path metadata; the BRD wants this metadata
operator-editable.

The Configurator roadmap (see `docs/crs-configurator-roadmap.md` §G8) sized this as
**XL** and called it the highest-impact phase from a citizen-experience perspective.
It also closes the loop on the [CategorySLA wiring strategies
doc](../categorysla-wiring-strategies.md) — specifically **Strategy A (Rich intake)**,
which requires the intake form to surface `path`, `category`, and `subcategoryL1` as
operator-configurable fields. Without G8, Strategy A is infeasible for tenants whose
current intake form lacks those three fields.

## Scope

**In:**

- CRUD per form section per field (GENERAL / IGSAE / IGE).
- Field type picker covering the BRD-Appendix-B set: Text, Long Text, List,
  Dependent List, Number, Email, Yes/No, Checkbox, Date, Upload, GPS.
- Validation rules: `maxChars`, `minChars`, `regex`, `mimeTypes`, `maxSizeMb`,
  `dependsOn`, `listSource`.
- Mandatory toggle per field.
- Per-path applicability (`IGE` / `IGSAE` / `BOTH`).
- Reorder via drag-and-drop within a section (writes back to `displayOrder`).
- Live preview pane that renders the form as a citizen would see it (read-only;
  no actual submit).
- Per-locale labels: `label_ptMZ` and `label_en` are both required for every field.

**Out (deferred):**

- Conditional logic beyond Dependent List (e.g. "show this field iff
  `category == 'WaterSupply'`"). Tracked as a follow-up phase.
- Per-tenant *new* field types beyond the BRD-Appendix-B set. New types require a
  schema + portal change, not a configurator change.
- The citizen-portal SPA consumer change (reading `SubmissionFormField` from MDMS
  instead of its hardcoded config). That's a separate PR against the portal repo,
  scoped at ~half-day on top of the configurator UI.
- Migration tooling to backfill existing tenants from their current hardcoded
  config — first-pass operators will seed via the XLSX importer.

## MDMS schemas

Schema code reserved by this PR: **`CRS.SubmissionFormField`** (module `crs`, master
`SubmissionFormField`). Style matches the existing `CRS.CategorySLA` /
`CRS.StateSLA` / `CRS.SLAAuditLog` shape from #770: object `type`, populated
`x-unique`, empty `x-ref-schema`, `additionalProperties: false`.

Sketch of the final shape (will be filled into `CRS.G8.json` by the implementation
PR; this PR commits an empty-shape stub so the code is reserved):

```
CRS.SubmissionFormField:
  x-unique: [code, section]
  required: [code, section, label_ptMZ, label_en, type, mandatory,
             applicablePaths, displayOrder, active]
  properties:
    code:             string  (minLength 1; treated as MDMS uniqueIdentifier
                              suffix per section)
    section:          enum    [GENERAL, IGSAE, IGE]
    label_ptMZ:       string  (Portuguese — primary)
    label_en:         string  (English — secondary)
    type:             enum    [TEXT, LONG_TEXT, LIST, DEPENDENT_LIST, NUMBER,
                              EMAIL, YES_NO, CHECKBOX, DATE, UPLOAD, GPS]
    mandatory:        boolean
    validation:       object  (sparse; only keys relevant to `type` populated)
      maxChars?:      number
      minChars?:      number
      regex?:         string
      mimeTypes?:     [string]   (only for type=UPLOAD)
      maxSizeMb?:     number     (only for type=UPLOAD)
      dependsOn?:     string     (only for type=DEPENDENT_LIST; references
                                 another field's `code`)
      listSource?:    string     (only for type=LIST or DEPENDENT_LIST; schema
                                 code, e.g. `CRS.CategoryTaxonomy`)
    applicablePaths:  [enum IGE | IGSAE]  (use both for BRD "BOTH")
    displayOrder:     integer  (per-section ordering; gaps tolerated)
    active:           boolean
```

`uniqueIdentifier` convention: `<section>:<code>` so the same `code` can be reused
across sections without collision.

Once `CRS.ConfigAuditLog` lands in G4, every save against `CRS.SubmissionFormField`
writes a `ConfigAuditLog` row via the shared helper at
`configurator/src/admin/audit/`. Until G4 ships, G8 saves go through MDMS auditDetails
only (consistent with G1-G3).

## Configurator routes + UI sketch

New routes added under the existing `/manage/crs/...` namespace established by the
SLA Matrix work in #770:

- `/manage/crs-submission-form` — list view, grouped by section, drag-to-reorder.
- `/manage/crs-submission-form/:code/edit` — field editor with live preview.

Sidebar nav entry: **"Submission Form"** under the **Citizen Experience** group
(new group introduced by G8; will house G7-Dashboard-config when that lands).

Page anatomy:

- **Header**: section tabs (GENERAL / IGSAE / IGE) + "+ Add Field" CTA.
- **Toolbar**: search-by-label, filter-by-active, filter-by-mandatory.
- **Body**: two-column layout — left column is the field list (drag handles
  visible on hover); right column is the live preview, scoped to the currently-
  selected section's `applicablePaths`.

ASCII wireframe of the editing surface:

```
+--------------------------------------------------------------------+
| Submission Form Customization                       [+ Add Field]  |
| [ GENERAL ] [ IGSAE ] [ IGE ]                                      |
+--------------------------------------------------------------------+
| Search: [____________]  Filters: [Active v] [Mandatory v]          |
+----------------------------+---------------------------------------+
| FIELD LIST (drag-to-order) | LIVE PREVIEW (citizen view, section)  |
| -------------------------- | ------------------------------------- |
| (=) Name *           [E]   |   Name *                              |
| (=) Contact *        [E]   |   [_______________________________]   |
| (=) Province (List)  [E]   |                                       |
| (=) District (Dep)   [E]   |   Contact *                           |
| (=) Date of Incident [E]   |   [_______________________________]   |
| (=) Photo (Upload)   [E]   |                                       |
|                            |   Province *  [Select... v]           |
|                            |   District *  [- select Province -]   |
|                            |   ...                                 |
+----------------------------+---------------------------------------+
```

Edit page right pane re-renders the same preview but for one field at a time, so
the operator sees their validation/regex changes apply live.

## API endpoints touched

- **MDMS v2** (default path): `_create`, `_update`, `_search` against the
  reserved `CRS.SubmissionFormField` code. No new backend endpoints are required
  for the configurator side.
- **Citizen portal SPA**: gains a startup-time fetch of
  `CRS.SubmissionFormField` (filtered by tenant, by `active: true`, sorted by
  `displayOrder`). Replaces the hardcoded field config. Out of scope for this
  PR — separate PR against the portal repo.
- **Configurator chrome localisation**: handled by the existing `fix-missing-keys`
  skill on missing UI strings. In-content labels live in `label_ptMZ` /
  `label_en` on the MDMS records and bypass the localisation service.

## Dependencies on prior phases

**Must ship before G8:**

- **PR #770** (escalation foundation) — establishes the `CRS.*` schema-code
  convention this phase extends.
- **PR #A** (state-name MDMS) — establishes the precedent for MDMS-ifying
  previously-hardcoded enums.
- **PR #B** ([CategorySLA wiring strategies](../categorysla-wiring-strategies.md))
  — documents *why* Strategy A needs G8.
- **G1 (Category Taxonomy)** — the Category and SubcategoryL1/L2 dropdown
  fields (BRD Appendix B II / III) need the taxonomy as their `listSource`.
- **G6 (Territorial Hierarchy)** — the Province / District / Admin Post fields
  (BRD Appendix B I) need the boundary tree as `listSource`.

**G8 blocks:**

- Full enablement of **Strategy A** in the CategorySLA model (operators cannot
  add `path` / `category` / `subcategoryL1` intake fields without G8).
- Any tenant that wants to ship a country-specific intake question (e.g. add a
  "household head ID" field for a non-Mozambique deployment) without a portal
  release.

## Acceptance criteria

- The default seed (when shipped) exactly reproduces BRD Appendix B Sections I /
  II / III, field-for-field.
- Toggling `Witnesses (Name / Contact)` from optional to mandatory immediately
  changes the citizen-portal validation (no portal restart).
- Dependent List for District correctly cascades from Province (changing Province
  resets District; District options come from the boundary tree).
- The live preview matches what the citizen portal renders, pixel-equivalently
  (same component library, same typography).
- Adding a new field with `applicablePaths: ["IGSAE"]` does not appear on the IGE
  form, and vice versa.
- An operator can save a new field, refresh the configurator, and see it persisted
  with no manual MDMS poke.
- (Once G4 ships) every save against `CRS.SubmissionFormField` writes a
  `CRS.ConfigAuditLog` row capturing before / after JSON + actor.

## Estimated effort

**XL (multi-week)** — large schema surface, eleven widget kinds, dependent-list
semantics, mandatory locale duplication, live preview parity with the portal, plus
the corresponding citizen-portal consumer changes. Configurator side alone is
~1 week; the portal-consumer side adds another week. Localisation seed for the BRD
defaults is another half-day.

## Open questions

- **Per-tenant override of root defaults**: do we ship root-only seeds (operators
  override per city), or per-city seeds out of the gate? G3 + G8 are the most
  likely to want city-level overrides (per the roadmap §Cross-cutting concerns).
- **Field reorder atomicity**: drag-and-drop reorder can touch many records'
  `displayOrder` in one go. Single MDMS bulk-update, or N serial updates with
  spinner? MDMS v2 has no native bulk-update endpoint today.
- **Preview parity**: does the configurator import the citizen-portal field-render
  components directly (creates a build-time coupling), or duplicate them and risk
  drift? A monorepo extraction is the third option but out of scope for G8.
- **Live preview without a tenant context**: when the operator is editing at root
  tenant level, the preview has no boundary tree to populate Province / District
  list sources from. Show a "preview limited at root" warning, or pick a sample
  city tenant?
- **Backwards compatibility window**: how long do we keep the portal's hardcoded
  field config as a fallback (in case the MDMS fetch fails on boot), and where
  does that fallback get sunset?

## Cross-references

- **Discussion**: (filled in once the Discussion is opened — see PR description)
- **Roadmap doc**: [`docs/crs-configurator-roadmap.md`](../crs-configurator-roadmap.md) §G8
- **Escalation design doc**: [`docs/escalation-feature-design.md`](../escalation-feature-design.md)
- **CategorySLA wiring strategies**: [`docs/categorysla-wiring-strategies.md`](../categorysla-wiring-strategies.md)
- **PR #770** — escalation foundation (CRS.* schema-code convention)
- **PR #A** — state-name MDMS (precedent for de-hardcoding enums)
- **PR #B** — wiring-strategies doc (motivates Strategy A → G8)

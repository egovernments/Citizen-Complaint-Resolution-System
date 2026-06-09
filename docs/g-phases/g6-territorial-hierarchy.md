# G6: Territorial Hierarchy editor

> Status: **DESIGN ONLY**. This sub-doc reserves the shape; nothing here is implemented yet.
> Parent roadmap: [`docs/crs-configurator-roadmap.md`](../crs-configurator-roadmap.md) (Phase G6 section).
> Stacked on the escalation foundation in PR #770 and the wiring-strategies note in PR #B
> ([`docs/categorysla-wiring-strategies.md`](../categorysla-wiring-strategies.md)).

## Why

The CRS Configurator needs a first-class 4-level boundary editor —
**Region → District → Sub-district → Locality** — so a tenant can model
the geographic hierarchy that drives:

- **Geographic complaint routing** (`/manage/crs-routing` from G2 reads `boundaryCode` to pick a path/owner).
- **Geographic reporting** (Phase G7 dashboards' "distribution by region/district" indicators).
- **Citizen submission form cascading dropdowns** (Phase G8 — Region → District → Sub-district → Locality).
- **Entity Directory** (Phase G3 — every Ministry / Council / Municipality node anchors to a `boundaryCode`).

The BRD §6.1 ("Territorial Hierarchy") describes a four-level structure for the
Mozambique reference dataset (Province / District / Administrative Post / Location);
the editor is **generic** — any tenant supplies its own labels and totals. Mozambique's
particular numbers (11 / 154 / 490 / 1052) are not seeded.

Today, the DIGIT `egov-location` / `boundary-service` already stores boundary trees
and the configurator already has a `/manage/boundaries` page. This phase **extends**
that surface — it does not introduce a parallel boundary store.

## Scope

**In scope:**

- A tree editor that enforces a fixed **depth of exactly 4** when the tenant opts in to the CRS overlay (existing `/manage/boundaries` is depth-agnostic).
- Drag-to-reparent **within the 4-level constraint** (a District cannot be reparented under a Locality).
- Bulk XLSX import (template: 4 columns + optional lat/long bounding box per node).
- Optional lat/long bounding box per node (for the map dashboard in G7).
- Soft-deactivation: a node marked inactive blocks **new** complaints on that boundary but preserves history.
- Per-locale display-label overlay (`CRS.BoundaryLabelOverride`) so the same boundary tree can render in `pt`, `en`, `sw`, etc. without forking the canonical boundary record.
- An XLSX export of the current tree (round-trips with the import template).

**Out of scope (explicitly deferred):**

- A fifth (or deeper) hierarchy level — the 4-level constraint is a hard product decision.
- Postal codes / ZIP codes — the BRD uses "ZIP" as an acronym for an institution, not a postcode.
- Geo-routing **rules** (those live in G2, which consumes the boundary tree as a lookup source).
- Map visualisation (lives in G7 once the lat/long bounding boxes are populated here).
- Re-implementing the boundary tree itself — we extend `egov-location`, we do not fork it.

## MDMS schemas

This phase introduces **one** CRS-side schema. The 4-level tree itself stays in the
DIGIT boundary service (no new schema there); CRS only owns the locale-overlay sheet.

### `CRS.BoundaryLabelOverride` (reserved by `CRS.G6.json` stub)

| Field | Type | Required | Notes |
|---|---|---|---|
| `boundaryCode` | `string` | yes | Foreign key into the `egov-location` boundary tree. Unique (`x-unique`). |
| `displayLabel` | `map<localeCode, string>` | yes | One entry per supported locale (`en`, `pt`, `sw`, …). At least the tenant's default locale must be present. |
| `abbreviation` | `map<localeCode, string>` | no | Short form used in dashboards / breadcrumbs (e.g. `Maputo Prov.`). |
| `active` | `boolean` | yes | Defaults to `true`. When `false`, citizen-facing dropdowns hide the node but historical complaints retain the label. |
| `deprecatedReason` | `string` | no | Filled when `active=false`; surfaced on hover in the editor. |
| `auditedAt` | `string` (ISO) | no | Written by the editor on every save (audit trail). |

Envelope conventions match the existing CRS.* style:
`additionalProperties=false`, `x-unique=["boundaryCode"]`, `x-ref-schema=[]`,
`$schema=http://json-schema.org/draft-07/schema#`, `type=object`.

**Reserved by the committed stub.** `utilities/default-data-handler/src/main/resources/schema/CRS.G6.json`
ships in this PR with `isActive=false` and the minimal envelope (only `boundaryCode` in
`properties`). Implementation flips `isActive=true` and fills the rest.

## Configurator routes + UI sketch

Two new entries under `/manage/`:

- `/manage/crs-territory` — the 4-level tree editor (the primary surface).
- `/manage/crs-territory/labels` — locale-overlay editor for `CRS.BoundaryLabelOverride`.
- `/manage/crs-territory/import` — XLSX import / export dialog (modal launched from the tree editor toolbar; route exists for deep-linking).

Sidebar nav goes under the **"Geography"** group (new — created in this phase; G7
will add the Dashboard editor to the same group).

### Page anatomy — `/manage/crs-territory`

- **Header**: page title, last-saved timestamp, locale toggle (preview labels in any configured locale).
- **Toolbar**: `+ Add Region`, `Import XLSX`, `Export XLSX`, `Expand all` / `Collapse all`, search box (filters by label OR `boundaryCode`).
- **Body**: a virtualised tree on the left (Region → District → Sub-district → Locality), node-detail pane on the right.

### ASCII wireframe

```
+-----------------------------------------------------------------------------+
| Territorial Hierarchy                                  Locale: [en v]  Save |
+-----------------------------------------------------------------------------+
| [+ Region] [Import XLSX] [Export XLSX] [Expand all] [Collapse all]  [search]|
+----------------------------------+------------------------------------------+
| v Region: Coast                 ^| Selected node                            |
|   v District: Mombasa           ||  Code:        ke.coast.mombasa           |
|     v Sub-district: Nyali       ||  Label (en):  [Mombasa              ]    |
|       - Locality: Bamburi       ||  Label (pt):  [Mombaca             ]    |
|       - Locality: Kisauni       ||  Abbreviation:[Mom.                ]    |
|     > Sub-district: Likoni      ||  Bounding box (optional):                |
|   > District: Kilifi            ||    NE lat/lng: [-3.95 ] [40.10  ]        |
| > Region: Nairobi               ||    SW lat/lng: [-4.10 ] [39.55  ]        |
| > Region: Rift Valley           ||  Active:      [x]                        |
|                                  ||  Children:    3 sub-districts            |
|                                  ||                                          |
|                                 v|  [Delete]                  [Save changes] |
+----------------------------------+------------------------------------------+
| Depth constraint:  Region (1) > District (2) > Sub-district (3) > Locality (4)|
+-----------------------------------------------------------------------------+
```

Drag a node to reparent. Drop-target highlighting is **red** if the move
would violate the 4-level constraint (e.g. dragging a District onto a
Locality); a tooltip explains.

### XLSX template

| Column | Required | Notes |
|---|---|---|
| `region` | yes | Free text. Creates if new. |
| `district` | yes | Free text. Parent = `region` of the same row. |
| `sub_district` | yes | Free text. Parent = `district`. |
| `locality` | yes | Free text. Parent = `sub_district`. Leaf. |
| `boundary_code` | no | If blank, the importer derives `<tenant>.<region>.<district>.<sub_district>.<locality>` (slugified). If supplied, used verbatim — useful for matching against an existing `egov-location` tree. |
| `bbox_ne_lat`, `bbox_ne_lng`, `bbox_sw_lat`, `bbox_sw_lng` | no | Optional bounding box on the **leaf** (locality) row. |
| `label_<locale>` | no | Repeat per locale (`label_en`, `label_pt`, …). At least one matching tenant default required if any label is supplied. |

Import is **idempotent**: re-running with edits updates the existing rows; rows missing from a re-import are **not** deleted (operator must soft-deactivate explicitly).

## API endpoints touched

- **DIGIT `egov-location` / `boundary-service`** — `boundary/_create`, `boundary/_update`, `boundary/_search`. **No backend change** in this phase; we consume the existing endpoints. The 4-level validation lives in the configurator (front-end + a small adapter that wraps the boundary call).
- **`mdms-v2/v2/_create` + `mdms-v2/v2/_search`** — for `CRS.BoundaryLabelOverride` rows (default MDMS pattern; same as G1/G2).
- **Optional new endpoint** (front-end only — no backend code): `POST /pgr-services/territory/_import` is **NOT** introduced; the XLSX importer runs in the browser and fans out N `_create` / `_update` calls. Behaviour matches G1's bulk-import.

## Dependencies on prior phases

**Must ship first:**

- **PR #770** (escalation foundation) — establishes the configurator nav structure under `/manage/crs-*` and the MDMS-write audit pattern this phase reuses.
- **PR #A** (state-name MDMS, parent-of-parent) — no direct dependency, but shares the schema-registration plumbing in `default-data-handler`.
- **PR #B** (wiring-strategies doc, immediate parent) — no direct dependency.

No hard dependency on G1 / G2 / G3 / G4 / G5; **G6 can ship in parallel with G1** as
called out in the roadmap's "Recommended Sequencing" section.

**This phase blocks:**

- **G3 (Entity Directory)** — entities anchor to a `boundaryCode`; without the editor, operators are stuck typing free-text boundary codes.
- **G7 (Dashboards)** — geographic indicators (distribution-by-region map, ranking-by-district table) need the tree to render.
- **G8 (Submission forms)** — citizen form cascading dropdowns read this tree.

## Acceptance criteria

1. Operator can create a 4-level tree through the editor (Region → District → Sub-district → Locality) and persist it via `boundary/_create`.
2. Attempting to reparent a District to a Locality is **rejected client-side with an explanation**, and `boundary/_update` is never called.
3. XLSX import of a sample 50-row file produces the expected tree shape; re-running the same import is idempotent (no duplicate nodes, no orphaned rows).
4. XLSX export of the current tree round-trips: `export → re-import → export` produces a byte-identical file.
5. Editing a label in the locale overlay updates `CRS.BoundaryLabelOverride` and the citizen-facing dropdowns reflect the change after a browser refresh (no service restart required).
6. Soft-deactivating a leaf node hides it from the citizen submission form but the same boundary still resolves on historical complaints' search results.
7. The "Geography" sidebar group renders on a fresh `/manage` load, with two entries (`Territorial hierarchy`, `Boundary labels`).

## Estimated effort

**L (~1 week)** — the editor surface is small but the depth-constraint validator,
the idempotent XLSX importer (with leaf-only bbox handling), and the
locale-overlay sheet each carry real edge cases. The bbox capture is
"populate the column; G7 actually renders the map" — small here, but
adds to the row count of acceptance tests.

## Open questions

1. **Boundary-code naming convention.** Do we standardise on
   `<tenant>.<region>.<district>.<sub_district>.<locality>` (the
   importer's default), or do we let each tenant pick a convention and
   only require uniqueness? Affects whether G2's routing rules can use
   prefix matching.
2. **What happens to an in-flight complaint if its leaf is soft-deactivated?**
   Block the next workflow action? Allow but flag? Silent pass-through?
   The roadmap says "preserves history" but doesn't specify the in-flight case.
3. **Reparenting an existing node with descendants.** Move the whole
   subtree atomically? Reject and force the operator to move children
   first? `egov-location` doesn't natively support atomic subtree
   moves — we may need a multi-call orchestrator with rollback.
4. **Locale fallback policy when `CRS.BoundaryLabelOverride` is missing
   for the user's locale.** Fall back to the tenant-default locale's
   label? To the canonical `boundary` service `name`? To the
   `boundaryCode`? Each has UX trade-offs.
5. **Do we expose lat/long as a single point or a bounding box?** The
   roadmap mentions "bounding box per node"; the map dashboard in G7
   may only need a single representative point per region (centroid).
   Capturing both adds 4 extra columns to the XLSX template — worth it?

## Cross-references

- **Discussion**: <!-- DISCUSSION_URL --> (filled in after the GitHub Discussion is created)
- **Roadmap doc**: [`docs/crs-configurator-roadmap.md`](../crs-configurator-roadmap.md) — Phase G6 entry
- **Escalation design doc**: [`docs/escalation-feature-design.md`](../escalation-feature-design.md)
- **Wiring-strategies note (PR #B)**: [`docs/categorysla-wiring-strategies.md`](../categorysla-wiring-strategies.md)
- **PR #770** — escalation foundation (parent-of-parent-of-parent)
- **MDMS schema stub**: [`utilities/default-data-handler/src/main/resources/schema/CRS.G6.json`](../../utilities/default-data-handler/src/main/resources/schema/CRS.G6.json)

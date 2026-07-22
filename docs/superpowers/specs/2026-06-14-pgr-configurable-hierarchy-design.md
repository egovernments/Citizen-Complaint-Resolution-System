---
title: "[DRAFT | PROPOSAL] Configurable PGR Complaint-Type Hierarchy"
status: DRAFT — open for discussion
date: 2026-06-14
audience: PGR engineering, MDMS v2 working group, configurator team, platform reviewers
discussion: please leave comments inline; explicit open questions at the bottom invite responses
---

# [DRAFT | PROPOSAL] Configurable PGR Complaint-Type Hierarchy

> **Status:** Draft proposal. Posted to invite discussion, pushback, and alternative framings before an implementation plan is written. Nothing here is settled. Sections marked **Open question** below are explicitly soliciting input.

## TL;DR

This proposal recommends evolving PGR's complaint taxonomy from its current effectively-flat `ServiceDefs` master into a tenant-configurable jagged tree of up to four levels. The change is delivered as **additive fields on the existing `ServiceDefs` master** plus one new small companion master (`HierarchyConfig`). No URL-path version bump is required; no DB migration is required; no breaking change to complaint create / search / update is required. Existing tenants continue to operate unchanged until they opt into the new model. The first beneficiary is the Mozambique (Maputo) onboarding, which requires three hierarchy levels at go-live.

## 1. Background and current state

The PGR complaint taxonomy is conceptually treated as a two-level "type → subtype" hierarchy, but the implementation today is in fact a **flat list** with frontend-side grouping:

- `eg_pgr_service_v2` (the PGR database table) stores complaints with `serviceCode` as a flat string. No `complaintType` / `subType` columns exist.
- The MDMS master `RAINMAKER-PGR.ServiceDefs` is a flat row list. The "type" tier is derived in the UI by grouping rows whose `menuPath` strings match (see `digit-ui-esbuild/products/pgr/src/pages/citizen/Create/FormExplorer.js`).
- No `parentCode` field is currently modeled.

Consequently, the hierarchy is rigid only by convention — the data layer is already flat and version-agnostic. This significantly reduces the scope of any redesign.

## 2. Driver

Mozambique (Maputo) requires three hierarchy levels at onboarding (Category → Subcategory → Service). Other prospective tenants may require up to four. A two-level cap is no longer adequate. The design must accommodate present and near-future tenant requirements without forcing existing tenants (e.g., Nairobi) to re-onboard or migrate ahead of demand.

## 3. Proposed approach (high level)

This proposal recommends three coordinated changes:

1. **Extend the existing `RAINMAKER-PGR.ServiceDefs` MDMS v2 master in place** with two optional fields, `parentCode` and `level`. The schema name, file path, and identity of `ServiceDefs` are preserved. Existing rows that omit these fields validate as level-one roots (default behavior).
2. **Introduce one new MDMS v2 master, `RAINMAKER-PGR.HierarchyConfig`**, holding per-tenant depth and level-name metadata. A tenant without a `HierarchyConfig` document continues to behave as a flat-list tenant.
3. **Add two new PGR-services endpoints under the existing `/v2/` path** — `serviceDefs/_tree` (assembles the nested taxonomy from MDMS data) and `serviceDefs/_validate` (enforces leveling and leaf-attribute invariants). All other PGR APIs gain optional fields only.

The proposal explicitly **rejects** the following alternatives that were considered during brainstorming:

- A new master named `ComplaintNode` replacing `ServiceDefs`. Rejected on backward-compatibility grounds.
- A separate `HierarchyLevel` master in addition to `ComplaintNode`. Folded into `HierarchyConfig` to reduce master count.
- A polymorphic JSON `additionalDetails` blob for leaf metadata. Rejected on queryability grounds.
- A new `/v3/` URL prefix. Rejected as unnecessary under the additive design — see Section 7.

## 4. Key design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Tree shape | Jagged. Any row with no children is a leaf. | Real-world taxonomies are uneven; forcing uniform depth across all branches is artificial. |
| Depth ceiling | 4. Enforced in JSON Schema. | Mozambique needs 3; one-step headroom. Going further would harm UX (cascading dropdowns) without known demand. |
| Leaf metadata location | Nullable columns on every `ServiceDefs` row (existing `slaHours`, `department`, `keywords`). | Preserves DB and migration surface. Validator enforces presence on leaves only. |
| Level naming | Per-tenant, declared in `HierarchyConfig` via `nameKey` (localization keys). | Maputo declares Portuguese level names; Nairobi declares English. No localized strings in masters themselves. |
| UI version dispatch | Data-driven. Presence of `HierarchyConfig` for the tenant switches the picker. | No tenant config flag; no `pgrApiVersion` field. The UI reflects what the data says. |
| Validator location | New PGR-services endpoint `POST /v2/serviceDefs/_validate`, called by the configurator and the dataloader before any MDMS write. | Single source of truth for the new invariants. Trade-off acknowledged: ad-hoc direct MDMS writes bypass validation; mitigated by tooling (see Section 6). |
| API versioning | No new `/v3/` prefix. All endpoint additions live on `/v2/`. | Every change is additive. A version bump would force every UI client to rewrite paths with no behavior change. |

## 5. API surface (delta)

**MDMS layer.** Schema additions only; no new MDMS endpoints. `ServiceDefs` gains optional `parentCode` and `level`. `HierarchyConfig` is a new master schema.

**PGR-services layer.**

| Change | Type |
|---|---|
| `POST /v2/serviceDefs/_tree` | New endpoint. Returns the tenant's complaint-type tree plus the tenant's `HierarchyConfig` in a single response. Optional `rootCode` parameter scopes to a subtree. |
| `POST /v2/serviceDefs/_validate` | New endpoint. Batch-validates proposed `ServiceDefs` writes against parent linkage, level bounds, and leaf-attribute presence. |
| `POST /v2/services/_search` | Optional `parentServiceCode` filter added. PGR-services expands internally to a leaf-codes list. |
| `POST /v2/services/_create`, `_search`, `_update` | Optional `complaintNodePath` field for analytics use. Existing required-field contract unchanged. |

Net new PGR endpoints: two. All other deltas are additive.

## 6. Backward compatibility

The following surfaces are guaranteed unchanged by this proposal:

- The `eg_pgr_service_v2` database schema.
- The shape and contract of `services/_create`, `_search`, `_update`.
- Workflow definitions, SLA computation, and notification subsystems — all keyed by leaf `serviceCode`, which continues to be the value stored in the complaint record.
- All existing `/v2/` URL paths.
- The `menuPath` field on migrated `ServiceDefs` rows (preserved post-migration; deprecated, not deleted).
- The citizen picker experience for tenants that have not yet migrated. The data-driven UI dispatch ensures their code path is unchanged.

One soft compatibility note: any consumer that today assumes "every `ServiceDefs` row is submittable" must adopt the invariant `isLeaf == (children.length === 0)`. No external consumer of this kind is known at the time of writing; reviewers are invited to flag any.

## 7. Migration approach

**Two paths, both calling the same validator.**

1. **Existing-tenant migration (e.g., Nairobi).** A new utility under `utilities/mdms-v2-migration/migrate_pgr_hierarchy.py` reads the tenant's flat `ServiceDefs`, groups rows by `menuPath`, derives one synthetic level-one parent per unique `menuPath`, rewrites existing rows in place with `parentCode` + `level = 2`, and emits a `HierarchyConfig` with `depth: 2`. The utility supports `--dry-run`, `--apply`, and `--rollback`, takes a timestamped backup before any write, and is idempotent. Tenants opt in individually; there is no flag day.

2. **Fresh-tenant onboarding (e.g., Mozambique).** The bootstrap dataloader writes multi-level `ServiceDefs` and a `HierarchyConfig` directly from operator-supplied XLSX input. This requires an additive update to the `digit-xlsx-onboard` skill templates to accept hierarchical input. Both paths call `_validate` before writing.

A coverage gap is acknowledged: any direct MDMS write that bypasses both the configurator and the dataloader (manual ops fixes, Postman scripts) bypasses `_validate`. Mitigations are (a) all official write paths route through the validator, (b) PGR-services logs invariant violations at startup as a backstop signal, (c) a CLI `_validate` shim allows on-demand checking of a tenant's full ServiceDefs.

## 8. UI strategy

A single hook, `useComplaintTaxonomy()`, becomes the only consumer of the new `_tree` endpoint. All UI components — citizen complaint form, admin configurator, search filters, reports — consume the hook's normalized return shape. Dispatch is data-driven: if the hook receives `depth: 1`, the existing flat picker renders; if `depth: 2..4`, a multi-dropdown picker renders, labeled with level names from `HierarchyConfig`. Components themselves carry no branching logic.

Two UI codebases must be updated: `digit-ui-esbuild/products/pgr` and `digit-ui-v2/src/pages`. The configurator (`configurator/src/resources/complaint-types/`) requires a new tree editor — the largest single piece of new UI in this proposal and the area most exposed to scope creep.

## 9. Out of scope

The following are explicitly excluded from this proposal and should be addressed separately if needed: a `/v3/` URL prefix; a generic cross-master hierarchy framework reusable for Boundaries or Departments; server-side OLAP rollups; cross-tenant taxonomy templates; drag-reparent across levels in the configurator; depth beyond four; renaming `ServiceDefs` to `ComplaintNode`.

## 10. Risks

1. **Dependency on MDMS v2 readiness for PGR.** The design assumes MDMS v2 can host the extended `ServiceDefs` schema with reference validation on `parentCode` and a new `HierarchyConfig` schema. The in-flight `utilities/mdms-v2-migration/` effort needs to land for PGR before this work can complete. Confirmation from the MDMS v2 working group is requested.
2. **Configurator tree editor scope.** Reviewers should hold the v1 scope to: add child node, deactivate subtree, edit name and leaf attributes. Drag-reparent, bulk import, and cross-level moves are deferred.
3. **Validator coverage gap.** Discussed in Section 7. The team should agree that the mitigations are sufficient or escalate to an MDMS v2 plugin hook alternative.
4. **Dual UI codebase work.** Both `digit-ui-esbuild` and `digit-ui-v2` need the picker rewrite; the implementation plan must schedule both.

## 11. Open questions for the team

The following points are explicitly soliciting comment before the proposal converts to an implementation plan:

1. **MDMS v2 working group:** Will `ServiceDefs.parentCode` declared as a schema-reference to `ServiceDefs.serviceCode` (self-reference within tenant scope) be supported by the v2 schema engine in time for the Mozambique go-live window?
2. **Configurator team:** Is the proposed v1 scope of the tree editor (add child, deactivate subtree, edit name/attrs; no drag-reparent) acceptable? If drag-reparent is considered table-stakes, the proposal needs revision.
3. **PGR engineering:** Are there known external or internal consumers of `ServiceDefs/_search` that assume every row is submittable and would silently misbehave if non-leaf rows appear?
4. **Mobile/UI clients:** Is there any client pinned to a contract where unknown JSON fields cause failures (rather than being ignored)? If so, the additive-field strategy needs reconsideration for those clients.
5. **Ops/platform:** Is the validator-coverage trade-off (Section 7) acceptable, or should this proposal escalate to invest in an MDMS v2 plugin hook for hard enforcement?
6. **Naming:** Is `HierarchyConfig` the right name, or should it be `ComplaintTypeHierarchy`, `TaxonomyConfig`, or similar? Reviewers' preference noted.

## 12. Next steps

If discussion converges, the next deliverables are:

1. A confirmed answer to each open question above, recorded inline.
2. A written implementation plan covering MDMS schema edits, PGR-services endpoint implementations, the validator, the migration utility, the configurator tree editor, and the two UI picker rewrites — scheduled against the Mozambique onboarding timeline.
3. A communication note to existing tenants describing the future migration path (no immediate action required).

Reviewers are invited to comment inline on any section. Pushback on the core trade-offs (in-place extension vs. new master, additive-only vs. `/v3/`, validator location) is particularly welcome — these were the most contested points during design exploration and merit a second pair of eyes.

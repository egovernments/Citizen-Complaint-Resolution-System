# CCRS Complaint Classification — Recommendation & Implementation Plan

**Author:** Lead Architect · **Date:** 2026-06-12 (reworked to the 2-master model 2026-06-22) · **Audience:** CCRS engineering + onboarding
**Scope:** Mozambique PGR Solution Design §2 (Complaint Classification Framework) + the user's hard requirement that *the number of hierarchy levels itself be configurable*, boundary-service style.

> **This document has been reworked to the final two-master model** (PR #861 review). The
> classification hierarchy now lives in exactly **two** MDMS masters and the change is a
> **breaking, mandatory, lockstep** rollout — not the additive/opt-in/reversible design an
> earlier draft proposed. The engineering plan that drove this rework is
> [`complaint-hierarchy-2master-rework-plan.md`](complaint-hierarchy-2master-rework-plan.md).

---

## 1. Recommendation

**Adopt Approach C (Config-Driven Dynamic Hierarchy, MDMS-only) as the foundation, consolidated into TWO masters — `RAINMAKER-PGR.ComplaintHierarchyDefinition` (the level shape) and `RAINMAKER-PGR.ComplaintHierarchy` (one adjacency list holding interior nodes AND leaf complaint types) — and keep Approach B (a dedicated `pgr-classification` service) as the documented Phase-4 escape hatch if scale or integrity demands ever exceed what MDMS can give.**

This is a **C-primary / B-as-future-option hybrid**, not a coin flip. Here is the reasoning, grounded in the three adversarial verdicts.

### Why C wins

| Criterion | A (MDMS masters + ServiceDefs edit) | B (dedicated service) | **C (MDMS config-driven)** |
|---|---|---|---|
| Breaks existing flows | false | false | **true (deliberate — see §3/§5)** |
| Levels *truly* configurable (boundary-grade) | **false** (verdict) | true | **true** (verdict) |
| Future-proof score | 5 | 8 | **7** |
| Overall score | 6 | 6 | **7** |
| Blockers | **2** | 0 | **0** |
| Effort | high | high | high |

- **A is disqualified on its own terms.** Its verdict is explicit: levels are *not* truly configurable. A names a separate hardcoded `schemaCode` and a hardcoded `x-ref` field per level, neither of which is carried in the `levels[]` array, so adding a 5th level needs a new schema file + new `x-ref-schema` + two list edits + renderer changes. That is exactly the "hardcode 4 levels" outcome the user forbade.

- **B is the most future-proof (score 8) and is the platform-idiomatic answer** — DIGIT's own response to "configurable tree" was always a dedicated service (boundary-service), never MDMS. But its verdict caps it at overall **6** because of *permanent operational tax*: a whole new microservice authored from a **reconstructed** contract, a generated compat view, and a **source-of-truth race** flagged by the verdict. For a complaint taxonomy of *hundreds* of nodes (not the millions of geographic boundaries that justified a dedicated geo service), this is over-engineering for day one.

- **C gets the same `levelsTrulyConfigurable: true` verdict as B, the highest overall score (7), zero blockers, and zero new infrastructure** — no microservice, no Postgres table, no Flyway table, no Kafka topic, no Kong route, no Helm service wiring. Depth is pure data in `ComplaintHierarchyDefinition.levels[]`, read by one generic renderer that `.map`s over the array (the `BoundaryFilter.js` positional pattern). Reads are "free" on both tiers: `useCustomMDMS` (frontend) and pgr-services' v1 `_search` (backend) consume any master by name with **no new client plumbing**.

### The consolidation we fold in (the two-master rework)

The earlier draft of this doc shipped Approach C as **five masters** (`ComplaintHierarchyDefinition`, `ClassificationNode`, `ServiceDefs`, `HierarchySchema`, `ComplaintTypeDepartments`), kept `ServiceDefs` as the leaf master, left the backend untouched, and made the hierarchy opt-in and reversible. The PR #861 review **inverted** that:

1. **Two masters only.** `ClassificationNode` is renamed `ComplaintHierarchy` and now holds **all** nodes — interior levels AND leaf complaint sub-types — in one adjacency list. `ServiceDefs`, `HierarchySchema`, and `ComplaintTypeDepartments` are **removed**.
2. **The leaf is no longer `ServiceDefs`.** Leaf complaint types are `ComplaintHierarchy` rows at the `isLeafServiceCode` level, carrying `department`/`departments[]`/`slaHours`/`keywords` inline. A leaf row's `code` **is** the `serviceCode` stored on a complaint.
3. **`menuPath` is gone from the masters.** It was a UI-only derived value, never a stored linchpin. Grouping is reconstructed from `parentCode`/`path` (group key = `leaf.parentCode`; group label = the parent node's `name`).
4. **The backend now reads the new master.** pgr-services validates `serviceCode` against `ComplaintHierarchy` leaf rows, sources the SLA map from them, and the analytics V2-grain materialized view reads them too. This is therefore **not** backend-untouched and **not** trivially reversible.

### Why this is correct rather than just cheap

C's verdict: *"No hard break of the as-is read/write paths was found... PROVIDED the design's invariants are actually honored."* The decisive invariant in the two-master model is **leaf-code preservation**: every leaf `ComplaintHierarchy.code` equals the old `ServiceDefs.serviceCode` **verbatim**, so every already-filed complaint (`eg_pgr_service_v2.servicecode`), every `EscalationConfig.overrides` key, and every localization key still resolves. Configurability is unchanged from the original Approach C: depth is pure data in `levels[]`, navigated positionally by one generic renderer.

---

## 2. Final Data Model

**Two MDMS-v2 masters** under module `RAINMAKER-PGR`, both stored in `eg_mdms_data` (no new tables, no new service). The split mirrors boundary-service's **definition / node** concerns, collapsed into MDMS rows because complaint nodes carry no geometry (the only reason boundary splits entity from relationship). The merged schema lives at
`utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`.

### 2.1 `RAINMAKER-PGR.ComplaintHierarchyDefinition` — the configurable-levels mechanism

**UNCHANGED by the rework.** This is the direct analogue of `boundary_hierarchy.boundaryhierarchy` jsonb. **One record per `(tenantId, hierarchyType)`. `x-unique: ["hierarchyType"]`. Immutable** (re-shape ⇒ publish a new `hierarchyType`).

```json
{
  "hierarchyType": "PGR",
  "active": true,
  "levels": [
    {"levelCode":"AUTHORITY_TYPE","order":1,"parentLevel":null,           "isFreeText":false,"isLeafServiceCode":false,"label":"Authority Type"},
    {"levelCode":"MAIN_CATEGORY", "order":2,"parentLevel":"AUTHORITY_TYPE","isFreeText":false,"isLeafServiceCode":false,"label":"Main Category"},
    {"levelCode":"SECTOR",        "order":3,"parentLevel":"MAIN_CATEGORY", "isFreeText":false,"isLeafServiceCode":false,"label":"Sector"},
    {"levelCode":"SUB_TYPE",      "order":4,"parentLevel":"SECTOR",        "isFreeText":false,"isLeafServiceCode":true, "label":"Complaint Sub-Type"}
  ]
}
```

Exactly **one** level sets `isLeafServiceCode: true` — the codes of `ComplaintHierarchy` rows at that level are the serviceCodes stored on complaints.

### 2.2 `RAINMAKER-PGR.ComplaintHierarchy` — one adjacency list for the WHOLE tree (interior + leaf)

`x-unique: ["hierarchyType","code"]` (composite). `required: [hierarchyType, levelCode, code, name]`. `levelCode` must equal a `levels[].levelCode` (string equality, no FK — the same loose coupling boundary uses). `parentCode` = parent node's code (`null` at the root level). `path` = dot-delimited materialized path, **computed parent-before-child by the loader** (boundary computes it server-side).

This single master holds **both** the interior level nodes **and** the leaf complaint sub-types — there is no separate leaf master anymore.

```json
{ "hierarchyType":"PGR","levelCode":"CATEGORY","code":"Garbage",     "parentCode":null,      "name":"Garbage",      "order":1,"active":true,"path":"Garbage" }
{ "hierarchyType":"PGR","levelCode":"CATEGORY","code":"StreetLights","parentCode":null,      "name":"Street Lights","order":2,"active":true,"path":"StreetLights" }

{ "hierarchyType":"PGR","levelCode":"SUB_TYPE","code":"BurningOfGarbage","parentCode":"Garbage","name":"Burning of garbage","order":2,"active":true,"path":"Garbage.BurningOfGarbage","department":"DEPT_3","slaHours":336,"keywords":"garbage, burn, fire, smoke" }
{ "hierarchyType":"PGR","levelCode":"SUB_TYPE","code":"StreetLightNotWorking","parentCode":"StreetLights","name":"Streetlight not working","order":1,"active":true,"path":"StreetLights.StreetLightNotWorking","department":"DEPT_1","slaHours":336,"keywords":"streetlight, light, repair, pole, electric" }
```

**Leaf rows** (at the `isLeafServiceCode` level) carry **four extra, leaf-only fields**:

| Leaf-only field | Meaning |
|---|---|
| `department` | the PRIMARY owning department code — the single value backend routing/validation uses |
| `departments[]` | ALL departments this complaint type routes to (re-expresses the removed `ComplaintTypeDepartments` master inline; `department` is the primary of this list) |
| `slaHours` | resolution SLA in hours |
| `keywords` | comma-separated search keywords |

Interior nodes **omit** these four fields. The schema permits this because the merged `ComplaintHierarchy` schema declares them as optional `properties` (not `required`) while keeping `additionalProperties:false` — so mixed-shape interior/leaf rows both pass create.

**Leaf detection (the operative heuristic).** A `ComplaintHierarchy` row is a leaf **iff it carries `department` or `slaHours`** (interior nodes omit both). This is what pgr-services and the analytics MV use (`data->>'department' IS NOT NULL`, and the Number-guard on `slaHours` in `MDMSUtils.fetchServiceCodeToSlaMillis`). The strictly-correct alternative — resolve the `isLeafServiceCode` level from `ComplaintHierarchyDefinition` and match `levelCode` — needs a second fetch; the heuristic is the shipped behaviour.

> **A leaf row's `code` IS the serviceCode stored on a complaint.** This is the data-safety invariant. It is preserved **verbatim** from the old `ServiceDefs.serviceCode` by the migration — see §3.

### 2.3 ~~`RAINMAKER-PGR.HierarchySchema`~~ — REMOVED

The earlier draft proposed a per-module visible-level window (`highestLevel`/`lowestLevel`). It is **removed**. No backend reader exists; the dropdown window is reconstructed from the `levels[]` order in `ComplaintHierarchyDefinition`. (Confirm no UI/configurator/MCP consumer relied on it before deletion — open question Q3 in the rework plan.)

### 2.4 ~~`RAINMAKER-PGR.ServiceDefs`~~ — REMOVED (folded into `ComplaintHierarchy`)

`ServiceDefs` is **deleted as a master.** Its leaf records are now `ComplaintHierarchy` rows at the `isLeafServiceCode` level. The mapping is:

| Old `ServiceDefs` field | New home on the `ComplaintHierarchy` leaf row |
|---|---|
| `serviceCode` | `code` (verbatim — this is the data-safety invariant) |
| `name` | `name` |
| `department` | `department` |
| `slaHours` | `slaHours` |
| `keywords` | `keywords` |
| `order`, `active` | `order`, `active` |
| `menuPath` / `menuPathName` | **removed** — grouping derives from `parentCode` (key) and the parent node's `name` (label) |

The leaf→parent link is now the explicit `parentCode` field (no more `parentCode ?? sector ?? menuPath` fallback chain).

### 2.5 ~~`RAINMAKER-PGR.ComplaintTypeDepartments`~~ — REMOVED (folded into leaf rows)

The separate `serviceCode → departments[]` mapping master is **deleted**. Multi-department routing is re-expressed inline on the leaf row via the optional `departments[]` array, with `department` as its primary. A migrating tenant that used `ComplaintTypeDepartments` carries those departments onto the leaf; a tenant that did not gets a single-element `departments[]` (or just `department`). See §5 / rework-plan §8 Q1 on confirming no consumer depended on the standalone master.

### 2.6 Proof that N is configurable (not hardcoded)

| What changes when a tenant wants a different depth | What you touch |
|---|---|
| Mozambique wants **4** levels (Authority → Category → Sector → Sub-Type) | Ship a 4-element `levels[]` + matching `ComplaintHierarchy` rows (interior + leaf). |
| Tenant wants today's **2** levels (Category → Sub-Type) | Ship a 2-element `levels[]` (one CATEGORY level + the leaf level) + `ComplaintHierarchy` rows. **There is no zero-config flat mode** — every tenant ships at least a degenerate 2-level hierarchy. |
| A tenant later wants a **5th** level (e.g. Province on top) | Add **one element** to `levels[]` + the new `ComplaintHierarchy` rows for that level. **No schema file, no `x-ref-schema`, no code, no Helm/properties edit, no renderer change.** |

This is the decisive contrast with Approach A. In A, the level→master binding and the parent join field name are *outside* `levels[]`. In **C, a level is fully described by its own `levels[]` element**, and every node of every level — including leaves — lives in the one `ComplaintHierarchy` master keyed by `(hierarchyType, code)` with a `parentCode` pointer, exactly how boundary puts every place of every level in one `boundary_relationship` table. That is what earns C the same `levelsTrulyConfigurable: true` verdict as the dedicated service.

---

## 3. Invariants (re-examined for the breaking, two-master model)

The original draft's "every consumer keeps reading the flat `ServiceDefs` array unchanged" guarantee **no longer holds** — `ServiceDefs` is deleted and the backend reads the new master. The invariants are now about **data preservation and lockstep ordering**, not non-disruption.

### Data-safety invariants (these MUST hold)

| # | Invariant | Why it matters |
|---|---|---|
| 1 | **Leaf `code` == old `ServiceDefs.serviceCode`, verbatim** (never re-derived via `toPascal`/slug). | Historical complaints (`eg_pgr_service_v2.servicecode`), `EscalationConfig.overrides` keys, and localization keys all key on the serviceCode. Drift orphans them. |
| 2 | **Global `(hierarchyType, code)` uniqueness** across the merged interior+leaf keyspace. | A leaf serviceCode equal to an interior node code, or two same-named leaves under different parents, silently drops a row on x-unique create. |
| 3 | **Every old `serviceCode` exists as exactly one leaf `code`** after migration. | Any complaint whose serviceCode lost its leaf row fails `validateMDMS` with `INVALID_SERVICECODE`. |
| 4 | **Leaf rows carry `department`/`slaHours`/`keywords`; interior rows omit them.** | This is the leaf-detection heuristic the backend + MV depend on. A leaf missing `department` is invisible to validation and routing. |
| 5 | **`EscalationConfig` keys still equal leaf codes** (the `EscalationConfig` master is unchanged but co-dependent). | Per-serviceCode SLA overrides must match the migrated leaf codes. |

### What changed (no longer "unchanged")

| Surface | Old draft claim | Reality after rework |
|---|---|---|
| pgr-services `validateMDMS`/`validateDepartment` | unchanged JSONPath into `ServiceDefs` | **repointed** to `$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy[?(@.code=='X')]`, leaf rows only |
| pgr-services SLA map (`MigrationUtils.getServiceCodeToSLAMap`, `MDMSUtils.fetchServiceCodeToSlaMillis`) | unchanged | **repointed** to `ComplaintHierarchy` leaf rows; interior nodes skipped by the Number-guard on `slaHours` |
| `DashboardQueryBuilder` service-dept CTE | reads `ServiceDefs` | **repointed** to `ComplaintHierarchy` leaf rows |
| V2-grain analytics MV (`V20260608000000__create_v2_grain_mvs.sql`) | reads `ServiceDefs` + `menuPath`; `REFRESH` only | **repointed** to `ComplaintHierarchy` leaf rows; `service_group` derived from `parentCode` (not `menuPath`) |
| All frontends (esbuild, micro-ui, digit-ui-v2) | flat `menuPath` fallback survives | **no flat fallback** — read `ComplaintHierarchy`, keep leaf rows, map to the legacy shape at the data-access layer |

---

## 4. Phased Rollout (breaking, lockstep — NOT additive/independent)

Unlike the original draft, **the phases are not independently shippable and the rollout is not reversible by deleting a definition record.** Once `ServiceDefs` is gone and pgr-services reads `ComplaintHierarchy`, an un-migrated tenant has a **hard outage** (`INVALID_SERVICECODE` on every create, `CS_NO_COMPLAINT_HIERARCHY` in the picker). Every tenant MUST be migrated before backend cutover. The full ordered runbook + rollback is in [`../migration/complaint-type-2level-to-Nlevel.md`](../migration/complaint-type-2level-to-Nlevel.md); the phase/effort table is in [`complaint-hierarchy-2master-rework-plan.md`](complaint-hierarchy-2master-rework-plan.md) §7.

### Phase 0 — Schema + registration (breaking schema shape)

- **Edit** `schema/RAINMAKER-PGR.json`: rename `ClassificationNode` → `ComplaintHierarchy`, add optional leaf fields `department`/`departments`/`slaHours`/`keywords`; **delete** `ServiceDefs`, `HierarchySchema`, `ComplaintTypeDepartments`. Keep `ComplaintHierarchyDefinition`, `UIConstants`, `EscalationConfig`.
- **Edit** `application.properties` (schema-create list + schemacode map) and the matching Helm `values.yaml` to register only `ComplaintHierarchyDefinition` + `ComplaintHierarchy` for PGR.
- Apply the **`x-ref-schema [] → {}` jsonb quirk fix** on create (per project memory): `/schema/v1/_create` can persist `x-ref-schema` as `{}` → HTTP 400 `ClassCastException` on first data `_create`; schema `_update` is 501. Fix in-place via `jsonb_set('{x-ref-schema}','[]')` and verify `jsonb_typeof`.

### Phase 1 — Masters migration + preflight dry-run

Headless, **idempotent** on `(hierarchyType, code)`, run **per tenant at both city and state-level** (pgr-services validates at the state-level tenant). Migrate `ClassificationNode` interior rows 1:1 and fold each `ServiceDefs` leaf into a `ComplaintHierarchy` leaf row with `code = serviceCode` verbatim. See the migration doc.

### Phase 2 — Backend pgr-services repoint

Repoint `PGRConstants`, `MDMSUtils`, `ServiceRequestValidator`, `PGRService`, `NotificationService`, `DashboardQueryBuilder`, `PGRQueryBuilder` (SLA-order comment + map), `MigrationUtils` to `ComplaintHierarchy` leaf rows, plus the V2-grain MV. **Caveat:** the V2-grain MV CTE was edited **in place** in `V20260608000000__create_v2_grain_mvs.sql` after it had already been applied on running environments — Flyway will reject the changed checksum. Run `flyway repair` (or a new forward migration on environments where the old version already ran). Restart pgr-services to reload the process-lifetime SLA cache.

### Phase 3 / 4 / 4b — Configurator + frontends (same cutover window)

Configurator (registry/data-provider, ingest writer, parser merge, migrate button), DIGIT-UI esbuild, digit-ui-v2, micro-ui — all repointed to `ComplaintHierarchy` at the **data-access layer** (fetch the master, keep leaf rows, map to the legacy `ServiceDefs` shape so downstream components are unchanged; derive `menuPath`/`menuPathName` from `parentCode` + parent node name). These must release **together** with Phases 1–2.

### Phase 5+ — Onboarding loaders, MCP, indexer/chatbot/k6, tests, docs

Fast-follow only if non-blocking for complaint create/validate.

---

## 5. Risks, Blockers, Open Questions

### Blockers
**None** for the data model itself. The risk is **operational**: this is a breaking lockstep change with no safety net (see below).

### Risks (with mitigations)

| Risk | Severity | Mitigation |
|---|---|---|
| **No flat fallback.** An un-migrated tenant has neither master populated → `INVALID_SERVICECODE` on every create + `CS_NO_COMPLAINT_HIERARCHY` in the picker. | **High** | Every tenant MUST be migrated (city + state) before backend cutover. Lockstep release; preflight dry-run gate. |
| **Ordering hazard.** Deleting `ServiceDefs` / repointing pgr-services before data is migrated at the state-level tenant breaks validate/SLA. The V2-MV must not build before `ComplaintHierarchy` is populated or it materializes empty. | **High** | Strict order: migrate (city+state) → backend cutover + restart + MV → frontends → only then delete old masters. |
| **Leaf-code drift** would orphan historical complaints, `EscalationConfig.overrides`, and loc keys. | **High** | Migration copies `serviceCode` → `code` **verbatim**; preflight asserts every old serviceCode exists as a leaf and `(hierarchyType, code)` is globally unique. |
| **Flyway checksum mismatch** — the V2-grain MV migration was edited in place after deploy. | Medium | `flyway repair` on affected environments, or ship a new forward migration. Documented in the migration runbook. |
| Multi-department regression — `ComplaintTypeDepartments` collapses to inline `departments[]`/`department`. | Medium | Carry `departments[]` onto the leaf during migration; confirm no consumer relied on the standalone master (Q1). |
| **Not reversible by deleting a record.** Rollback = restore the old masters from snapshot + redeploy old images + revert the MV. | Medium | Mandatory MDMS snapshot before migration; documented rollback in the runbook. |
| `menuPath` removal breaks any consumer that read it from a master. | Medium | All consumers repointed; `menuPath`/`menuPathName` reconstructed UI-side from `parentCode` + parent `name` at the data-access layer. |
| Frontend `useServiceDefs` SessionStorage cache (`cacheTime: Infinity`). | Low | Clear on deploy or stale data masks the migration. |

### Open questions for the reviewer
See [`complaint-hierarchy-2master-rework-plan.md`](complaint-hierarchy-2master-rework-plan.md) §8 (multi-department, flat-mode policy, `HierarchySchema` removal, leaf-level predicate, code-preservation guarantee, V2-MV `service_group` source, cross-frontend scope).

**Key files this plan touches:** `schema/RAINMAKER-PGR.json`; `mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.ComplaintHierarchy.json` (+ `…ComplaintHierarchyDefinition.json`); `application.properties` + `devops/.../default-data-handler/values.yaml`; pgr-services (`PGRConstants`, `MDMSUtils`, `ServiceRequestValidator`, `PGRService`, `NotificationService`, `DashboardQueryBuilder`, `PGRQueryBuilder`, `MigrationUtils`) + `V20260608000000__create_v2_grain_mvs.sql`; configurator (`hierarchyMigration.ts`, data-provider registry, `excelParser.ts`); the three frontend trees; the loaders; and the migration script + preflight dry-run.

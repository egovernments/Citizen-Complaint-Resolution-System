# CCRS Complaint Classification — Recommendation & Implementation Plan

**Author:** Lead Architect · **Date:** 2026-06-12 · **Audience:** CCRS engineering + onboarding
**Scope:** Mozambique PGR Solution Design §2 (Complaint Classification Framework) + the user's hard requirement that *the number of hierarchy levels itself be configurable*, boundary-service style.

---

## 1. Recommendation

**Adopt Approach C (Config-Driven Dynamic Hierarchy, MDMS-only) as the foundation, hardened with two corrections borrowed from the adversarial review, and keep Approach B (a dedicated `pgr-classification` service) as the documented Phase-4 escape hatch if scale or integrity demands ever exceed what MDMS can give.**

This is a **C-primary / B-as-future-option hybrid**, not a coin flip. Here is the reasoning, grounded in the three adversarial verdicts.

### Why C wins

| Criterion | A (MDMS masters + ServiceDefs edit) | B (dedicated service) | **C (MDMS config-driven)** |
|---|---|---|---|
| Breaks existing flows | false | false | **false** |
| Levels *truly* configurable (boundary-grade) | **false** (verdict) | true | **true** (verdict) |
| Future-proof score | 5 | 8 | **7** |
| Overall score | 6 | 6 | **7** |
| Blockers | **2** | 0 | **0** |
| Effort | high | high | high |

- **A is disqualified on its own terms.** Its verdict is explicit: levels are *not* truly configurable. A names a separate hardcoded `schemaCode` and a hardcoded `x-ref` field per level, neither of which is carried in the `levels[]` array, so adding a 5th level needs a new schema file + new `x-ref-schema` + two list edits + renderer changes. That is exactly the "hardcode 4 levels" outcome the user forbade. A also carries a **hard blocker**: relaxing `additionalProperties:false` on the *existing* `RAINMAKER-PGR.ServiceDefs` requires a schema `_update` path that **does not exist** in default-data-handler — I verified `application.properties:49` wires only `/mdms-v2/schema/v1/_create`, and `createMdmsSchemaFromFile` swallows the duplicate on re-`_create` (`DataHandlerService.java:242-258`).

- **B is the most future-proof (score 8) and is the platform-idiomatic answer** — DIGIT's own response to "configurable tree" was always a dedicated service (boundary-service), never MDMS. But its verdict caps it at overall **6** because of *permanent operational tax*: a whole new microservice authored from a **reconstructed** contract (boundary-service Java is not vendored — image only, `docker-compose.egov-digit.yaml:795`), a generated compat `ServiceDefs` view that must be kept byte-identical to the hierarchy through a **Kafka-async projector**, and a **source-of-truth race** the verdict flagged: `MdmsBulkLoader`'s whole-bundle idempotency skip (`MdmsBulkLoader.java:73`) means "loader and projector both write ServiceDefs" is a *conflict*, not redundancy. For a complaint taxonomy of *hundreds* of nodes (not the millions of geographic boundaries that justified a dedicated geo service), this is over-engineering for day one.

- **C gets the same `levelsTrulyConfigurable: true` verdict as B, the highest overall score (7), zero blockers, and zero new infrastructure** — no microservice, no Postgres table, no Flyway, no Kafka topic, no Kong route, no Helm service wiring. Depth is pure data in `ComplaintHierarchyDefinition.levels[]`, read by one generic renderer that `.map`s over the array (the `BoundaryFilter.js:42-57,499-617` positional pattern). Reads are "free" on both tiers: `useCustomMDMS` (frontend) and pgr-services' v1 `_search` (backend) consume any new master by name with **no new client plumbing**.

### The two corrections we fold in (from C's verdict)

1. **Migration mechanism is real, but not via the seed loader.** C's verdict warns that re-seeding extended `ServiceDefs` over an already-seeded tenant is a silent no-op (`MdmsBulkLoader.java:67-77` skips the whole bundle). **Correction:** the migration of the 33 records uses the **`/mdms-v2/v2/_update` data endpoint** — which I confirmed *does* exist and is already used by configurator/digit-ui-v2/digit-mcp data-providers (`configurator/packages/data-provider/src/client/endpoints.ts:9`) — driven by a one-shot script, **not** the deploy-time seeder. This also means we **do not relax `additionalProperties:false`**; we *add* the new optional keys to `properties{}` on a tenant whose schema is being created fresh, and for already-deployed tenants we run the data backfill through `_update` against the existing schema. (See §4, Phase 0 note.)

2. **The generic renderer is built, not reused.** C's verdict is blunt: `BoundaryFilter.js` lives **only** in `digit-ui-esbuild`; LIVE `micro-ui/web` and `digit-ui-v2` share no code and each need a renderer written from scratch. We **own this cost explicitly** (it is the bulk of frontend effort) and we ship each frontend behind a **per-frontend fallback** so a frontend that has not yet got the new renderer simply keeps its legacy 2-level `menuPath` picker. No frontend is ever in a broken state.

### Why this is safe rather than just cheap

C's verdict: *"No hard break of the as-is read/write paths was found... PROVIDED the design's invariants are actually honored."* The entire plan below is structured so that **with no `ComplaintHierarchyDefinition` record present, the system is byte-for-byte today's behavior** — tenant `pg` and its 33 codes never change. The hierarchy is strictly opt-in, per tenant, and fully reversible (delete the definition record → everything falls back).

---

## 2. Final Data Model

Five MDMS-v2 masters under module `RAINMAKER-PGR`, all stored in `eg_mdms_data` (no new tables, no new service). The split mirrors boundary-service's **definition / node / window** concerns, collapsed into MDMS rows because complaint nodes carry no geometry (the only reason boundary splits entity from relationship).

### 2.1 `RAINMAKER-PGR.ComplaintHierarchyDefinition` — the configurable-levels mechanism

This is the direct analogue of `boundary_hierarchy.boundaryhierarchy` jsonb (`local-setup/db/full-dump.sql:64`, seeded at 4 levels for `statea.citya` and 3 for `ke.nairobi` against one schema — `:2013-2014`). **One record per `(tenantId, hierarchyType)`. `x-unique: ["hierarchyType"]`. Immutable** (re-shape ⇒ publish a new `hierarchyType`, matching `BoundaryHierarchyCreate.tsx:6-9`).

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

### 2.2 `RAINMAKER-PGR.ClassificationNode` — adjacency-list node (boundary entity + relationship, collapsed)

`x-unique: ["hierarchyType","code"]` (composite, exactly the `ACCESSCONTROL-ROLEACTIONS.json:87-90` precedent). `levelCode` must equal a `levels[].levelCode` (string equality, no FK — same loose coupling boundary uses). `parentCode` = parent node's code (= `boundary_relationship.parent`). `path` = dot-delimited materialized path (= boundary `ancestralmaterializedpath`, pipe→dot), **computed parent-before-child by the loader** the way boundary computes it server-side (`boundary-persister.yml:82,97`).

```json
{ "hierarchyType":"PGR","levelCode":"AUTHORITY_TYPE","code":"IGE",  "parentCode":null,            "name":"IGE",       "order":1,"active":true,"path":"IGE" }
{ "hierarchyType":"PGR","levelCode":"AUTHORITY_TYPE","code":"IGSAE","parentCode":null,            "name":"IGSAE",     "order":2,"active":true,"path":"IGSAE" }
{ "hierarchyType":"PGR","levelCode":"MAIN_CATEGORY", "code":"IGE_COMPLAINT","parentCode":"IGE",   "name":"Complaint", "order":1,"active":true,"path":"IGE.IGE_COMPLAINT" }
{ "hierarchyType":"PGR","levelCode":"MAIN_CATEGORY", "code":"IGE_GRIEVANCE","parentCode":"IGE",   "name":"Grievance", "order":2,"active":true,"path":"IGE.IGE_GRIEVANCE" }
{ "hierarchyType":"PGR","levelCode":"MAIN_CATEGORY", "code":"IGE_PETITION", "parentCode":"IGE",   "name":"Petition",  "order":3,"active":true,"path":"IGE.IGE_PETITION" }
{ "hierarchyType":"PGR","levelCode":"SECTOR","code":"HEALTH",  "parentCode":"IGE_COMPLAINT","name":"Health",         "order":1,"active":true,"path":"IGE.IGE_COMPLAINT.HEALTH" }
{ "hierarchyType":"PGR","levelCode":"SECTOR","code":"COMMERCE","parentCode":"IGE_COMPLAINT","name":"Commerce",      "order":2,"active":true,"path":"IGE.IGE_COMPLAINT.COMMERCE" }
{ "hierarchyType":"PGR","levelCode":"SECTOR","code":"PUBLIC_SERVICES","parentCode":"IGE_COMPLAINT","name":"Public Services","order":3,"active":true,"path":"IGE.IGE_COMPLAINT.PUBLIC_SERVICES" }
```

> Leaf (`SUB_TYPE`) nodes are **not** stored here. The leaf is the `ServiceDefs` record itself (§2.4) — that is what keeps the backend, persister, analytics, and the 33-code k6 test untouched. `ClassificationNode` holds only the *non-leaf* levels.

### 2.3 `RAINMAKER-PGR.HierarchySchema` — per-module visible window (= `CMS-BOUNDARY.HierarchySchema`)

Direct copy of `schema/egov-bndry-mgmnt.json:47-84`. `x-unique: ["moduleName"]`. Bounds the dropdown window; names levels by string, encodes neither count nor order.

```json
{ "moduleName":"PGR", "hierarchyType":"PGR", "highestLevel":"AUTHORITY_TYPE", "lowestLevel":"SUB_TYPE", "active":true }
```

### 2.4 `RAINMAKER-PGR.ServiceDefs` (the leaf) — additive fields only

All existing fields and `required[]`/`x-unique:[serviceCode]` **unchanged**. We **add the new keys to `properties{}`** and **leave `additionalProperties:false` as-is** (the new keys are then *accepted*, not rejected — this sidesteps A's schema-`_update` blocker entirely for fresh tenants; see Phase 0 for already-deployed tenants).

```json
{
  "serviceCode":"HEALTH_SERVICE_QUALITY","name":"Health Service Quality","department":"DEPT_HEALTH",
  "slaHours":336,"keywords":"health,quality,service","active":true,"order":1,

  "menuPath":"HEALTH","menuPathName":"Health",

  "hierarchyType":"PGR","authorityType":"IGE","category":"IGE_COMPLAINT","sector":"HEALTH",
  "path":"IGE.IGE_COMPLAINT.HEALTH","parentCode":"HEALTH"
}
```

- `serviceCode` stays the leaf and the persisted complaint type.
- `authorityType/category/sector/path` are **denormalized copies** of the leaf's ancestor chain (canonical source = the node's `path`); they exist for analytics/forward-compat and are recomputed from `path` on every load (never hand-edited).
- **`menuPath` is the back-compat linchpin** — always present, always the `SECTOR` code (§3).

### 2.5 `RAINMAKER-PGR.ComplaintTypeDepartments` — Sub-Type → many departments

The doc's separate mapping master. `x-unique: ["serviceCode"]`.

```json
{ "serviceCode":"HEALTH_SERVICE_QUALITY", "departments":["DEPT_HEALTH","DEPT_PUBLIC_SERVICES"], "primaryDepartment":"DEPT_HEALTH" }
```

`primaryDepartment` is the single value that `ServiceDefs.department` continues to mirror (preserves the single-valued backend invariants). `departments[]` is the new many-list, consumed only by new assignee-routing code.

### 2.6 Proof that N is configurable (not hardcoded)

| What changes when a tenant wants a different depth | What you touch |
|---|---|
| Mozambique wants **4** levels (Authority → Category → Sector → Sub-Type) | Ship a 4-element `levels[]` + matching `ClassificationNode` rows. |
| Tenant `pg` wants today's **2** levels (Category → Sub-Type) | Ship **no** `ComplaintHierarchyDefinition` ⇒ legacy `menuPath` grouping. Or a 2-element `levels[]`. |
| A tenant later wants a **5th** level (e.g. Province on top) | Add **one element** to `levels[]` + the new `ClassificationNode` rows for that level. **No schema file, no `x-ref-schema`, no code, no Helm/properties edit, no renderer change.** |

This is the decisive contrast with Approach A. In A, the level→master binding (`masterSchemaCode`) and the parent join field name are *outside* `levels[]`, so a new level needs a new schema + `x-ref` + two list edits. In **C, a level is fully described by its own `levels[]` element**, and every node of every level lives in the one `ClassificationNode` master keyed by `(hierarchyType, code)` with a `parentCode` pointer — exactly how boundary puts every place of every level in one `boundary_relationship` table. The generic renderer navigates **positionally** (`hierarchy[dotCount]`, `BoundaryFilter.js:42-57`) and never needs to know a per-level schemaCode. That is what earns C the same `levelsTrulyConfigurable: true` verdict as the dedicated service.

---

## 3. Back-Compat Guarantee (the #1 fear)

**Governing principle:** every existing consumer reads the **flat `$.MdmsRes.RAINMAKER-PGR.ServiceDefs` array keyed by leaf `serviceCode`**, and that array stays flat, complete, and unchanged in shape. New masters are *separate schemaCodes*. The hierarchy is *opt-in per tenant*. Below, every flow from the impact surface, and the precise reason it keeps working.

### Backend (pgr-services) — invariants 1–13

| Flow | File / anchor | Why it keeps working |
|---|---|---|
| MDMS fetch (ServiceDefs + Department at state tenant) | `MDMSUtils.java:45-101,48` | We **add** new `MasterDetail` entries to `getPGRModuleRequest` (additive); the existing ServiceDefs + Department fetch is byte-identical. Tenant-first-then-state lookup is layered *in front of* the current state-only fetch, falling back to today's exact call (inv. 7). |
| `validateMDMS` → `INVALID_SERVICECODE` | `ServiceRequestValidator.java:126-144` | JSONPath `$...ServiceDefs[?(@.serviceCode=='X')]` is untouched; leaf stays a flat array element with scalar `serviceCode` (inv. 1,2,8). |
| `validateDepartment` (assignee gate) | `ServiceRequestValidator.java:152-187` | `ServiceDefs.department` (= `primaryDepartment`) stays a single scalar; `res.get(0)` still resolves one value. Membership-in-`departments[]` is an **additive, guarded broadening** only (inv. 3,13). |
| `additionalDetail.{department,serviceName}` enrichment | `PGRService.java:242-291` | `getDepartmentFromMDMS`/`getServiceNameFromMDMS` still resolve a single `.department`/`.name`; NA/serviceCode degraded paths preserved (inv. 9). |
| Persistence | `pgr-services-persister.yml:17` | `$.service.serviceCode → servicecode` (leaf) unchanged (inv. 10). |
| Escalation / SLA | `EscalationScheduler.java:289`, `MigrationUtils.getServiceCodeToSLAMap`, `RAINMAKER-PGR.json:113-116` | `overrides` and `serviceCodeToSLA` stay keyed by **leaf serviceCode**; we never move SLA onto a non-leaf level (inv. 12). |
| Workflow / idgen | `WorkflowService.java`, `PgrWorkflowConfig.json:33` | `businessService` stays `"PGR"`; serviceCode never branches workflow or feeds the ID (inv. 11). |
| Notification dept/category | `NotificationService.java:503,678` | Same serviceCode-keyed lookups; `pgr.complaint.category.<serviceCode>` still emitted (inv. 17). |

### Frontends + chatbot — invariant 14, 15, 16

| Surface | Anchor | Why it keeps working |
|---|---|---|
| LIVE `micro-ui` FormExplorer (distinct-`menuPath` grouping; `getEffectiveServiceCode`) | `FormExplorer.js:96-111,134-145,361-371` | **`menuPath` is always derived and present** (= `SECTOR` code). Distinct-`menuPath` type list + filter-by-`menuPath` sub-type + submit-leaf-`serviceCode` are unchanged. If no `ComplaintHierarchyDefinition` for the tenant ⇒ legacy path runs verbatim (inv. 14,15). |
| esbuild FormExplorer / `CreatePGRFlowV2.tsx:276-297` | grouping on `menuPath` | Same — derived `menuPath` satisfies it; new renderer is gated. |
| v2 portal `useServiceDefs.ts:79` `toTree()` (splits `menuPath` on `.`) | `digit-ui-v2` | Still gets a flat array; splits `menuPath` on `.`. **Constraint enforced:** `SECTOR` codes must contain **no `.`** (the 33 pg codes use single tokens, so they survive). New tenants’ sector codes are validated to exclude `.`. |
| Chatbot | `egov-pgr.js:210-235` | Distinct-`menuPath` categories + serviceCode-by-`menuPath` sub-types preserved by derived `menuPath`. |
| PGRDetails forward-compat | `PGRDetails.js:253` (`match?.category \|\| match?.menuPath`) | `category` now populated ⇒ used in preference; we ensure its loc key exists (inv. 16). |

### Analytics / indexer / inbox — invariant 20

| Consumer | Anchor | Why it keeps working |
|---|---|---|
| `complaint_facts` MV (`service_group`=menuPath, `service_order`=order, `department_code`) | `V20260608000000__create_v2_grain_mvs.sql:141-151` | Reads `data->>'serviceCode'/'department'/'menuPath'/'order'` — all four keys stay flat & present. `service_group` = derived `menuPath`. **No MV rewrite**; just `REFRESH`. |
| `DashboardQueryBuilder` service_dept CTE | `DashboardQueryBuilder.java:144-171` | `data->>'serviceCode'`, `data->>'department'` unchanged. |
| ES indexer / inbox | `configs/egov-indexer/pgr-services.yml`, `INBOX.InboxQueryConfiguration.json` | Enrich by `serviceCode`, filter on `Data.service.serviceCode.keyword` — leaf serviceCode unchanged. |
| `AnalyticsCatalog` dims (`service_code/service_group/department_code`) | `AnalyticsCatalog.java:58-104` | Dimension names unchanged (external API contract intact). |

### Tests / tooling — invariant 21

- k6 33 hardcoded serviceCodes (`performance/k6/scenarios/pgr-lifecycle.js:17-40`): **none renamed** ⇒ pass.
- Backend unit tests building `{ServiceDefs:[{serviceCode,department}]}` and expecting `INVALID_SERVICECODE` (`ServiceRequestValidatorTest.java`, `ComplaintsEventsTest.java`): leaf array shape unchanged ⇒ pass.
- Integration specs asserting columns `Service Code/Name/Department/SLA/Status` and bulk-row persistence (`tests/integration-tests/tests/admin/complaint-types.spec.ts`): all existing fields preserved ⇒ pass.

### Localization — invariants 17, 18, 19

All **five** active conventions keep being emitted for every leaf (`SERVICEDEFS_<CODE>`, `SERVICEDEFS.<CODE>`, `SERVICEDEFS.<CODE>.<DEPT>`, `SERVICEDEFS_<MENUPATH>`/`.<MENUPATH>`, backend `pgr.complaint.category.<serviceCode>`). New per-level/per-node keys are **added**, never substituted. Key builders reuse the loaders' existing sanitization (`[ -]→_` for menuPath; serviceCode unsanitized) so codes with `/ ( ) , space` resolve (inv. 19). The `SERVICEDFS.` typo (`unified_loader.py:366,405` + the skip-check at `:601`) is **fixed in lockstep** (issue #539) — but only as a separately-reviewable change so we don’t entangle it with the hierarchy rollout.

---

## 4. Phased Rollout

Each phase ships independently to prod and leaves the system fully working. **Until a tenant publishes a `ComplaintHierarchyDefinition`, nothing observable changes.**

### Phase 0 — Schema + loader groundwork (additive, invisible)

**Goal:** register the new masters and extended `ServiceDefs` schema; change zero runtime behavior.

- **Edit** `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json`: add `hierarchyType/authorityType/category/sector/path/parentCode` to `ServiceDefs` `properties{}` (keep `required[]`, `x-unique`, `additionalProperties:false`).
- **Add** four schema entries (new files or array entries under `schema/`): `ComplaintHierarchyDefinition`, `ClassificationNode`, `HierarchySchema`, `ComplaintTypeDepartments`.
- **Edit both** `application.properties:54` (`default.mdms.schema.create.list`) **and** `devops/deploy-as-code/charts/urban/default-data-handler/values.yaml:46` (`default-mdms-schemacode-list`) — these are **drifted**; add all four codes to both. Add the PGR group in `mdms.schemacode.map` (`:55` / `values.yaml:47`).
- **Schema-`_update` caveat (the corrected A-blocker):** new schemaCodes seed fine via `_create`. The **extended `ServiceDefs` schema** only takes effect on **freshly-created** tenant schemas (re-`_create` on an existing schemaCode is swallowed — `DataHandlerService.java:242-258`, verified: only `_create` is wired at `application.properties:49`). For already-deployed tenants, the new `ServiceDefs` *fields* are applied at the **data** layer in Phase 3 via `/mdms-v2/v2/_update` (a real endpoint — `configurator/packages/data-provider/src/client/endpoints.ts:9` — **not** wired into the seeder), against whatever schema strictness the live tenant has. If a live tenant’s schema is strict `additionalProperties:false` and was created before this change, the backfill for *that* tenant must run a schema refresh through the configurator/MCP `_create`-with-version path or accept the fields land only on tenants onboarded post-Phase-0. **Open question Q1** below.

**Ships:** schema registration. **Breaks:** nothing (no data, no record). **Effort:** low.

### Phase 1 — Generic N-level renderer + admin authoring (gated, fallback everywhere)

**Goal:** make the hierarchy *renderable and authorable*, but only when a definition exists.

- **New shared component** `ComplaintHierarchyFilter` modeled on `BoundaryFilter.js:42-57,107-126,499-617`: reads `ComplaintHierarchyDefinition.levels[]` + `ClassificationNode` tree, `.map`s one dependent dropdown per level, positional parent/child, `isFreeText→text input`, leaf level submits `serviceCode`, generic loc key `(hierarchyType + '_' + levelCode).toUpperCase()`.
  - **Built three times** (verdict-acknowledged): LIVE `frontend/micro-ui/web` FormExplorer, esbuild (can reuse via `digit-ui-components`), and `digit-ui-v2` (hand-rolled fetch + tree builder — the bulk of the work).
  - **Each gated:** definition present → new picker; else → legacy `menuPath` picker verbatim. A frontend without the new renderer keeps its legacy path — never broken.
- **New configurator admin UIs** cloned from `HierarchyLevelEditor.tsx:41-184` (row 0 forced `parentLevel:null`, later rows' parent limited to earlier `levelCode`s) for `ComplaintHierarchyDefinition`, plus a `ClassificationNode` tree editor and a `ComplaintTypeDepartments` multi-select. **Create-only** authoring path = the sole sanctioned mutation route (compensates for MDMS not enforcing parent/child integrity).

**Ships:** authoring + rendering capability. **Breaks:** nothing (no tenant has a definition yet). **Effort:** high (three renderers).

### Phase 2 — Dataloaders emit the hierarchy (lockstep)

**Goal:** new onboardings produce the hierarchy + extended ServiceDefs natively.

- `utilities/crs_dataloader/unified_loader.py` `read_complaint_types()` (`:324-413`) + `crs_loader.py:317-385`: emit `ClassificationNode` rows per level (parent-before-child, ordered by `order`, compute `path`); extended `ServiceDefs` with `menuPath=SECTOR code` + `path/authorityType/category/sector`. **Fix the `SERVICEDFS.` typo at `:366,405` and the skip-check at `:601`** (issue #539, single coherent fix).
- `digit-mcp/src/utils/xlsx-reader.ts:470-520` + `xlsx-loader.ts` + `mdms-tenant.ts` (keep the `SERVICEDEFS*` tenant-copy skip at `:1879`).
- `configurator/src/utils/excelParser.ts:568-680`: parse new optional columns; existing serviceCode/department derivation + rejection (`:640,661`) unchanged. Register the new resources in `resourceRegistry.ts:36-37` (leave the pre-existing `nameField:'serviceName'` mismatch alone — out of scope).
- **Ownership rule (the corrected B-race, applied defensively here too):** the dataloader is the **sole writer** of `ServiceDefs`; there is no projector in Approach C, so no race exists — but document that the loader's whole-bundle idempotency skip (`MdmsBulkLoader.java:67-77`) means re-runs are no-ops, and in-place edits go through Phase 3's `_update` script.

**Ships:** new tenants onboard with full hierarchy. **Breaks:** nothing for existing tenants (they re-run the same loader → bundle skip → unchanged). **Effort:** medium.

### Phase 3 — Migrate the existing 33 serviceCodes (tenant `pg`) — opt-in, reversible

**Goal:** give an existing tenant the hierarchy *without touching serviceCode/department/slaHours/name/active*.

1. Publish `ComplaintHierarchyDefinition` (`PGR`, 4 levels) + `HierarchySchema` window for the tenant.
2. Synthesize `ClassificationNode` rows: for each distinct existing `menuPath` (e.g. `Garbage`, `StreetLights`), create a `SECTOR` node; synthesize a default `MAIN_CATEGORY` (e.g. `COMPLAINT`) and `AUTHORITY_TYPE` parent; compute `path`.
3. **Backfill the 33 `ServiceDefs` in place via `/mdms-v2/v2/_update`** (one-shot script, **not** the seeder): set `hierarchyType/authorityType/category/sector/path/parentCode`, set `menuPath = sector code` (unchanged where it already equals the grouping). **`serviceCode`, `department`, `slaHours`, `name`, `active`, `keywords` are never touched.**
   - **`Others` edge case** (from B's verdict, applies here too): `serviceCode "Others"` has `menuPath:""`. Handle as a **category-less leaf** — no synthesized empty-code parent node; `menuPath` stays `""`; it renders under a fallback group. The backfill script must special-case empty `menuPath`.
4. Backfill `ComplaintTypeDepartments` from each leaf's single department (`departments=[department], primaryDepartment=department`) ⇒ multi-dept defaults to current behavior.
5. Emit new per-node/per-level loc keys alongside the existing five conventions (idempotent `LocalizationUtil` upsert).
6. `REFRESH MATERIALIZED VIEW complaint_facts` (no rewrite; `service_group` = unchanged `menuPath`).
7. **Verify:** run k6 (`pgr-lifecycle.js`), `complaint-types.spec.ts`, `complaints.spec.ts`, `phase3-validation.spec.ts`, and a create/update smoke (`INVALID_SERVICECODE` + `additionalDetail.{department,serviceName}` enrichment).

**Rollback:** delete the tenant's `ComplaintHierarchyDefinition` → frontends fall back to `menuPath` picker, backend ignores absent masters, `ServiceDefs` untouched. **Fully reversible.**

**Ships:** tenant `pg` on the hierarchy. **Breaks:** nothing if verify gate is green. **Effort:** medium.

### Phase 4 — (Conditional) Backend multi-department + dedicated-service escape hatch

**Goal:** activate the *new* capabilities; only if/when needed.

- **4a (additive, flagged):** `getDepartmentFromMDMS` (`PGRService.java:242-271`) and `validateDepartment` (`:152-187`) read `ComplaintTypeDepartments` for tenant-first→state→country resolution and accept membership in `departments[]`; `primaryDepartment` remains the single surfaced value (preserves inv. 3,9,13). Behind a flag; default off = today's behavior.
- **4b (escape hatch — Approach B):** *Only if* a tenant's taxonomy grows so large/deep that whole-master `_search` becomes slow, or true server-enforced reparent/integrity is required, stand up the dedicated `pgr-classification` service (clone of boundary-service) and make `ServiceDefs` a generated compat view. The data model in C is **forward-compatible** with this move — the `ClassificationNode` adjacency rows map 1:1 onto `classification_node` + `classification_relationship`. This is documented, not built.

**Effort:** 4a low-medium; 4b high (deferred, likely never needed for hundreds of nodes).

---

## 5. Risks, Blockers, Open Questions, Effort

### Blockers
**None.** Approach C carries **zero blockers** in its verdict. The one blocker that killed Approach A (no schema `_update` in the seeder) is **avoided** because we add fields to `properties{}` (not relax `additionalProperties`) and migrate existing data via the real `/mdms-v2/v2/_update` data endpoint, not the seeder.

### Risks (with mitigations)
| Risk | Severity | Mitigation |
|---|---|---|
| `menuPath` is a single back-compat linchpin (analytics `service_group` + 4 legacy UIs). A future cleanup that removes it breaks dashboards + pickers. | Medium | Code comment + keep derivation in all loaders; track as tech debt; do not remove until Phase 4b retires legacy clients. |
| MDMS does not enforce parent/child (self-FK unproven per MDMS brief). A malformed manual `_create` yields silent orphans the renderer drops. | Medium | Admin UI is the only sanctioned create path (Phase 1); add a CI validator (`digit-mcp validators.ts:391-415` style) asserting every `ClassificationNode.parentCode` resolves and every leaf `path` is valid. |
| Denormalized `authorityType/category/sector` drift from canonical `path`. | Low | Loader/admin UI always recompute denormalized fields from `path`; treat `path` as source of truth. |
| `SECTOR` codes containing `.` would fracture v2's `menuPath.split('.')`. | Low | Validate sector codes to exclude `.` in admin UI + loader; the 33 pg codes already comply. |
| Whole-master `_search` fetches all `ClassificationNode` rows client-side. | Low | Complaint taxonomies are hundreds, not millions; `HierarchySchema` window + `useCustomMDMS` `cacheTime: Infinity` (`FormExplorer.js:88`) bound it. Escape hatch = Phase 4b. |
| Two drifted schemaCode-list sources (`application.properties:54` vs Helm `values.yaml:46`). | Low | Phase 0 edits **both**; add a reconciliation note/CI check. |
| `Others` empty-`menuPath` migration creates a degenerate empty-code node. | Low | Phase 3 special-cases empty `menuPath` as a category-less leaf (no synthesized parent). |

### Open questions for you
1. **Q1 — strict-schema on already-deployed tenants:** For tenants whose `RAINMAKER-PGR.ServiceDefs` schema was created *before* Phase 0 with `additionalProperties:false`, do we (a) accept the new fields land only on tenants onboarded post-Phase-0, or (b) invest in a schema-version refresh via the configurator/MCP `_create`-with-bumped-version path? Affects whether tenant `pg` can carry `authorityType/category/sector` on its 33 records or only `menuPath`-derived grouping. *Recommendation: (b) for `pg`, since it's our reference tenant.*
2. **Q2 — `menuPath` semantics for >2 visible levels in v2:** v2 builds its tree by splitting `menuPath` on `.`. For Mozambique's 4 levels, do we want the v2 *citizen* portal to show all 4 (set `menuPath` to a dotted path like `COMPLAINT.HEALTH` and rely on v2's split) or keep v2 at a single `SECTOR` grouping and reserve full depth for the new `ComplaintHierarchyFilter`? *Recommendation: single-token `menuPath` for safety; full depth via the new renderer.*
3. **Q3 — multi-department go-live:** Is the one-to-many Sub-Type→Departments routing needed at Mozambique launch (pulls Phase 4a forward), or is single-department-with-mapping-as-future sufficient at launch?
4. **Q4 — `hierarchyType` naming:** confirm `"PGR"` as the single hierarchyType, vs per-authority types (e.g. one definition per IGE/IGSAE). The model supports either; one shared `PGR` definition with `AUTHORITY_TYPE` as the top *level* is simpler and is what §2 assumes.

### Effort per phase
| Phase | Effort | Independently shippable |
|---|---|---|
| 0 — schema + lists | Low | Yes |
| 1 — 3 renderers + admin UIs | **High** (dominant cost) | Yes (gated) |
| 2 — 3 dataloaders + #539 fix | Medium | Yes |
| 3 — migrate 33 codes (`_update` script + verify) | Medium | Yes (reversible) |
| 4a — backend multi-dept (flagged) | Low–Medium | Yes |
| 4b — dedicated service (escape hatch) | High (deferred) | N/A — only if needed |

**Overall effort: HIGH** (the verdicts are unanimous that all three options are high once you count three from-scratch renderers, three lockstep dataloaders, four schemas + admin UIs, and migration tooling). C is the high-effort option with **the best score, zero blockers, zero new infrastructure, and a clean upgrade path to B** if it is ever needed.

**Key files this plan touches:** `schema/RAINMAKER-PGR.json`; new `schema/` + `mdmsData/RAINMAKER-PGR/*` entries; `application.properties:54-55` + `devops/.../default-data-handler/values.yaml:46-47`; the three frontend FormExplorers + `configurator/src/resources/`; `unified_loader.py`/`crs_loader.py`/`xlsx-reader.ts`/`excelParser.ts`; a one-shot `/mdms-v2/v2/_update` migration script; `PGRService.java:242-291` + `ServiceRequestValidator.java:152-187` (Phase 4a, flagged). **Nothing in the backend write/validate/persist/analytics path changes until Phase 4a, and that is behind a default-off flag.**

# Engineering Plan — Rework Complaint-Classification Hierarchy to the Two-Master Model (PR #861 Review)

## Gaps the draft missed (added after repo verification)

1. **`PGRQueryBuilder.java` IS affected** — the draft asserted "No change to PGRQueryBuilder." False. Its `addOrderByClause` comment and SLA-ordering logic reference `RAINMAKER-PGR.ServiceDefs` as the SLA-budget source (L201) and consume the `serviceCodeToSla` map. No JSONPath there, but the source-of-truth comment must change and behavior depends on the repointed SLA map. Verified.
2. **V2 grain materialized-views SQL was entirely missed** — `backend/pgr-services/src/main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql` builds an MDMS CTE: `WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs'` and `NULLIF(data->>'menuPath','') AS service_group` (L141-149), joined into the analytics MV. This is a **backend artifact reading both the deleted master AND `menuPath`**, and a Flyway migration cannot be edited in place once applied — needs a new forward migration. This is a hard miss.
3. **`MigrationUtils.getServiceCodeToSLAMap` is live, not "if still wired"** — `MigrationService.java:87` calls it. The draft hedged ("if still wired; else mark legacy"). It is wired; it must be repointed.
4. **`digit-ui-v2` (a whole separate Vite frontend) was missed** — `digit-ui-v2/src/hooks/useServiceDefs.ts`, `CitizenComplaintCreatePage.tsx`, `CitizenComplaintsListPage.tsx`, `CitizenComplaintShowPage.tsx`, `packages/data-provider/*`, `src/api/types.ts` all read `RAINMAKER-PGR.ServiceDefs` and split `menuPath`. The draft's "cross-frontend fallout" line named only `packages/modules/pgr` and `frontend/micro-ui/web`. digit-ui-v2 is nightly-built and deployed (recent commits `bf6cb79d`, `4ff431de`) → must be in scope or explicitly deferred.
5. **`digit-mcp` server + skills missed** — `digit-mcp/src/tools/pgr-workflow.ts`, `mdms-tenant.ts`, `utils/xlsx-loader.ts`, `utils/xlsx-reader.ts`, `api/pgr-dashboard.ts`, `data/openapi-spec.ts`, plus `validate_complaint_types` doc and the `digit-tenant-setup` skill all hardcode `ServiceDefs`. These drive the XLSX onboarding skill referenced in this environment.
6. **`utilities/crs_dataloader/*` is separate from `local-setup/jupyter/dataloader/*`** — the draft only listed the local-setup loader. There is a second loader tree (`crs_loader.py`, `unified_loader.py`, `unified_loader_v1.py`, `dataloader_ui.py`) that also writes ServiceDefs/menuPath.
7. **Indexer/persister + chatbot + k6 confirmed but under-specified** — `configs/egov-indexer/pgr-services.yml`, `pgr-migration-batch-indexer.yml` (and their `local-setup/configs` copies), `xstate-chatbot/.../egov-pgr.js`, `performance/k6/scenarios/pgr-lifecycle.js` all reference ServiceDefs/menuPath. The draft mentioned these in passing; they need owners assigned.
8. **Integration/e2e tests missed** — `tests/integration-tests/tests/admin/complaint-types.spec.ts`, `complaints.spec.ts`, `configurator-mdms-fixes-2026-04-29.spec.ts`, `recently-shipped-fixes.spec.ts`, `onboarding/phase3-validation.spec.ts`, plus `local-setup/tests/e2e/common/mdms-servicedef.ts` and `complaint-type-localization.spec.ts`. These will fail post-cutover.
9. **`local-setup/db/full-dump.sql`** contains seeded ServiceDefs/menuPath data — any reseed-from-dump path reintroduces the dead master.

Everything else in the draft (the 2-master target, the data-loss invariant, the breaking-change framing, the lockstep ordering) is correct and is preserved below with the above folded in.

---

## 1. Context

### What the review asks (4 comments)

- **Two masters only.** Keep exactly `RAINMAKER-PGR.ComplaintHierarchyDefinition` (`hierarchyType`, `levels[]`, unchanged) and a single adjacency-list master `RAINMAKER-PGR.ComplaintHierarchy` (rename of `ClassificationNode`) that holds **all** nodes including leaf complaint types. Drop the extra masters (`HierarchySchema`, `ComplaintTypeDepartments`) — fewer masters for partners.
- **Remove `ServiceDefs` as a master entirely.** Its leaf records fold into `ComplaintHierarchy` as rows at the `isLeafServiceCode` level, carrying `department`, `slaHours`, `keywords`. The leaf row's `code` **is** the value stored as `serviceCode` on a complaint.
- **`menuPath` must not live in masters.** It is a UI-only construct; the leaf→parent link is now the explicit `parentCode` field.
- **pgr-services must validate against `ComplaintHierarchy` leaf rows**, not `ServiceDefs`.

### Headline shift

The current branch ships **Approach C as an additive, opt-in, reversible** model: `ServiceDefs` survives as the leaf master, `ClassificationNode` holds only non-leaf levels, leaves link to parents via `parentCode ?? sector ?? menuPath`, and the backend is untouched. The target **inverts** this into a **breaking, mandatory** model:

- 5 PGR masters → **2** (`ComplaintHierarchyDefinition` + `ComplaintHierarchy`). *(Confirmed: `application.properties` L54/L55 register `ServiceDefs, ComplaintHierarchyDefinition, ClassificationNode, HierarchySchema, ComplaintTypeDepartments`.)*
- `ServiceDefs` **deleted**; leaves **folded** into `ComplaintHierarchy`.
- `HierarchySchema` + `ComplaintTypeDepartments` **deleted**.
- `menuPath`/`menuPathName` **removed** from masters (UI-only).
- pgr-services **validates against `ComplaintHierarchy` leaf rows** — so this is no longer backend-untouched and no longer reversible by simply deleting nodes.

---

## 2. New Data Model — Before vs After

### Before (current branch — opt-in, 5 masters)

| Master | Role |
|---|---|
| `ComplaintHierarchyDefinition` | `hierarchyType` + `levels[]` (`isLeafServiceCode` flags last level) |
| `ClassificationNode` | adjacency list, **non-leaf nodes only** (`hierarchyType, levelCode, code, parentCode, name, order, active, path`); x-unique `[hierarchyType, code]` |
| `ServiceDefs` | **leaf master** (`serviceCode, name, keywords, department, slaHours, active` + UI `menuPath/menuPathName` + opt-in `hierarchyType/authorityType/category/sector/path/parentCode`) |
| `HierarchySchema` | per-module visible-level window |
| `ComplaintTypeDepartments` | `serviceCode → departments[]` (multi-dept) |

`serviceCode` on a complaint = `ServiceDefs.serviceCode`. pgr-services validates against `ServiceDefs`. Leaf→parent link = `parentCode ?? sector ?? menuPath`.

### After (target — 2 masters)

| Master | Role |
|---|---|
| `ComplaintHierarchyDefinition` | **UNCHANGED.** `hierarchyType` + `levels[]`; x-unique `[hierarchyType]` |
| `ComplaintHierarchy` | **ALL nodes incl. leaves.** Interior + leaf in one adjacency list. x-unique `[hierarchyType, code]` |

`ComplaintHierarchy` row shape:

```
required:  hierarchyType, levelCode, code, name
common:    parentCode (string|null), order (number), active (boolean), path (string)
leaf-only: department (string), slaHours (number), keywords (string)   # only on isLeafServiceCode rows
removed:   menuPath, menuPathName, authorityType, category, sector     # UI-only / superseded by path
```

`serviceCode` on a complaint = the **leaf row's `code`** at the `isLeafServiceCode` level. pgr-services validates against `ComplaintHierarchy` **leaf rows only**.

### Diagram

```
ComplaintHierarchyDefinition (hierarchyType=PGR-DEFAULT)
  levels: [ {CATEGORY, order:1, isLeafServiceCode:false},
            {SUB_TYPE, order:2, isLeafServiceCode:true } ]

ComplaintHierarchy (one adjacency list, x-unique [hierarchyType, code])
  Garbage            levelCode=CATEGORY  parentCode=null      (interior)
   └─ BurningOfGarbage  levelCode=SUB_TYPE  parentCode=Garbage   (LEAF)
        department=SWM  slaHours=72  keywords="burning,garbage"
        ▲ code === complaint.serviceCode  ← pgr-services validates THIS
  StreetLights       levelCode=CATEGORY  parentCode=null      (interior)
   └─ StreetLightNotWorking levelCode=SUB_TYPE parentCode=StreetLights (LEAF) …
```

Key invariant for data safety: **leaf `code` is preserved verbatim from the old `ServiceDefs.serviceCode`** so every already-filed complaint (`eg_pgr_service_v2.servicecode`) still resolves.

---

## 3. Change Plan by Subsystem

### 3.1 MDMS schemas (default-data-handler)

| File | Change |
|---|---|
| `utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json` | Rename `ClassificationNode` → `ComplaintHierarchy`; add optional leaf fields `department`/`slaHours`/`keywords`; keep `required [hierarchyType, levelCode, code, name]`, x-unique `[hierarchyType, code]`, `x-ref-schema []`. **Delete** `ServiceDefs`, `HierarchySchema`, `ComplaintTypeDepartments`. Rewrite the "leaves are NOT stored here" description; fix the `ComplaintHierarchyDefinition` `levels[]` text that references "ServiceDefs serviceCodes". Keep `ComplaintHierarchyDefinition`, `UIConstants`, `EscalationConfig`. |
| `utilities/default-data-handler/src/main/resources/application.properties` | **L54** `default.mdms.schema.create.list` & **L55** `mdms.schemacode.map` (PGR key): drop `RAINMAKER-PGR.ServiceDefs`/`RAINMAKER-PGR.HierarchySchema`/`RAINMAKER-PGR.ComplaintTypeDepartments`, rename `RAINMAKER-PGR.ClassificationNode`→`RAINMAKER-PGR.ComplaintHierarchy`. Net PGR masters: `ComplaintHierarchyDefinition` + `ComplaintHierarchy`. |
| `devops/deploy-as-code/charts/urban/default-data-handler/values.yaml` | `default-mdms-schemacode-list` & `mdms-schemacode-map`: same edits; bump `image.tag`. |
| `utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.ServiceDefs.json` | Replace with `RAINMAKER-PGR.ComplaintHierarchy.json`: 1 Definition seed, interior CATEGORY rows (`parentCode=null`), leaf rows (`code`=existing serviceCode, `levelCode=SUB_TYPE`, `parentCode`, `department/slaHours/keywords`). Drop `menuPath`. Add a `ComplaintHierarchyDefinition` dev seed if none ships. |

**x-ref-schema `[]`→`{}` quirk** (per memory): `/schema/v1/_create` can persist `x-ref-schema` as `{}` → HTTP 400 `ClassCastException` on first data `_create`; schema `_update` is 501. Fix in-place via `jsonb_set('{x-ref-schema}','[]')` and verify with `jsonb_typeof` after create.

**`additionalProperties:false` caution:** the merged schema must permit leaf-only `department`/`slaHours`/`keywords` while interior rows omit them, or mixed-shape rows get rejected on create.

### 3.2 Backend (pgr-services)

| File | Change |
|---|---|
| `.../util/PGRConstants.java` | L25 `MDMS_SERVICEDEF` → `"ComplaintHierarchy"`; repoint `MDMS_SERVICEDEF_SEARCH` (L33), `MDMS_DEPARTMENT_SEARCH` (L35), `MDMS_SERVICENAME_SEARCH` (L39), `MDMS_DATA_JSONPATH` (L144) to `$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy[...]`; change `MDMS_DATA_SERVICE_CODE_KEYWORD` (L146) `serviceCode`→`code`; `MDMS_DATA_SLA_KEYWORD` (L148) `slaHours` stays. Add a **leaf-level predicate** to each search so non-leaf codes can't validate. |
| `.../util/MDMSUtils.java` | `getPGRModuleRequest()` fetch master `ComplaintHierarchy` (keep `active==true`, **add leaf-level filter**). `fetchServiceCodeToSlaMillis()` map leaf `code→slaHours`, skip rows without `slaHours`. |
| `.../validator/ServiceRequestValidator.java` | `validateMDMS()` + `validateDepartment()` resolve serviceCode against `ComplaintHierarchy` leaf rows (match `@.code` at leaf level, `@.active==true`); read `department` off the leaf row. `INVALID_SERVICECODE` semantics preserved. |
| `.../service/PGRService.java` | `getDepartmentFromMDMS()` / `getServiceNameFromMDMS()` read department/name from `ComplaintHierarchy` leaf row. |
| `.../service/NotificationService.java` | `getDepartment()` / `getHRMSEmployee()` repoint to `ComplaintHierarchy` leaf rows. |
| `.../repository/rowmapper/DashboardQueryBuilder.java` | **L148** CTE `schemacode = 'RAINMAKER-PGR.ServiceDefs'` → `'RAINMAKER-PGR.ComplaintHierarchy'` + leaf-row predicate (`data->>'department' IS NOT NULL` or leaf `levelCode`). |
| `.../repository/rowmapper/PGRQueryBuilder.java` | **CORRECTION vs draft:** this IS affected. **L201** comment ("budget sourced from MDMS RAINMAKER-PGR.ServiceDefs") must be updated; `addOrderByClause`/`getCountQuery` consume the `serviceCodeToSla` map (L161, L209-214) which is now sourced from `ComplaintHierarchy`. No JSONPath, but verify the SLA-order branch still works against the repointed map. |
| `.../util/MigrationUtils.java` | **CORRECTION vs draft:** `getServiceCodeToSLAMap()` (L112) is **live** — called by `MigrationService.java:87`. Repoint to `ComplaintHierarchy` leaf rows (not "if still wired"). |
| `.../main/resources/db/migration/main/V20260608000000__create_v2_grain_mvs.sql` | **MISSED BY DRAFT.** The `mdms` CTE (L141-149) does `WHERE schemacode = 'RAINMAKER-PGR.ServiceDefs'` and `NULLIF(data->>'menuPath','') AS service_group`, joined into the analytics MV (L227). A Flyway migration **cannot be edited in place once applied** — add a **new forward migration** (e.g. `V2026…__repoint_grain_mvs_to_complainthierarchy.sql`) that `DROP`s and recreates the MV reading `RAINMAKER-PGR.ComplaintHierarchy` leaf rows, and replaces `service_group` (derive from parent node `name`/`path` rather than the deleted `menuPath`, or drop the column). Confirm no downstream report depends on `service_group`. |
| `.../test/.../ServiceRequestValidatorTest.java`, `ComplaintsEventsTest.java` | Rebuild MDMS stubs from `ServiceDefs` list to `ComplaintHierarchy` leaf-row list keyed by `code` (+`levelCode`/`department`). `INVALID_SERVICECODE` assertions must still hold. |

**No change** to `eg_pgr_service_v2.servicecode` column or `PGRRowMapper`. `EscalationConfig` is a separate master (unchanged), but its `overrides`/SLA keys must still equal the migrated leaf codes.

### 3.3 DIGIT-UI esbuild (citizen + employee — the live route)

| File | Change |
|---|---|
| `digit-ui-esbuild/packages/libraries/src/services/elements/MDMS.js` | `getModuleServiceDefsCriteria`/`getServiceDefs`/`GetServiceDefs`: query `ComplaintHierarchy`, return **leaf rows only** (`levelCode === isLeafServiceCode level`). Keep field names so downstream readers keep working (lowest blast radius). |
| `digit-ui-esbuild/packages/libraries/src/services/molecules/ServiceDefinitions.js` | Same repoint (ServiceDefs reference confirmed). |
| `.../libraries/src/hooks/pgr/useServiceDefs.js` + `products/pgr/src/hooks/pgr/useServiceDefs.js` | Source leaves from `ComplaintHierarchy`; replace `menuPathName` (no source) with parent node name via `parentCode`. **Note:** caches `'serviceDefs'` in SessionStorage at `cacheTime: Infinity` → must clear on deploy. |
| `.../libraries/src/hooks/pgr/useComplaintDetails.js` | `fetchComplaintDetails`: look up leaf in `ComplaintHierarchy`, walk `parentCode` for the type label (no `menuPath`). |
| `.../libraries/src/hooks/pgr/useEmployeeFilter.js` + `libraries/src/hooks/index.js` + `products/pgr/src/hooks/index.js` | Repoint `getServiceDefs` to `ComplaintHierarchy` leaves; update barrel exports if signatures change. |
| `products/pgr/src/pages/citizen/Create/CreatePGRFlowV2.tsx` | Hierarchy picker leaf options keyed on `parentCode` only; drop separate `ServiceDefs` `useCustomMDMS`; use `n.code` as option value (= serviceCode). **Flat fallback (`Step0Type`, `getEffectiveServiceCode`, sub-type gating) is menuPath-based → rework or retire** (see §5 flat policy). |
| `products/pgr/src/pages/citizen/Create/FormExplorer.js` + `Create/steps-config/CreateComplients.js` | Legacy/menuPath-based flow. Migrate or delete (no longer the live route). |
| `products/pgr/src/components/ComplaintHierarchyComponent.js` | Drop separate `ServiceDefs` `useCustomMDMS`; read leaf options from `ComplaintHierarchy` (`levelCode===leaf`, `parentCode===parent`); remove `sector`/`menuPath` link. |
| `products/pgr/src/utils/complaintHierarchyPath.js` *(recently added — see §3.5)* | `resolveComplaintPath`: drop `serviceDefs` param; find leaf where `node.code===serviceCode` at leaf level; walk one `byCode` map up via `parentCode`. |
| `products/pgr/src/utils/index.js` | Drop menuPath helpers / re-export updated path util. |
| `products/pgr/src/pages/citizen/ComplaintDetails.js` | Drop `ServiceDefs` fetch; feed only `ComplaintHierarchy` nodes to `buildComplaintPath`; rework flat-row fallback. |
| `products/pgr/src/pages/employee/PGRDetails.js` | Drop `ServiceDefs` fetch; re-source `getServiceCategoryByCode`/department from leaf row + parent. |
| `products/pgr/src/pages/employee/CreateComplaint/createComplaintForm.js` + `CreateComplaint/index.js` | `getUniqueMenuPaths`/`getSubTypesByDepartment`/department gating are menuPath-keyed → rework or retire flat branch; keep `hasHierarchy` swap. |
| `products/pgr/src/pages/employee/PGRInbox.js` | serviceCode filter dropdown options from `ComplaintHierarchy` leaf rows. |
| `products/pgr/src/hooks/pgr/usePGRInboxSearch.js` | `slaHours` now on leaf row — no logic change if field names preserved by new `getServiceDefs`. |
| `products/pgr/src/pages/citizen/ComplaintsList.js` | `menuPathByCode` card titles → derive from leaf's parent node name. |
| `products/pgr/src/configs/UICustomizations.js` | Inbox Complaint-Type column → parent node name (drop menuPath). |
| `products/pgr/src/configs/CreateComplaintConfig.js` | Flat Type `optionsKey 'menuPathName'` — only if flat fallback retained. `getDetailsRow` `CS_ADDCOMPLAINT_COMPLAINT_TYPE` from menuPath → from leaf parent. |

**Localization:** intermediate labels move from `SERVICEDEFS.<MENUPATH>` to `node.name` / `<HIERARCHYTYPE>_<LEVELCODE>` keys. The duplicated link/resolve sites + the two `useServiceDefs` copies **must change together** to avoid an inconsistent UI.

### 3.4 Other frontends — confirmed in scope (decide: same PR vs fast-follow)

| Tree | Files (verified) | Risk if skipped |
|---|---|---|
| **`digit-ui-v2`** *(MISSED BY DRAFT — separate Vite SPA, nightly-built/deployed)* | `src/hooks/useServiceDefs.ts` (fetches `ServiceDefs`, splits `menuPath` into a tree), `src/pages/CitizenComplaintCreatePage.tsx`, `CitizenComplaintsListPage.tsx`, `CitizenComplaintShowPage.tsx`, `src/api/types.ts` (`menuPath?`), `src/api/config.ts`, `packages/data-provider/src/client/types.ts`, `packages/data-provider/src/providers/resourceRegistry.ts` | Citizen complaint create/list **breaks** the same way esbuild does. Must migrate or feature-flag off. |
| **`frontend/micro-ui/web`** | `packages/modules/pgr/src/hooks/pgr/useServiceDefs.js`, `inbox/Filter.js`, `Create/FormExplorer.js`, `CreateComplaint/createComplaintForm.js`, `CreateComplaint/index.js`, `PGRDetails.js`, `PGRInbox.js`, `utils/index.js`, `hooks/index.js`, `CHANGELOG.md` | Legacy MFE on 3-master assumption; outage if still routed. |
| **`packages/modules/pgr`** (esbuild) | `inbox/Filter.js`, `pages/employee/new-inbox.js`, `README.md` | Same pattern. |

### 3.5 Recently-added tooling (this branch — confirmed present)

| File | Change |
|---|---|
| `configurator/src/api/services/hierarchyMigration.ts` | Rename `NODE_SCHEMA`→`'RAINMAKER-PGR.ComplaintHierarchy'`; keep `SERVICEDEF_SCHEMA` as **read-only source**. Add leaf-row creation (`code`=serviceCode, `parentCode`, `name`, `order`, `active`, `path`, + `department/slaHours/keywords`). Extend `MIGRATION_STEPS` and the verify step to count leaf rows. Rewrite the additive/reversible header comment. |
| `configurator/src/resources/complaint-hierarchies/MigrateHierarchyAction.tsx` | Rewrite `DialogDescription` and result/rollback banner to breaking/mandatory/one-way; drop "additive & reversible / complaint types not modified" copy. |
| `configurator/src/resources/complaint-hierarchies/ComplaintHierarchyList.tsx` | Touched by the migrate-button commit — re-verify the action wiring still mounts. |
| `digit-ui-esbuild/products/pgr/src/utils/complaintHierarchyPath.js` | Read leaf from `ComplaintHierarchy` (`node.code===serviceCode` at leaf level); replace `serviceDefs.find` and `parentCode ?? sector ?? menuPath`; fix isLeafServiceCode branch; drop `serviceDefs` param. |
| `digit-ui-esbuild/products/pgr/src/pages/employee/PGRDetails.js`, `citizen/ComplaintDetails.js` | (details-breakdown work) Point hier select at `ComplaintHierarchy`; drop `serviceDefs` arg/hook; rework flat-fallback label helpers. |
| `docs/migration/complaint-type-2level-to-Nlevel.md` | Full rewrite (see §4). |
| `docs/migration/preflight-dryrun.cjs` | Check for `RAINMAKER-PGR.ComplaintHierarchy`; plan text → "1 definition + N category + M leaf rows; ServiceDefs master REMOVED"; assert global `(hierarchyType,code)` uniqueness, leaf `department/slaHours/keywords` carried, codes preserved verbatim; add a "pgr-services validates against ComplaintHierarchy" assertion and a "V2 grain MV repointed" check. |
| `docs/complaint-hierarchy-feature.md` | §3 table → 2 masters; fix §2 mermaid + "non-leaf only" note; §4 "Backend none"→pgr-services + V2 MV changed; replace §5 opt-in/no-break narrative with breaking-change narrative. Update the auto-memory note (`complaint-hierarchy-feature.md`) afterward. |
| `docs/design/complaint-hierarchy-design.md` | Collapse §2 "Five masters"→2; invert §2.2 ("leaf is ServiceDefs"→"leaves in ComplaintHierarchy"); delete §2.3 HierarchySchema & §2.5 ComplaintTypeDepartments; rewrite §2.4 to "ServiceDefs removed"; re-examine §3 invariants + §4 phase plan (now breaking, not additive/flagged); drop menuPath "back-compat linchpin". |

### 3.6 Configurator (React-Admin + data-provider)

| File | Change |
|---|---|
| `packages/data-provider/src/providers/resourceRegistry.ts` | Delete `complaint-types` (ServiceDefs) and `classification-nodes`. Add single `complaint-hierarchy`: `schema='RAINMAKER-PGR.ComplaintHierarchy'`, `idField='code'`, `nameField='name'`. Keep `complaint-hierarchies` (Definition). |
| `packages/data-provider/src/client/types.ts` | Replace `MDMS_SCHEMAS.PGR_SERVICE_DEFS` with `COMPLAINT_HIERARCHY='RAINMAKER-PGR.ComplaintHierarchy'`. |
| `src/api/config.ts` | Drop ServiceDefs schema constant. |
| `src/api/services/mdms.ts` | Rewrite `getComplaintTypes`/`createComplaintType` to read/write leaf rows (filter leaf `levelCode`); remove `menuPath` default `'Complaint'`. |
| `src/api/types.ts` | `ComplaintType`: drop `menuPath`, add `levelCode/parentCode/path`. |
| `src/api/services/localization.ts` | Drop menuPath-parent key emission; keep `SERVICEDEFS.<code>` + dept-qualified keys off the leaf code. |
| `src/components/ComplaintHierarchySetup.tsx` | `writeToTenant()`: collapse 3-schema write into 2; remove `SERVICEDEF_SCHEMA` loop; write leaves as `ComplaintHierarchy` rows. Drop `menuPath`; verify-table "Sector" column → `parentCode`/`path`. |
| `src/utils/excelParser.ts` | Merge `classificationNodes[]`+`serviceDefs[]` into ONE node array; leaf rows = nodes at leaf `levelCode` + leaf fields. Drop `menuPath` from `HierarchyServiceDefRow`; rename `ClassificationNodeRow`→`ComplaintHierarchyRow`. Same for legacy `parseComplaintTypeExcel`. Route **every** row (interior + leaf) into the one master. |
| `src/utils/templateBuilder.ts` | Already menuPath-free; verify leaf attr columns (`Department Name*`/`Resolution Time (Hours)*`/`Search Words*`) map to new leaf fields. |
| `src/resources/complaint-types/{Create,List,Show,Edit}.tsx` | Delete or re-target to `ComplaintHierarchy` leaf rows; remove `menuPath` field/column. |
| `src/App.tsx`, `src/admin/DigitLayout.tsx`, `src/admin/DigitDashboard.tsx` | Replace `complaint-types` Resource/nav/icon with merged `complaint-hierarchy`; drop `classification-nodes` nav; keep `complaint-hierarchies`. |
| `src/resources/complaints/{ComplaintCreate,ComplaintEdit,ComplaintList,ComplaintShow}.tsx` | serviceCode `reference='complaint-types'` → merged leaf resource. |
| `src/hooks/useWeeklyReport.ts` | References ServiceDefs — repoint. |
| `packages/data-provider/src/providers/resourceRegistry.test.ts`, `dataProvider.integration.test.ts` | Update dedicated-resource list + getList/getOne assertions to merged resource/schema. |

### 3.7 MCP server + onboarding skills *(MISSED BY DRAFT)*

| File | Change |
|---|---|
| `digit-mcp/src/tools/pgr-workflow.ts`, `src/tools/mdms-tenant.ts` | Repoint ServiceDefs reads/writes to `ComplaintHierarchy` leaf rows. |
| `digit-mcp/src/utils/xlsx-loader.ts`, `src/utils/xlsx-reader.ts` | Route parsed rows into one master; drop `menuPath`. |
| `digit-mcp/src/api/pgr-dashboard.ts`, `src/data/openapi-spec.ts`, `test-openapi-spec.ts` | Update schema name + spec. |
| `digit-mcp/packages/data-provider/src/{client/types.ts,providers/resourceRegistry.ts}` | Mirror configurator changes. |
| `digit-mcp/skills/digit-tenant-setup/SKILL.md` + `error-reference.md`, `.claude/skills/digit-xlsx-onboard/SKILL.md` | Update master names / validation guidance (the `validate_complaint_types` tool doc too). |

### 3.8 Onboarding loaders / Excel / DB seed

| File | Change |
|---|---|
| `local-setup/jupyter/dataloader/unified_loader.py` (`read_complaint_types` 378-467), `crs_loader.py` (`load` ~1176), `test_crs_loader_e2e.py` | Create `ComplaintHierarchy` leaf rows (`code`=serviceCode, `parentCode`=group) + group nodes; drop `menuPath`. |
| `utilities/crs_dataloader/{crs_loader.py,unified_loader.py,unified_loader_v1.py,dataloader_ui.py,test_crs_loader_e2e.py}` *(MISSED BY DRAFT — second loader tree)* | Same changes; this is a separate copy of the loader. |
| `local-setup/scripts/{ci-dataloader.py,ci-dataloader-crossroot.py,ci-dataloader-xlsx.py}` | Verify CI loaders still pass against the new master. |
| `local-setup/db/full-dump.sql` *(MISSED BY DRAFT)* | Contains seeded ServiceDefs/menuPath rows. Regenerate the dump from a migrated tenant, or any reseed-from-dump path reintroduces the dead master. |
| Onboarding Excel templates / `docs/onboarding-samples/2_Complaint_Hierarchy.xlsx` (+ `/home/user/Downloads/CCRS-Onboarding-Excels` copies) | **No column changes** — both the legacy 2-col ComplaintType sheet and the N-col ComplaintHierarchy sheet still drive it; only parser routing changes. Verify columns still map; regenerate if needed. |

### 3.9 Indexer / persister / chatbot / perf / tests (confirmed — assign owners)

| File | Change |
|---|---|
| `configs/egov-indexer/pgr-services.yml`, `configs/egov-indexer/pgr-migration-batch-indexer.yml` + `local-setup/configs/egov-indexer/{pgr-services.yml,pgr-migration-batch-indexer.yml}` | MDMS enrichment reads `RAINMAKER-PGR.ServiceDefs`/`menuPath` → repoint to `ComplaintHierarchy` leaf + parent. |
| `backend/xstate-chatbot/nodejs/src/machine/service/egov-pgr.js` | Chatbot complaint-type fetch reads ServiceDefs/menuPath → repoint. |
| `performance/k6/scenarios/pgr-lifecycle.js` | Perf scenario seeds/reads ServiceDefs → update. |
| `tests/integration-tests/tests/admin/{complaint-types.spec.ts,complaints.spec.ts,configurator-mdms-fixes-2026-04-29.spec.ts,recently-shipped-fixes.spec.ts}`, `tests/onboarding/phase3-validation.spec.ts` *(MISSED BY DRAFT)* | Update to merged resource/schema; will fail post-cutover. |
| `local-setup/tests/e2e/common/mdms-servicedef.ts`, `local-setup/tests/e2e/specs/citizen/{complaint-type-localization.spec.ts,citizen-pgr-complaint-api.spec.ts}`, `local-setup/tests/smoke/{pgr-tenant.test.ts,pgr-workflow.test.ts}`, `local-setup/tests/test_onboarding_regressions.py` | Same. |

---

## 4. Migration & Upgrade

### 4.1 Masters migration script (`ServiceDefs` + `ClassificationNode` → `ComplaintHierarchy`)

Headless, **idempotent** (on `(hierarchyType, code)`), run **per tenant, at every tenant level where the old masters live (city tenant AND state root)** — pgr-services reads at the state-level tenant (`MultiStateInstanceUtil.getStateLevelTenant`), so `ComplaintHierarchy` must be populated there, not only at city level. Steps:

1. **Snapshot** `ServiceDefs` + `ClassificationNode` (+ `HierarchySchema`/`ComplaintTypeDepartments`) for rollback.
2. Ensure `ComplaintHierarchy` **schema** is registered (apply the `x-ref-schema []` jsonb fix; verify `jsonb_typeof`).
3. For each `ClassificationNode` (interior): copy 1:1 → `ComplaintHierarchy` row.
4. For each `ServiceDef` (leaf): create a `ComplaintHierarchy` **leaf row** with:
   - `code = ServiceDefs.serviceCode` **verbatim** (do NOT re-derive via `toPascal` — drift would orphan historical complaints, `EscalationConfig.overrides`, and localization keys).
   - `levelCode` = the `isLeafServiceCode` level.
   - `parentCode = ServiceDefs.parentCode ?? sector ?? menuPath` (the interior node code) — this is the **last legitimate read of `menuPath`**, at migration time only.
   - `name`, `department`, `slaHours`, `keywords` copied from the ServiceDef; `path` derived from the parent chain; `active`, `order` carried.
5. **Pre-flight uniqueness assertion:** verify no `(hierarchyType, code)` collision across the merged interior+leaf keyspace (a leaf serviceCode equal to an interior node code, or two derived-name leaves under different sectors, would silently drop a row on x-unique).
6. Verify counts: 1 Definition + N interior + M leaf; assert every old `ServiceDefs.serviceCode` exists as a leaf `code`; assert `EscalationConfig.overrides` keys still match leaf codes.
7. Only after backend cutover + verification: retire (`active=false`/delete) `ServiceDefs`/`HierarchySchema`/`ComplaintTypeDepartments` records.

**`ComplaintTypeDepartments` (multi-department):** collapses to a single `leaf.department` — a data-model **regression** for multi-dept routing. Flag with product; confirm no consumer relies on `departments[]` before deletion (see §8 Q1).

### 4.2 Per-tenant data migration

- Existing complaint rows (`eg_pgr_service_v2.servicecode`) are **not rewritten**; correctness depends entirely on leaf `code` = old serviceCode.
- **V2 grain MVs** must be refreshed/recreated after migration (the new forward Flyway migration in §3.2) since they materialize MDMS state.
- Re-runnable: demo tenants (`ke.bomet`/`ke.ige`) get recreated on redeploy (per memory) → idempotent + re-applied after any redeploy that wipes custom tenants.
- pgr-services `serviceCodeToSlaCache` is process-lifetime → **restart pgr-services** after migration to reload the SLA map.
- Frontend `useServiceDefs` SessionStorage cache (`cacheTime: Infinity`) → clear on deploy.

### 4.3 Upgrade doc (ordered runbook) — `docs/migration/complaint-type-2level-to-Nlevel.md`

Full rewrite; supersede the embedded §5 script with the masters-migration script:

1. Take MDMS snapshot (mandatory).
2. Register `ComplaintHierarchy` schema (apply jsonb `[]` fix; verify `jsonb_typeof`).
3. Run masters migration for **all** tenants at city + state level; verify uniqueness + verbatim code preservation.
4. Deploy pgr-services build validating against `ComplaintHierarchy` + the **new V2-MV forward migration**; restart to reload SLA cache.
5. Deploy configurator + digit-ui (esbuild) + digit-ui-v2 bundles (drop `ServiceDefs`); clear frontend caches. Update indexer/chatbot/MCP configs.
6. **Only then** delete `ServiceDefs`/`HierarchySchema`/`ComplaintTypeDepartments` masters.
7. **Rollback** = redeploy old pgr-services jar/images **and** restore `ServiceDefs`/`ClassificationNode` masters from snapshot **and** revert the V2-MV migration. Not "delete Definition+Nodes" — the leaves were moved, so rollback requires the snapshot.

---

## 5. Backward-Compatibility & Rollout

**This is a BREAKING data-model change** — unlike the current opt-in design that kept `ServiceDefs` and left pgr-services untouched.

- **No fallback safety net. (BREAKING — explicitly confirmed.)** Today the UI degrades to flat when no hierarchy exists, and pgr-services validates against `ServiceDefs`. After cutover, an un-migrated tenant has **neither** master populated → complaint create renders "No complaint hierarchy configured" (`CS_NO_COMPLAINT_HIERARCHY`) and pgr-services throws `INVALID_SERVICECODE` on **every** create/update — a **hard outage**. There is **no flat fallback** for un-migrated tenants once pgr-services reads `ComplaintHierarchy`. Every tenant MUST be migrated before backend cutover.
- **Ordering hazard.** If `ServiceDefs` is deleted or pgr-services repointed **before** data is migrated at the **state-level** tenant, `validateMDMS`/`validateDepartment`/SLA fetch all break. The V2-MV migration must not run before `ComplaintHierarchy` is populated or the MV builds empty.
- **Lockstep release.** Masters migration (all tenants, city+state) → pgr-services cutover + restart + V2-MV migration → all frontend bundles (esbuild, v2, micro-ui) + indexer/chatbot/MCP configs → only then delete old masters. The data migration and backend deploy are **not independently reversible**.
- **In-flight complaints.** `serviceCode` preserved on the complaint row; correctness hinges on verbatim leaf `code` = old serviceCode. No complaint data rewritten.
- **Flat-mode policy (decision required).** No zero-config flat fallback survives — `menuPath` removed. A flat experience is only possible as a **degenerate 2-level `ComplaintHierarchy`** (one CATEGORY level + leaf level). Every flat tenant must be migrated to at least a 2-level hierarchy.
- **Cross-frontend / cross-service fallout (verified).** `digit-ui-v2`, `frontend/micro-ui/web/.../modules/pgr`, `packages/modules/pgr`, `configs/egov-indexer/{pgr-services,pgr-migration-batch-indexer}.yml` (+ local-setup copies), `xstate-chatbot/egov-pgr.js`, `performance/k6/scenarios/pgr-lifecycle.js`, the `digit-mcp` server + skills, `utilities/crs_dataloader/*`, and `local-setup/db/full-dump.sql` all read `RAINMAKER-PGR.ServiceDefs`/`menuPath` and break — coordinate owners or feature-gate.
- **Cache staleness.** `useServiceDefs` caches `'serviceDefs'` in SessionStorage (`cacheTime: Infinity`); clear on deploy or stale data masks the migration.

---

## 6. Impact on Our Recent PR Work (commit `46388e51`)

### Must be reworked

| What we built | Status |
|---|---|
| **One-click migrate button** (`hierarchyMigration.ts` + `MigrateHierarchyAction.tsx` + `ComplaintHierarchyList.tsx`) | Direction inverted. It was additive (reads ServiceDefs, keeps them, creates only category nodes via `code=menuPath`, no leaf rows). Must now **write leaf rows** (code=serviceCode + department/slaHours/keywords + explicit parentCode), keep `ServiceDefs` as read-only source, and drop all "additive/reversible/not modified" copy. |
| **Details-page breakdown** (`complaintHierarchyPath.js` + `PGRDetails.js`/`ComplaintDetails.js`) | Resolver took `serviceDefs` as a separate array and linked via `parentCode ?? sector ?? menuPath`. Must read leaf from the single `ComplaintHierarchy` adjacency list, drop the `serviceDefs` param, and walk one `byCode` map. |
| **Migration docs** (`complaint-type-2level-to-Nlevel.md`, `complaint-hierarchy-feature.md`, `complaint-hierarchy-design.md`) | All assert 3–5 masters, ServiceDefs-as-leaf, backend-untouched, reversible. Full rewrites to 2-master/breaking. |
| **Dry-run** (`preflight-dryrun.cjs`) | Checks for `ClassificationNode`, predicts "ServiceDefs: 0 rewrites". Repoint to `ComplaintHierarchy`, predict leaf-row creation + ServiceDefs removal, add uniqueness + backend-validation + V2-MV checks. |

### Can be salvaged

- **Define→template→ingest scaffold** in `ComplaintHierarchySetup.tsx` and `templateBuilder.ts` (already `menuPath`-free) — only the write target collapses 3→2.
- **Excel column layout** — unchanged; only parser routing changes.
- **Adjacency-list concept + `parentCode`/`path`/`order`/`levelCode` fields** on `ClassificationNode` — carried straight into `ComplaintHierarchy`.
- **`ComplaintHierarchyDefinition`** master — unchanged.
- **Dual-tenant write (city+state)** logic in `writeToTenant()` — reused by the migration (and is exactly what §4.1's state+city requirement needs).
- **The migration's category-node creation + verify-step UI** — extended, not discarded.

The key reframe: we built the **additive on-ramp**; the target needs the **breaking consolidation**. Most plumbing is reusable; the philosophy (reversible, ServiceDefs-preserved, menuPath-linked) is what gets inverted.

---

## 7. Phased Execution (effort + ordering)

| Phase | Work | Effort | Depends on |
|---|---|---|---|
| **P0** | Schema: rename `ClassificationNode`→`ComplaintHierarchy` + leaf fields; delete ServiceDefs/HierarchySchema/ComplaintTypeDepartments; update registration lists (properties + helm); dev seed; apply `x-ref-schema` jsonb fix | **M** | — |
| **P1** | Masters migration script + preflight dry-run rewrite (idempotent, uniqueness + verbatim-code asserts, state+city) | **M** | P0 |
| **P2** | Backend pgr-services repoint (PGRConstants, MDMSUtils, ServiceRequestValidator, PGRService, NotificationService, DashboardQueryBuilder, **PGRQueryBuilder comment/SLA**, **MigrationUtils**) + **new V2-grain-MV forward Flyway migration** + 2 test fixtures + leaf-level filtering | **L** | P0 |
| **P3** | Configurator: registry/data-provider, ingest writer, parser merge, complaint-types resource delete/re-target, localization, types, weekly-report, 2 test suites; rework migrate button | **L** | P0, P1 |
| **P4** | DIGIT-UI esbuild: `getServiceDefs`→leaf rows, pickers/resolver, 2 details pages, inbox/list/customizations, dedup `useServiceDefs`, flat-fallback decision | **L** | P0; pairs with P2 for lockstep |
| **P4b** | Other frontends: **digit-ui-v2**, `frontend/micro-ui/web`, `packages/modules/pgr` (or explicit defer + feature-gate) | **L** | P0; same cutover window as P4 |
| **P5** | Onboarding: both loader trees (`local-setup/jupyter/dataloader`, `utilities/crs_dataloader`), CI loaders, **`full-dump.sql` regen**, Excel sample verification | **M** | P0 |
| **P5b** | digit-mcp server + skills + openapi-spec | **M** | P0, P3 |
| **P6** | Integrations: egov-indexer configs (+local-setup copies), xstate-chatbot, k6, integration + e2e + smoke tests | **M** | P2 |
| **P7** | Docs: feature, design, migration/upgrade runbook + rollback; update auto-memory note | **M** | all |
| **P8** | Coordinated lockstep rollout per §4.3 | **M** | P1, P2, P3, P4, P4b |

**Critical path:** P0 → P1 → (P2 ∥ P3 ∥ P4 ∥ P4b) → P8. P2/P3/P4/P4b must be released **together** with the masters migration; any partial deploy or an un-migrated tenant causes `INVALID_SERVICECODE` outages. P6/P5b can fast-follow only if those consumers are non-blocking for complaint create/validate.

---

## 8. Open Questions for the Reviewer

1. **Multi-department:** `ComplaintTypeDepartments` (`serviceCode → departments[]`) collapses to a single `leaf.department`. Drop multi-department routing, or re-express (comma-list / array field on the leaf)?
2. **Flat-mode policy:** Confirm **no** zero-config flat fallback — every tenant ships at least a degenerate 2-level `ComplaintHierarchy`. Acceptable?
3. **`HierarchySchema` removal:** Grep shows no backend reader. Confirm no UI/configurator/MCP consumer relies on the per-module visible-level window.
4. **`menuPath` as UI construct:** Reconstruct grouping purely from `parentCode`/`path` (preferred), or keep a client-side-derived `menuPathName` for label/localization continuity (`SERVICEDEFS.<MENUPATH>` keys)?
5. **Migrate button vs headless script:** Keep the reframed `MigrateHierarchyAction`, or retire it for the headless masters-migration script as single source of truth?
6. **Cross-frontend scope:** Is `digit-ui-esbuild/products/pgr` enough for this PR, or must **digit-ui-v2** (nightly-deployed), `packages/modules/pgr`, `frontend/micro-ui/web`, indexer/chatbot/k6/MCP all be in the same change set? If deferred, how are un-updated consumers feature-gated to avoid outage?
7. **Leaf-level predicate:** Identify leaf rows by the `isLeafServiceCode` level from `ComplaintHierarchyDefinition` (correct; needs a second fetch/join) or by heuristic (`department`/`slaHours` present)? Preference?
8. **Code-preservation guarantee:** Confirm migration preserves `ServiceDefs.serviceCode` **verbatim** as leaf `code` (no re-derivation) — historical complaints, `EscalationConfig.overrides`, localization keys depend on it.
9. **V2 grain MVs:** Confirm the analytics `service_group` dimension (today `menuPath`) may be re-derived from the parent node name/path, or dropped. Any BI/report consumer of `service_group`?

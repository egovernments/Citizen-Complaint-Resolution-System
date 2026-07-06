# PGR "Search Citizen Complaint" — Feature Handoff

Context-transfer doc for continuing this work in a new session/model. The code
lives in the repo; this captures the *why*, the decisions, the gotchas, and
what's still open.

Tenant under test: **`mz.ige`** (state root `mz`). Stack runs locally via
`local-setup/ansible/deploy.sh ige` (macOS / Docker, amd64 under emulation).

---

## 1. Goal

Add the ability to search PGR complaints by **department** and by **assigned
employee**, exposed through a new employee **"Search Citizen Complaint"** screen
(separate from the existing inbox at `/employee/pgr/inbox-v2`).

Both are **employee-only** search dimensions.

---

## 2. Backend (`backend/pgr-services`)

Complaint search is `POST /pgr-services/v2/request/_search` (+ `_count`). It takes
`RequestInfo` in the body and filter criteria as **query params**
(`@ModelAttribute RequestSearchCriteria`). Results are enriched with workflow +
user data by `usePGRInboxSearch` / the service layer.

### Data model note (IMPORTANT)
Complaint types live in MDMS **`RAINMAKER-PGR.ComplaintHierarchy`** (adjacency
list; leaf rows carry `code` = serviceCode, `department` = dept **code**, e.g.
`ministry_of_the_interior`; interior/category nodes have no `department`).
Earlier in the project the deployed data was on the legacy `ServiceDefs` master,
then it flipped to `ComplaintHierarchy` — the helper was repointed accordingly.
`department` values are **snake_case codes**, NOT display names ("Ministry of the
Interior" is the name from `common-masters.Department`).

### Changes
- **`web/models/RequestSearchCriteria.java`** — added `department` (`Set<String>`).
  (`assignee` (String) + `serviceRequestIds` (Set) already existed.) `isEmpty()`
  includes `assignee` and `department`.
- **`util/PGRConstants.java`** — added `MDMS_SERVICEDEF_MASTER = "ComplaintHierarchy"`,
  `MDMS_SERVICEDEFS_JSONPATH = "$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy"`,
  `MDMS_SERVICE_CODE_KEY = "code"`. (`DEPARTMENT = "department"` reused.)
- **`util/MDMSUtils.java`** — `getServiceCodesByDepartment(tenantId, departmentCodes)`
  reads ComplaintHierarchy leaves at the **request tenant** (`mz.ige`, not
  state-level), returns the serviceCodes whose `department` is in the set.
  Empty set on failure (safe no-op). Helper `getServiceDefMdmsRequest`.
- **`service/PGRService.java`** — two helpers:
  - `resolveDepartmentFilter(...)`: department → serviceCodes, folded into
    `criteria.serviceCode` (intersect if serviceCode also present); returns
    false → caller short-circuits to empty (a filter that matches nothing must
    NOT degrade to "no filter").
  - `resolveAssigneeFilter(...)`: assignee UUID → serviceRequestIds via
    `WorkflowService.getServiceRequestIdsByAssignee`, folded into
    `criteria.serviceRequestIds`.
  - Both called in **`search()` and `count()`** (parity). Note: a duplicate
    inline department block was removed during cleanup.
- **`validator/ServiceRequestValidator.java`** — `department` + `assignee` are
  employee-only (checked against allowed params); `tenantId` mandatory guard
  includes `department`.
- **`resources/application.properties`** — `employee.allowed.search.params` now
  includes `department,assignee` (citizen list unchanged).
- **OpenAPI**: `resources/OpenAPI-PGR-Requests.yaml` (`/request/_search` +
  `/request/_count`) and `swagger-contract.yml` document the `department`
  (and `assignee`) query params + the `RequestInfoWrapper` note.

### Verified working
`?tenantId=mz.ige&department=ministry_of_the_interior` returns the Interior
complaints; `?assignee=<employeeUuid>` returns complaints assigned to that user
(assign one first via `_update` action `ASSIGN`). Employee search only.

---

## 3. Frontend (`digit-ui-esbuild/products/pgr`)

The employee inbox is **config-driven**: a config object defines fields, a
`UICustomizations` `preProcess` maps form values → `_search` params, and
`InboxSearchComposer` renders it. The Search page clones this machinery.

**Critical mechanism:** for a `type:"component"` field, the RHF `Controller`
registers under **`config.key`**, and only registered fields are submitted to
`filterForm`. So a component field's `key` MUST match the form name the
component writes, or the value never reaches the API and never clears.

### Files
- **`configs/PGRComplaintSearchConfig.js`** (new) — inbox clone,
  `moduleName: "PGRComplaintSearchConfig"`, `customHookName: "pgr.usePGRInboxSearch"`.
  Filter fields (single column, matches the reference mock):
  1. Department (`PGRDepartmentComponent`, key `department`)
  2. Complaint Type (`PGRComplaintHierarchyComponent`, key **`SelectSubComplaintType`** — matches what the component writes)
  3. Assigned (`PGRAssigneeComponent`, key `assignee`, `populators.dependsOnKey: "department"`, roles)
  4. Província (`PGRBoundaryComponent`, label **`""`** so only the component's own label renders — avoids a duplicate)
  5. Status (`PGRStatusDropdownComponent`, dynamic from PGR BusinessService)
- **`configs/UICustomizations.js`** — `PGRComplaintSearchConfig.preProcess` maps:
  department→`department`, `SelectSubComplaintType.serviceCode`→`serviceCode`,
  assignee.uuid→`assignee`, locality→`locality`, status.code→`applicationStatus`.
  (Reuses inbox `additionalCustomizations`/`MobileDetailsOnClick`.)
- **`pages/employee/PGRComplaintSearch.js`** (new) — renders `InboxSearchComposer`
  with the config; wrapper classes `v2-pgr-inbox v2-scope pgr-complaint-search`.
- **`components/DepartmentComponent.js`** (new) — department dropdown, options
  derived from cached `serviceDefs` (`.department`), emits `{code}`; resets on
  Clear All (watches `formData[config.key]`).
- **`components/StatusDropdownComponent.js`** (new) — dynamic status from
  `egov-workflow-v2 businessservice/_search`, emits `{code}`; resets on Clear All.
- **`components/AssigneeComponent.js`** (modified) — added `dependsOnKey` support:
  reads the chosen department from `formData[dependsOnKey].code`, loads employees
  **only for that department** (`departments=<code>` on HRMS search, disabled +
  "Select a department first" until chosen), clears stale assignee on department
  change, resets on Clear All. Create flow unaffected (no `dependsOnKey`).
- **`components/ComplaintHierarchyComponent.js`** (modified) — resets its cascade
  `sel` when `SelectComplaintType`/`SelectSubComplaintType` clear (Clear All);
  `hideLabels` populator (unused now); root div class `pgr-hierarchy-levels`
  (for the teal "Complaint Type" heading CSS).
- **`Module.js`** — registered `PGRComplaintSearch`, `PGRDepartmentComponent`,
  `PGRStatusDropdownComponent`.
- **`pages/employee/index.js`** — route `/employee/pgr/search` + breadcrumb.

### Styling — `digit-ui-esbuild/public/vendor/overrides.css`
Scoped to `.pgr-complaint-search` (inbox untouched). Portal border-radius left
as-is. Covers: kill the empty bordered wrapper box, single-column filter,
dark field labels, teal `#0b4b66` "Complaint Type" heading + divider (via
`:has(.pgr-hierarchy-levels)`), disabled-assignee style, table density, page
title.

### Localization seed
`utilities/default-data-handler/src/main/resources/localisations/en_IN/rainmaker-pgr.json`
— added `PGR_SEARCH_COMPLAINT`, `PGR_FILTER_DEPARTMENT`, `PGR_SELECT_DEPARTMENT`,
`PGR_FILTER_ASSIGNEE`, `PGR_FILTER_PROVINCIA` (= **"Province"**), `PGR_SELECT_STATUS`,
`PGR_SELECT_DEPARTMENT_FIRST`. (Standard keys like `EVENTS_DATERANGE_LABEL`,
`ES_COMMON_APPLY`, `ES_CLEAR_ALL`, `ES_PGR_FILTER_STATUS` were already in the seed.)

### Sidebar "Search" entry (MDMS data, not code)
The employee sidebar is built from `useAccessControl()` actions. Add an action
(model on existing id 2553) + role grants at tenant `mz`:
- `POST /mdms-v2/v2/_create/ACCESSCONTROL-ACTIONS-TEST.actions-test` — action id
  9001, `navigationURL: /digit-ui/employee/pgr/search`, `path: SearchCitizenComplaint`,
  `displayName: Search`, `serviceCode: PGR`, `parentModule: rainmaker-pgr`, `url: url`.
- `POST /mdms-v2/v2/_create/ACCESSCONTROL-ROLEACTIONS.roleactions` — grant actionid
  9001 to EMPLOYEE / GRO / DGRO / PGR_LME / SUPERUSER.
The screen works via direct URL `/employee/pgr/search` even before this is seeded.

---

## 4. Build & deploy

**UI (fast iteration)** — vendored monorepo, `npm run build` (never bare
`esbuild.build.js`; `prebuild` vendors CSS). Node ≥ 20.
```bash
cd digit-ui-esbuild
npm run build
tar -C build --exclude=globalConfigs.js --exclude=silent-check-sso.html -cf - . \
  | docker exec -i digit-ui tar -C /var/web/digit-ui -xf -   # then Cmd+Shift+R
```

**pgr-services (backend)** — NOT built by the deploy by default; build a local
image and point `ige.yml` `pgr_services_image: pgr-services:local`. Must be
**amd64**:
```bash
docker build --platform linux/amd64 -t pgr-services:local \
  --build-arg WORK_DIR=backend/pgr-services -f build/maven/Dockerfile .
```

**default-data-handler (localization + MobileNumberValidation seed)** — also amd64:
```bash
docker build --platform linux/amd64 -t default-data-handler:local \
  --build-arg WORK_DIR=utilities/default-data-handler -f build/maven/Dockerfile .
```

**Full deploy:** `cd local-setup/ansible && ./deploy.sh ige`

---

## 5. Environment gotchas (hit during this work)

- **`digit_ui_mode: container`** for macOS in `ige.yml` (a `hrm` typo → nothing
  matched → broken UI mode). Valid: `static | hmr | container`; Mac = `container`.
- **amd64 vs arm64** — local images must be `--platform linux/amd64` (stack runs
  amd64 under Rosetta). A "warning: platform mismatch" on run is expected/benign;
  an *error* means the image is arm64.
- **ADMIN@pg auth after `down -v`** — the DB dump's `ADMIN` PII is encrypted with
  keys that a freshly-keyed enc-service can't read → "Invalid login credentials".
  Fix each clean slate: `EGOV_USER_HOST=http://127.0.0.1:18000 SEED_TENANTS="pg pg.citest" bash local-setup/seeds/user-seed.sh`
  (creates a working ADMIN/`eGov@123`). The deploy does NOT run user-seed.sh.
- **MobileNumberValidation** DDH seed defaulted to Kenya (`^0?[17][0-9]{8}$`);
  changed to Mozambique (`+258`, `^8[0-9]{8}$`). egov-user reads this master;
  wrong pattern → `INVALID_MOBILE_NUMBER` on the HRMS INTERNAL_USER seed.
- **MCP tenant bootstrap** (`POST :13101/v1/tenant/bootstrap`, health `/healthz`)
  needs ADMIN auth; it writes `common-masters.UserValidation` per tenant and
  evicts egov-user's Redis validation cache (`HDEL validationRules validation:<tenant>`).
- **PGR workflow BusinessService** must exist per tenant or `_create` fails with
  `BUSINESSSERVICE_NOT_FOUND`. Seeded by the MCP bootstrap, or manually via
  `POST /egov-workflow-v2/egov-wf/businessservice/_create` from
  `local-setup/jupyter/dataloader/templates/PgrWorkflowConfig.json` (`{tenantid}`→`mz.ige`).
- Clean-slate reset runs from `~/digit` (compose project `digit`):
  `COMPOSE_PROFILES='*' docker compose -f docker-compose.egov-digit.yaml -f docker-compose.fast-path.yml down --volumes --remove-orphans`.

---

## 6. Current state

- Backend department + assignee search: implemented, employee-only, `_search`
  and `_count`, verified via curl.
- UI Search page: implemented, single-column reference layout, dynamic status,
  dependent Department→Assignee, Clear All resets all filters, complaint-type
  cascade filters + clears.
- Localization + MobileNumberValidation added to the DDH seed (needs DDH rebuild
  for a fresh deploy; runtime `_upsert` for the current env).

## 7. Open items / to verify

- [ ] `useCustomAPIHook` refetch when the `departments` param changes — confirm
      the assignee list actually reloads on department change (add explicit
      query key if not).
- [ ] `:has()` (teal Complaint Type heading) — fine in current Chrome; swap to a
      non-`:has()` approach if an older target browser is required.
- [ ] Seed the **sidebar access-control action + roleactions** for `mz` so
      "Search" appears in the employee sidebar (and add to the tenant seed for
      reproducibility across `down -v`).
- [ ] `pt_MZ` localization for the new keys, if that locale is enabled.
- [ ] Fix the `Cateogry` typo in `ComplaintHierarchyDefinition` level label (data).
- [ ] Rebuild `pgr-services:local` + `default-data-handler:local` (amd64) so the
      backend feature and seeds are live on a fresh deploy.
- [ ] Smoke-test employee **create-complaint** (shares `ComplaintHierarchyComponent`
      / `AssigneeComponent`) to confirm the guarded resets don't regress it.

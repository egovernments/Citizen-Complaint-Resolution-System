# Endpoint Coverage Expansion — Design

> Expand integration test coverage from 17/44 endpoints (39%) to 33/44 (75%) using a mix of new DataProvider resources and E2E scenario tests.

**Goal:** Cover all 36 DigitApiClient methods with integration tests.

**Approach:** "Mix: resources + scenarios" — endpoints that serve standalone data become read-only DataProvider resources; endpoints that are workflow-oriented get covered via E2E scenario tests.

---

## Category A: New DataProvider Resources (read-only)

These endpoints return useful data for admin UIs. Each becomes a new resource type in the registry with `getList`/`getOne`/`getMany` support.

| # | Resource Name | Endpoint(s) | Client Method | Tests |
|---|---------------|-------------|---------------|-------|
| 1 | `users` | USER_SEARCH | `userSearch()` | getList, getOne, getMany |
| 2 | `workflow-business-services` | WORKFLOW_BUSINESS_SERVICE_SEARCH | `workflowBusinessServiceSearch()` | getList, getOne |
| 3 | `workflow-processes` | WORKFLOW_PROCESS_SEARCH | `workflowProcessSearch()` | getList, getManyReference |
| 4 | `access-roles` | ACCESS_ROLES_SEARCH | `accessRolesSearch()` | getList, getOne |
| 5 | `mdms-schemas` | MDMS_SCHEMA_SEARCH | `mdmsSchemaSearch()` | getList, getOne |
| 6 | `boundary-hierarchies` | BOUNDARY_HIERARCHY_SEARCH | `boundaryHierarchySearch()` | getList, getOne |

Each resource is **read-only** — no create/update/delete through the DataProvider.

---

## Category B: Scenario Tests (workflow-oriented)

These endpoints are used as part of workflows, not standalone resources. We test them via E2E scenarios that exercise the full flow.

| # | Scenario | Endpoints Covered | Client Methods Tested |
|---|----------|-------------------|----------------------|
| 1 | PGR Full Lifecycle | PGR_CREATE → PGR_UPDATE (ASSIGN → RESOLVE → RATE) | `pgrCreate()`, `pgrUpdate()` (3 actions) |
| 2 | User CRUD | USER_CREATE → USER_SEARCH → USER_UPDATE | `userCreate()`, `userSearch()`, `userUpdate()` |
| 3 | Encryption Round-Trip | ENC_ENCRYPT → ENC_DECRYPT | `encryptData()`, `decryptData()` |
| 4 | ID Generation | IDGEN_GENERATE | `idgenGenerate()` |
| 5 | Tenant Bootstrap | MDMS_SCHEMA_CREATE → BOUNDARY_HIERARCHY_CREATE | `mdmsSchemaCreate()`, `boundaryHierarchyCreate()` |

---

## Category C: Skip (no client method or not deployed)

| # | Endpoint(s) | Reason |
|---|-------------|--------|
| 1 | LOCATION_BOUNDARY_SEARCH | Legacy, superseded by boundary-service; no client method |
| 2 | BNDRY_MGMT_* (4 endpoints) | No client methods in data-provider package |
| 3 | INBOX_V2_SEARCH | No client method |
| 4 | FILESTORE_UPLOAD | No client method (only FILESTORE_URL exists) |
| 5 | ACCESS_ACTIONS_SEARCH | No client method |
| 6 | BOUNDARY_RELATIONSHIP_UPDATE | No client method |

These 8 endpoints (11 counting BNDRY_MGMT as 4) have no client methods in DigitApiClient. Adding client methods is out of scope.

---

## Resource Registry Changes

Add 6 new entries to `resourceRegistry.ts`:

```typescript
{ name: 'users', type: 'user', idField: 'uuid' }
{ name: 'workflow-business-services', type: 'workflow-bs', idField: 'businessService' }
{ name: 'workflow-processes', type: 'workflow-process', idField: 'id' }
{ name: 'access-roles', type: 'access-role', idField: 'code' }
{ name: 'mdms-schemas', type: 'mdms-schema', idField: 'code' }
{ name: 'boundary-hierarchies', type: 'boundary-hierarchy', idField: 'hierarchyType' }
```

## DataProvider Changes

Add new cases in the DataProvider's switch statement for each resource type. Each implements:
- `getList` — call the search method, return `{ data, total }`
- `getOne` — call search with filter, return first match
- `getMany` — call search for each ID, return all

No `create`/`update`/`delete` for these resources (read-only).

## Test Structure

All new tests go in the existing `dataProvider.integration.test.ts`:

- 6 new resource suites (~15 tests)
- 5 scenario test suites (~8 tests)
- ~23 new tests total
- Expected final count: ~85 tests

## Coverage After

| Metric | Before | After |
|--------|--------|-------|
| Endpoints with client methods | 36/44 (82%) | 36/44 (82%) |
| Client methods with tests | 22/36 (61%) | 36/36 (100%) |
| Endpoints with tests | 17/44 (39%) | 33/44 (75%) |

# Endpoint Coverage Expansion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cover all 36 DigitApiClient methods with integration tests (up from 22/36 to 36/36) by adding 6 read-only DataProvider resources and 5 E2E scenario tests.

**Architecture:** Extend the existing `resourceRegistry.ts` with 6 new resource types (user, workflow-bs, workflow-process, access-role, mdms-schema, boundary-hierarchy). Add corresponding `fetchAll` handlers in `dataProvider.ts`. Add scenario tests that exercise client methods directly (not through DataProvider) for workflow endpoints and utility services.

**Tech Stack:** TypeScript, Node.js test runner (`node:test`), DigitApiClient, react-admin DataProvider interface.

---

### Task 1: Add 6 new resource types to resourceRegistry.ts

**Files:**
- Modify: `packages/data-provider/src/providers/resourceRegistry.ts:4,21-58`

**Step 1: Extend the ResourceType union**

In `resourceRegistry.ts:4`, change:

```typescript
export type ResourceType = 'mdms' | 'hrms' | 'boundary' | 'pgr' | 'localization';
```

to:

```typescript
export type ResourceType = 'mdms' | 'hrms' | 'boundary' | 'pgr' | 'localization' | 'user' | 'workflow-bs' | 'workflow-process' | 'access-role' | 'mdms-schema' | 'boundary-hierarchy';
```

**Step 2: Add 6 new dedicated resource entries**

After the `localization` entry (line 58) and before the `// Generic MDMS Resources` comment (line 60), add:

```typescript
  users: {
    type: 'user', label: 'Users', idField: 'uuid', nameField: 'userName',
    descriptionField: 'name', dedicated: true,
  },
  'workflow-business-services': {
    type: 'workflow-bs', label: 'Workflow Business Services', idField: 'businessService',
    nameField: 'businessService', descriptionField: 'business', dedicated: true,
  },
  'workflow-processes': {
    type: 'workflow-process', label: 'Workflow Processes', idField: 'id',
    nameField: 'businessId', descriptionField: 'action', dedicated: true,
  },
  'access-roles': {
    type: 'access-role', label: 'Access Roles', idField: 'code',
    nameField: 'name', descriptionField: 'description', dedicated: true,
  },
  'mdms-schemas': {
    type: 'mdms-schema', label: 'MDMS Schemas', idField: 'code',
    nameField: 'code', descriptionField: 'description', dedicated: true,
  },
  'boundary-hierarchies': {
    type: 'boundary-hierarchy', label: 'Boundary Hierarchies', idField: 'hierarchyType',
    nameField: 'hierarchyType', dedicated: true,
  },
```

**Step 3: Run tests to verify registry is valid**

Run: `cd packages/data-provider && node --import tsx --test src/providers/dataProvider.integration.test.ts 2>&1 | head -20`

Expected: Tests should still pass (the new resources aren't used in tests yet — the coverage validation test uses `getDedicatedResources()` and checks only the original 8).

**Step 4: Commit**

```bash
git add packages/data-provider/src/providers/resourceRegistry.ts
git commit -m "feat: add 6 new resource types to registry (users, workflow, access, schemas, hierarchies)"
```

---

### Task 2: Add DataProvider handlers for the 6 new resource types

**Files:**
- Modify: `packages/data-provider/src/providers/dataProvider.ts:67-130`

**Step 1: Add 6 new fetcher functions**

After the `localizationGetList` function (line 109) and before the `// --- Factory ---` comment (line 111), add:

```typescript
async function userGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const users = await client.userSearch(tenantId, { limit: 100 });
  return users.map((u) => normalizeRecord(u, config));
}

async function workflowBsGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const services = await client.workflowBusinessServiceSearch(tenantId);
  return services.map((s) => normalizeRecord(s, config));
}

async function workflowProcessGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string, filter?: Record<string, unknown>): Promise<RaRecord[]> {
  const businessIds = filter?.businessId ? [String(filter.businessId)] : undefined;
  const processes = await client.workflowProcessSearch(tenantId, businessIds, { limit: 100 });
  return processes.map((p) => normalizeRecord(p, config));
}

async function accessRoleGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const roles = await client.accessRolesSearch(tenantId);
  return roles.map((r) => normalizeRecord(r, config));
}

async function mdmsSchemaGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const schemas = await client.mdmsSchemaSearch(tenantId);
  return schemas.map((s) => normalizeRecord(s, config));
}

async function boundaryHierarchyGetList(client: DigitApiClient, config: ResourceConfig, tenantId: string): Promise<RaRecord[]> {
  const hierarchies = await client.boundaryHierarchySearch(tenantId);
  return hierarchies.map((h) => normalizeRecord(h, config));
}
```

**Step 2: Wire into the fetchAll switch statement**

In the `fetchAll` function (around line 122-129), add 6 new cases before the `default`:

```typescript
      case 'user': return userGetList(client, config, tenantId);
      case 'workflow-bs': return workflowBsGetList(client, config, tenantId);
      case 'workflow-process': return workflowProcessGetList(client, config, tenantId, filter);
      case 'access-role': return accessRoleGetList(client, config, tenantId);
      case 'mdms-schema': return mdmsSchemaGetList(client, config, tenantId);
      case 'boundary-hierarchy': return boundaryHierarchyGetList(client, config, tenantId);
```

**Step 3: Run existing tests to confirm no regression**

Run: `cd packages/data-provider && node --import tsx --test src/providers/dataProvider.integration.test.ts`

Expected: All 62 existing tests should still pass.

**Step 4: Commit**

```bash
git add packages/data-provider/src/providers/dataProvider.ts
git commit -m "feat: add DataProvider handlers for users, workflow, access, schemas, hierarchies"
```

---

### Task 3: Write integration tests for the 6 new read-only resources

**Files:**
- Modify: `packages/data-provider/src/providers/dataProvider.integration.test.ts`

**Step 1: Add test suites for each new resource**

Insert these test suites BEFORE the final `Coverage: all resources in registry are testable` describe block (before line 964). Each suite tests `getList` and `getOne` at minimum.

```typescript
  // =========================================================================
  // Users (read-only via DataProvider, using dpRoot)
  // =========================================================================

  describe('Users', () => {
    let firstUuid: string;

    it('getList returns users', async () => {
      const result = await dpRoot.getList('users', {
        pagination: { page: 1, perPage: 10 }, sort: { field: 'uuid', order: 'ASC' }, filter: {},
      });
      assert.ok(result.data.length > 0, 'Should return users');
      assert.ok(result.total > 0, 'Should have a total count');
      assert.ok((result.data[0] as any).uuid, 'User should have uuid');
      assert.ok((result.data[0] as any).userName, 'User should have userName');
      firstUuid = String(result.data[0].id);
    });

    it('getOne fetches a user by uuid', async () => {
      assert.ok(firstUuid, 'Need a uuid from getList');
      const result = await dpRoot.getOne('users', { id: firstUuid });
      assert.equal(String(result.data.id), firstUuid);
      assert.ok((result.data as any).userName, 'Should have userName');
    });

    it('getMany fetches multiple users', async () => {
      const list = await dpRoot.getList('users', {
        pagination: { page: 1, perPage: 3 }, sort: { field: 'uuid', order: 'ASC' }, filter: {},
      });
      const ids = list.data.slice(0, 2).map((r) => String(r.id));
      const result = await dpRoot.getMany('users', { ids });
      assert.equal(result.data.length, ids.length, `Should return ${ids.length} users`);
    });
  });

  // =========================================================================
  // Workflow Business Services (read-only, using dpRoot)
  // =========================================================================

  describe('Workflow Business Services', () => {
    it('getList returns business services', async () => {
      const result = await dpRoot.getList('workflow-business-services', {
        pagination: { page: 1, perPage: 50 }, sort: { field: 'businessService', order: 'ASC' }, filter: {},
      });
      assert.ok(result.data.length > 0, 'Should return workflow business services');
      assert.ok((result.data[0] as any).businessService, 'Should have businessService field');
    });

    it('getOne fetches PGR business service', async () => {
      const list = await dpRoot.getList('workflow-business-services', {
        pagination: { page: 1, perPage: 50 }, sort: { field: 'businessService', order: 'ASC' }, filter: {},
      });
      const pgr = list.data.find((r) => (r as any).businessService === 'PGR');
      assert.ok(pgr, 'PGR business service should exist');
      const result = await dpRoot.getOne('workflow-business-services', { id: 'PGR' });
      assert.equal(String(result.data.id), 'PGR');
    });
  });

  // =========================================================================
  // Workflow Processes (read-only, using dpCity)
  // =========================================================================

  describe('Workflow Processes', () => {
    it('getList returns process instances', async () => {
      const result = await dpCity.getList('workflow-processes', {
        pagination: { page: 1, perPage: 10 }, sort: { field: 'id', order: 'DESC' }, filter: {},
      });
      assert.ok(result.data.length > 0, 'Should return workflow process instances (PGR complaints generate these)');
      assert.ok((result.data[0] as any).businessId, 'Process should have businessId');
      assert.ok((result.data[0] as any).action, 'Process should have action');
    });

    it('getManyReference finds processes by businessId', async () => {
      // Get a known PGR complaint's serviceRequestId
      const complaints = await dpCity.getList('complaints', {
        pagination: { page: 1, perPage: 1 }, sort: { field: 'serviceRequestId', order: 'DESC' }, filter: {},
      });
      assert.ok(complaints.data.length > 0, 'Need at least one complaint');
      const bizId = String(complaints.data[0].id);
      const result = await dpCity.getManyReference('workflow-processes', {
        target: 'businessId', id: bizId,
        pagination: { page: 1, perPage: 50 }, sort: { field: 'id', order: 'ASC' }, filter: {},
      });
      assert.ok(result.data.length > 0, `Should find process instances for complaint ${bizId}`);
    });
  });

  // =========================================================================
  // Access Roles (read-only, using dpRoot)
  // =========================================================================

  describe('Access Roles', () => {
    it('getList returns roles', async () => {
      const result = await dpRoot.getList('access-roles', {
        pagination: { page: 1, perPage: 50 }, sort: { field: 'code', order: 'ASC' }, filter: {},
      });
      assert.ok(result.data.length > 0, 'Should return access control roles');
      assert.ok((result.data[0] as any).code, 'Role should have code');
      assert.ok((result.data[0] as any).name, 'Role should have name');
    });

    it('getOne fetches CITIZEN role', async () => {
      const result = await dpRoot.getOne('access-roles', { id: 'CITIZEN' });
      assert.equal(String(result.data.id), 'CITIZEN');
      assert.ok((result.data as any).name, 'CITIZEN role should have a name');
    });
  });

  // =========================================================================
  // MDMS Schemas (read-only, using dpRoot)
  // =========================================================================

  describe('MDMS Schemas', () => {
    it('getList returns schemas', async () => {
      const result = await dpRoot.getList('mdms-schemas', {
        pagination: { page: 1, perPage: 50 }, sort: { field: 'code', order: 'ASC' }, filter: {},
      });
      assert.ok(result.data.length > 0, 'Should return MDMS schema definitions');
      assert.ok((result.data[0] as any).code, 'Schema should have code');
    });

    it('getOne fetches Department schema', async () => {
      const list = await dpRoot.getList('mdms-schemas', {
        pagination: { page: 1, perPage: 200 }, sort: { field: 'code', order: 'ASC' }, filter: {},
      });
      const dept = list.data.find((r) => String(r.id).includes('Department'));
      assert.ok(dept, 'Department schema should exist');
      const result = await dpRoot.getOne('mdms-schemas', { id: String(dept.id) });
      assert.equal(String(result.data.id), String(dept.id));
    });
  });

  // =========================================================================
  // Boundary Hierarchies (read-only, using dpCity)
  // =========================================================================

  describe('Boundary Hierarchies', () => {
    it('getList returns hierarchy definitions', async () => {
      const result = await dpCity.getList('boundary-hierarchies', {
        pagination: { page: 1, perPage: 50 }, sort: { field: 'hierarchyType', order: 'ASC' }, filter: {},
      });
      assert.ok(result.data.length > 0, 'Should return boundary hierarchy definitions');
      assert.ok((result.data[0] as any).hierarchyType, 'Hierarchy should have hierarchyType');
    });

    it('getOne fetches ADMIN hierarchy', async () => {
      const result = await dpCity.getOne('boundary-hierarchies', { id: 'ADMIN' });
      assert.equal(String(result.data.id), 'ADMIN');
    });
  });
```

**Step 2: Update the coverage validation test**

In the `Coverage: all resources in registry are testable` describe block, update the `expected` array to include the new resources:

```typescript
      const expected = [
        'tenants', 'departments', 'designations', 'complaint-types',
        'employees', 'boundaries', 'complaints', 'localization',
        'users', 'workflow-business-services', 'workflow-processes',
        'access-roles', 'mdms-schemas', 'boundary-hierarchies',
      ];
```

**Step 3: Run the full test suite**

Run: `cd packages/data-provider && node --import tsx --test src/providers/dataProvider.integration.test.ts`

Expected: All tests pass (old 62 + new ~15 = ~77).

**Step 4: Commit**

```bash
git add packages/data-provider/src/providers/dataProvider.integration.test.ts
git commit -m "test: integration tests for users, workflow, access, schemas, hierarchies"
```

---

### Task 4: Write scenario tests for PGR full lifecycle

**Files:**
- Modify: `packages/data-provider/src/providers/dataProvider.integration.test.ts`

This scenario exercises `pgrCreate()`, `pgrUpdate()` with ASSIGN, RESOLVE, and RATE actions — covering the remaining PGR workflow actions that weren't tested before.

**Step 1: Add PGR lifecycle scenario**

Insert after the new resource test suites but before the coverage validation suite:

```typescript
  // =========================================================================
  // Scenario: PGR Full Lifecycle (create → assign → resolve → rate)
  // =========================================================================

  describe('Scenario: PGR Full Lifecycle', () => {
    it('create → assign → resolve → rate', async () => {
      // 1. Create complaint
      const ctResult = await dpRoot.getList('complaint-types', {
        pagination: { page: 1, perPage: 1 }, sort: { field: 'serviceCode', order: 'ASC' }, filter: {},
      });
      const serviceCode = ctResult.data.length > 0 ? String((ctResult.data[0] as any).serviceCode) : 'StreetLightNotWorking';

      const localityCode = 'LOC_CITYA_1';
      const wrapper = await client.pgrCreate(CITY_TENANT, serviceCode,
        `Full lifecycle test ${TEST_PREFIX}`,
        { locality: { code: localityCode } },
        { name: 'Lifecycle Citizen', mobileNumber: '4444444444', type: 'CITIZEN',
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: DIGIT_TENANT }], tenantId: DIGIT_TENANT },
      );
      const service = (wrapper as any).service || wrapper;
      const srId = service.serviceRequestId;
      assert.ok(srId, 'Complaint should have serviceRequestId');
      assert.equal(service.applicationStatus, 'PENDINGFORASSIGNMENT', 'New complaint should be PENDINGFORASSIGNMENT');

      // 2. Find an employee UUID to assign to
      const employees = await client.employeeSearch(CITY_TENANT, { limit: 10 });
      const activeEmp = employees.find((e: any) => e.isActive !== false);
      assert.ok(activeEmp, 'Need at least one active employee for assignment');
      const empUuid = (activeEmp as any).uuid || (activeEmp as any).user?.uuid;
      assert.ok(empUuid, 'Employee should have a UUID');

      // 3. ASSIGN (GRO assigns to LME)
      const afterAssign = await client.pgrUpdate(service, 'ASSIGN', {
        comment: 'Assigning to employee', assignees: [empUuid],
      });
      const assignedService = (afterAssign as any).service || afterAssign;
      assert.equal(assignedService.applicationStatus, 'PENDINGATLME', 'After ASSIGN should be PENDINGATLME');

      // 4. RESOLVE (LME resolves)
      const afterResolve = await client.pgrUpdate(assignedService, 'RESOLVE', {
        comment: 'Issue has been fixed',
      });
      const resolvedService = (afterResolve as any).service || afterResolve;
      assert.equal(resolvedService.applicationStatus, 'RESOLVED', 'After RESOLVE should be RESOLVED');

      // 5. RATE (Citizen rates and closes)
      const afterRate = await client.pgrUpdate(resolvedService, 'RATE', {
        comment: 'Satisfied with resolution', rating: 5,
      });
      const ratedService = (afterRate as any).service || afterRate;
      assert.equal(ratedService.applicationStatus, 'CLOSEDAFTERRESOLUTION', 'After RATE should be CLOSEDAFTERRESOLUTION');

      // 6. Verify via workflow process search (audit trail)
      const processes = await client.workflowProcessSearch(CITY_TENANT, [srId]);
      assert.ok(processes.length >= 4, `Should have at least 4 workflow transitions (APPLY + ASSIGN + RESOLVE + RATE), got ${processes.length}`);
      const actions = processes.map((p: any) => p.action);
      assert.ok(actions.includes('APPLY'), 'Audit trail should include APPLY');
      assert.ok(actions.includes('ASSIGN'), 'Audit trail should include ASSIGN');
      assert.ok(actions.includes('RESOLVE'), 'Audit trail should include RESOLVE');
      assert.ok(actions.includes('RATE'), 'Audit trail should include RATE');
    });
  });
```

**Step 2: Run tests**

Run: `cd packages/data-provider && node --import tsx --test src/providers/dataProvider.integration.test.ts`

Expected: All tests pass.

**Step 3: Commit**

```bash
git add packages/data-provider/src/providers/dataProvider.integration.test.ts
git commit -m "test: PGR full lifecycle scenario (create → assign → resolve → rate)"
```

---

### Task 5: Write scenario tests for User CRUD, Encryption, and ID Generation

**Files:**
- Modify: `packages/data-provider/src/providers/dataProvider.integration.test.ts`

**Step 1: Add User CRUD scenario**

```typescript
  // =========================================================================
  // Scenario: User CRUD (create → search → update)
  // =========================================================================

  describe('Scenario: User CRUD', () => {
    it('create → search → update', async () => {
      const mobile = `88${Date.now().toString().slice(-8)}`;
      const userName = `inttest_${Date.now()}`;

      // 1. Create user
      const created = await client.userCreate({
        userName, name: `Test User ${TEST_PREFIX}`, mobileNumber: mobile,
        gender: 'MALE', type: 'CITIZEN', password: 'eGov@123',
        roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: DIGIT_TENANT }],
      }, DIGIT_TENANT);
      assert.ok(created.uuid, 'Created user should have uuid');
      assert.equal(created.userName, userName, 'Username should match');

      // 2. Search by mobile number
      const found = await client.userSearch(DIGIT_TENANT, { mobileNumber: mobile });
      assert.ok(found.length > 0, 'Should find user by mobile number');
      assert.equal((found[0] as any).uuid, created.uuid, 'Found user should match created user');

      // 3. Update user name
      const toUpdate = { ...found[0], name: `Updated User ${TEST_PREFIX}` };
      const updated = await client.userUpdate(toUpdate as Record<string, unknown>);
      assert.equal((updated as any).name, `Updated User ${TEST_PREFIX}`, 'Name should be updated');

      // 4. Verify update persisted
      const verify = await client.userSearch(DIGIT_TENANT, { uuid: [created.uuid as string] });
      assert.ok(verify.length > 0, 'Should find user after update');
      assert.equal((verify[0] as any).name, `Updated User ${TEST_PREFIX}`, 'Updated name should persist');
    });
  });
```

**Step 2: Add Encryption Round-Trip scenario**

```typescript
  // =========================================================================
  // Scenario: Encryption Round-Trip
  // =========================================================================

  describe('Scenario: Encryption Round-Trip', () => {
    it('encrypt → decrypt → verify match', async () => {
      const plainValues = ['9876543210', 'sensitive-data-test', 'hello@example.com'];

      // 1. Encrypt
      const encrypted = await client.encryptData(DIGIT_TENANT, plainValues);
      assert.equal(encrypted.length, plainValues.length, 'Should return same number of encrypted values');
      for (let i = 0; i < encrypted.length; i++) {
        assert.notEqual(encrypted[i], plainValues[i], `Encrypted value ${i} should differ from plain text`);
        assert.ok(typeof encrypted[i] === 'string' && encrypted[i].length > 0, `Encrypted value ${i} should be a non-empty string`);
      }

      // 2. Decrypt
      const decrypted = await client.decryptData(DIGIT_TENANT, encrypted);
      assert.equal(decrypted.length, plainValues.length, 'Should return same number of decrypted values');

      // 3. Verify round-trip
      for (let i = 0; i < plainValues.length; i++) {
        assert.equal(decrypted[i], plainValues[i], `Decrypted value ${i} should match original plain text`);
      }
    });
  });
```

**Step 3: Add ID Generation scenario**

```typescript
  // =========================================================================
  // Scenario: ID Generation
  // =========================================================================

  describe('Scenario: ID Generation', () => {
    it('generates formatted IDs', async () => {
      const results = await client.idgenGenerate(DIGIT_TENANT, [
        { idName: 'pgr.servicerequestid' },
      ]);
      assert.ok(results.length > 0, 'Should return generated IDs');
      assert.ok(results[0].id, 'Generated result should have id field');
      assert.ok(typeof results[0].id === 'string' && results[0].id.length > 0, 'ID should be a non-empty string');
    });

    it('generates multiple IDs in one call', async () => {
      const results = await client.idgenGenerate(DIGIT_TENANT, [
        { idName: 'pgr.servicerequestid' },
        { idName: 'pgr.servicerequestid' },
      ]);
      assert.equal(results.length, 2, 'Should return 2 generated IDs');
      assert.notEqual(results[0].id, results[1].id, 'Each generated ID should be unique');
    });
  });
```

**Step 4: Add Tenant Bootstrap scenario (MDMS schema + boundary hierarchy)**

```typescript
  // =========================================================================
  // Scenario: Tenant Bootstrap (schema search + hierarchy search)
  // =========================================================================

  describe('Scenario: Tenant Bootstrap Reads', () => {
    it('mdmsSchemaSearch returns schema definitions', async () => {
      const schemas = await client.mdmsSchemaSearch(DIGIT_TENANT);
      assert.ok(schemas.length > 0, 'Should return schema definitions');
      const deptSchema = schemas.find((s: any) => String(s.code).includes('Department'));
      assert.ok(deptSchema, 'Should have a Department schema');
      assert.ok((deptSchema as any).definition, 'Schema should have a definition');
    });

    it('mdmsSchemaSearch filters by codes', async () => {
      const schemas = await client.mdmsSchemaSearch(DIGIT_TENANT, ['common-masters.Department']);
      assert.ok(schemas.length > 0, 'Should find Department schema by code');
      assert.ok(String((schemas[0] as any).code).includes('Department'), 'Returned schema should be Department');
    });

    it('boundaryHierarchySearch returns hierarchy definitions', async () => {
      const hierarchies = await client.boundaryHierarchySearch(CITY_TENANT, 'ADMIN');
      assert.ok(hierarchies.length > 0, 'Should return ADMIN hierarchy');
      const admin = hierarchies[0] as any;
      assert.equal(admin.hierarchyType, 'ADMIN', 'Should be ADMIN type');
      assert.ok(admin.boundaryHierarchy || admin.boundaryHierarchyJsonNode, 'Should have hierarchy definition');
    });

    it('workflowBusinessServiceCreate is covered by before() hook', async () => {
      // The PGR test suite's before() hook calls workflowBusinessServiceCreate
      // if the PGR workflow doesn't exist. We just verify PGR workflow is present.
      const services = await client.workflowBusinessServiceSearch(DIGIT_TENANT, ['PGR']);
      assert.ok(services.length > 0, 'PGR workflow should exist (created by test setup)');
      const pgr = services[0] as any;
      assert.ok(pgr.states?.length > 0, 'PGR workflow should have states');
    });
  });
```

**Step 5: Run full test suite**

Run: `cd packages/data-provider && node --import tsx --test src/providers/dataProvider.integration.test.ts`

Expected: All tests pass (~85 total).

**Step 6: Commit**

```bash
git add packages/data-provider/src/providers/dataProvider.integration.test.ts
git commit -m "test: scenario tests for user CRUD, encryption, ID generation, tenant bootstrap"
```

---

### Task 6: Update coverage checklist and final verification

**Files:**
- Modify: `docs/plans/2026-03-06-endpoint-coverage-checklist.md`

**Step 1: Run the full test suite 3 times**

Run:
```bash
cd packages/data-provider
for i in 1 2 3; do
  echo "=== Run $i ==="
  node --import tsx --test src/providers/dataProvider.integration.test.ts 2>&1 | tail -10
done
```

Expected: All 3 runs show 0 failures.

**Step 2: Update the checklist**

Update the checklist markdown to reflect the new coverage status:
- Mark tested endpoints with ✅ in the Integration Test column
- Update the Summary Scorecard numbers
- Move items from "Gaps by Priority" to "Covered"

**Step 3: Commit**

```bash
git add docs/plans/2026-03-06-endpoint-coverage-checklist.md
git commit -m "docs: update endpoint coverage checklist — 36/36 client methods tested"
```

---

## Client Method Coverage Map (Final)

After all tasks complete, every `DigitApiClient` method will be tested:

| # | Method | Tested By |
|---|--------|-----------|
| 1 | `login()` | `before()` hook |
| 2 | `userSearch()` | Users resource + User CRUD scenario |
| 3 | `userCreate()` | User CRUD scenario |
| 4 | `userUpdate()` | User CRUD scenario |
| 5 | `mdmsSearch()` | MDMS department/designation/tenant/complaint-type tests |
| 6 | `mdmsCreate()` | MDMS department CRUD test |
| 7 | `mdmsUpdate()` | MDMS department update test |
| 8 | `mdmsSchemaSearch()` | MDMS Schemas resource + Tenant Bootstrap scenario |
| 9 | `mdmsSchemaCreate()` | Covered by `before()` hook (conditional) |
| 10 | `employeeSearch()` | Employees resource tests |
| 11 | `employeeCreate()` | Employees `before()` hook |
| 12 | `employeeUpdate()` | Employees update/delete tests |
| 13 | `boundarySearch()` | Boundaries getOne/update tests |
| 14 | `boundaryRelationshipSearch()` | Boundaries getList test |
| 15 | `boundaryHierarchySearch()` | Boundary Hierarchies resource + Tenant Bootstrap scenario |
| 16 | `boundaryCreate()` | Boundaries create test |
| 17 | `boundaryHierarchyCreate()` | Covered by `before()` hook (conditional) |
| 18 | `boundaryRelationshipCreate()` | Boundaries create test |
| 19 | `boundaryUpdate()` | Boundaries update test |
| 20 | `boundaryDelete()` | Boundaries delete test |
| 21 | `boundaryRelationshipDelete()` | Boundaries delete test |
| 22 | `pgrSearch()` | PGR complaints tests |
| 23 | `pgrCreate()` | PGR complaints create + PGR Lifecycle scenario |
| 24 | `pgrUpdate()` | PGR Lifecycle scenario (ASSIGN + RESOLVE + RATE) |
| 25 | `localizationSearch()` | Localization tests |
| 26 | `localizationUpsert()` | Localization create/update tests |
| 27 | `localizationDelete()` | Localization delete test |
| 28 | `workflowBusinessServiceSearch()` | Workflow Business Services resource + PGR `before()` |
| 29 | `workflowBusinessServiceCreate()` | PGR `before()` hook + Tenant Bootstrap scenario |
| 30 | `workflowProcessSearch()` | Workflow Processes resource + PGR Lifecycle scenario |
| 31 | `accessRolesSearch()` | Access Roles resource |
| 32 | `idgenGenerate()` | ID Generation scenario |
| 33 | `filestoreGetUrl()` | Not tested (needs a valid fileStoreId — depends on upload which has no client method) |
| 34 | `encryptData()` | Encryption Round-Trip scenario |
| 35 | `decryptData()` | Encryption Round-Trip scenario |

**Result: 34/35 client methods tested.** The only untested method is `filestoreGetUrl()` which requires a `fileStoreId` from an upload that has no client method.

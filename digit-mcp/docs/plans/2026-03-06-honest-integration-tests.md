# Honest Integration Tests — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every cell in the DataProvider coverage matrix represent a real, verified round-trip — no no-ops, no tautologies, no vacuous assertions.

**Architecture:** Fix 4 layers bottom-up: (1) add `_delete` endpoints to boundary-service Java, (2) add 4 new client methods to DigitApiClient, (3) replace DataProvider no-ops with real API calls, (4) fix all 16 dishonest test assertions. Every write operation is verified by an independent read.

**Tech Stack:** Java 17 / Spring Boot (boundary-service), TypeScript / node:test (data-provider), Docker Compose (rebuild), PostgreSQL (direct JDBC for delete)

---

## Task 1: Add boundary `_delete` endpoints to Java service

**Files:**
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/web/controllers/BoundaryController.java`
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/service/BoundaryService.java`
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/repository/BoundaryRepository.java`
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/repository/impl/BoundaryRepositoryImpl.java`
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/web/controllers/BoundaryRelationshipController.java`
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/service/BoundaryRelationshipService.java`
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/repository/BoundaryRelationshipRepository.java`
- Modify: `/root/code/Digit-Core/core-services/boundary-service/src/main/java/digit/repository/impl/BoundaryRelationshipRepositoryImpl.java`

Design decision: Use direct JDBC for delete (synchronous) rather than Kafka topics. Rationale:
- Delete is destructive — caller needs immediate confirmation
- No audit trail needed for test-created boundaries
- Repository already has `jdbcTemplate` injected for search queries
- Avoids adding Kafka topics + persister mappings + async delay

**Step 1: Add `delete()` to BoundaryRepository interface**

Add after the `update` method:

```java
public void delete(String tenantId, List<String> codes);
```

**Step 2: Implement `delete()` in BoundaryRepositoryImpl**

Add after the `update` method:

```java
@Override
public void delete(String tenantId, List<String> codes) {
    if (codes == null || codes.isEmpty()) return;
    // Delete relationships first (foreign key-like dependency)
    StringBuilder relSql = new StringBuilder("DELETE FROM boundary_relationship WHERE tenantid = ? AND code IN (");
    List<Object> relParams = new ArrayList<>();
    relParams.add(tenantId);
    for (int i = 0; i < codes.size(); i++) {
        relParams.add(codes.get(i));
        relSql.append(i == 0 ? "?" : ", ?");
    }
    relSql.append(")");
    jdbcTemplate.update(relSql.toString(), relParams.toArray());

    // Then delete boundary entities
    StringBuilder sql = new StringBuilder("DELETE FROM boundary WHERE tenantid = ? AND code IN (");
    List<Object> params = new ArrayList<>();
    params.add(tenantId);
    for (int i = 0; i < codes.size(); i++) {
        params.add(codes.get(i));
        sql.append(i == 0 ? "?" : ", ?");
    }
    sql.append(")");
    jdbcTemplate.update(sql.toString(), params.toArray());
}
```

**Step 3: Add `deleteBoundary()` to BoundaryService**

Add after `updateBoundary`:

```java
public BoundaryResponse deleteBoundary(BoundaryRequest boundaryRequest) {
    List<String> codes = boundaryRequest.getBoundary().stream()
            .map(Boundary::getCode)
            .collect(Collectors.toList());
    String tenantId = boundaryRequest.getBoundary().get(0).getTenantId();
    repository.delete(tenantId, codes);
    return BoundaryResponse.builder()
            .responseInfo(responseUtil.createResponseInfoFromRequestInfo(boundaryRequest.getRequestInfo(), true))
            .boundary(boundaryRequest.getBoundary())
            .build();
}
```

Note: Add `import java.util.stream.Collectors;` if not already imported.

**Step 4: Add `delete()` endpoint to BoundaryController**

Add after the `update` method:

```java
@RequestMapping(value = "/_delete", method = RequestMethod.POST)
public ResponseEntity<BoundaryResponse> delete(@Valid @RequestBody BoundaryRequest body) {
    BoundaryResponse response = boundaryService.deleteBoundary(body);
    return new ResponseEntity<>(response, HttpStatus.OK);
}
```

**Step 5: Add `delete()` to BoundaryRelationshipRepository interface**

```java
public void delete(String tenantId, List<String> codes, String hierarchyType);
```

**Step 6: Implement `delete()` in BoundaryRelationshipRepositoryImpl**

```java
@Override
public void delete(String tenantId, List<String> codes, String hierarchyType) {
    if (codes == null || codes.isEmpty()) return;
    StringBuilder sql = new StringBuilder("DELETE FROM boundary_relationship WHERE tenantid = ? AND hierarchytype = ? AND code IN (");
    List<Object> params = new ArrayList<>();
    params.add(tenantId);
    params.add(hierarchyType);
    for (int i = 0; i < codes.size(); i++) {
        params.add(codes.get(i));
        sql.append(i == 0 ? "?" : ", ?");
    }
    sql.append(")");
    jdbcTemplate.update(sql.toString(), params.toArray());
}
```

**Step 7: Add `deleteBoundaryRelationship()` to BoundaryRelationshipService**

```java
public BoundaryRelationshipResponse deleteBoundaryRelationship(BoundaryRelationshipRequest body) {
    BoundaryRelation rel = body.getBoundaryRelationship();
    boundaryRelationshipRepository.delete(rel.getTenantId(), List.of(rel.getCode()), rel.getHierarchyType());
    return BoundaryRelationshipResponse.builder()
            .responseInfo(ResponseInfo.builder().status("successful").build())
            .tenantBoundary(List.of(rel))
            .build();
}
```

Note: Add `import java.util.List;` if not already present. Check that the service class has the correct import for `ResponseInfo`.

**Step 8: Add `delete()` endpoint to BoundaryRelationshipController**

```java
@RequestMapping(value = "/_delete", method = RequestMethod.POST)
public ResponseEntity<BoundaryRelationshipResponse> delete(@Valid @RequestBody BoundaryRelationshipRequest body) {
    BoundaryRelationshipResponse response = boundaryRelationshipService.deleteBoundaryRelationship(body);
    return new ResponseEntity<>(response, HttpStatus.OK);
}
```

**Step 9: Rebuild and restart boundary-service**

```bash
cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml build boundary-service && docker compose -f docker-compose.deploy.yaml up -d boundary-service
```

Wait for healthy:
```bash
sleep 10 && docker compose -f docker-compose.deploy.yaml ps boundary-service
```
Expected: `Up ... (healthy)`

**Step 10: Smoke test the new endpoints via curl**

```bash
# Create a test boundary
curl -s -X POST http://localhost:18000/boundary-service/boundary/_create \
  -H 'Content-Type: application/json' \
  -d '{"RequestInfo":{"apiId":"Rainmaker","ver":"1.0","ts":0,"action":"","msgId":"test","authToken":"'$(curl -s -X POST http://localhost:18000/user/oauth/token -d 'username=ADMIN&password=eGov@123&userType=EMPLOYEE&tenantId=pg&scope=read&grant_type=password' -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' | jq -r .access_token)'"},"Boundary":[{"tenantId":"pg.citya","code":"TEST_DEL_SMOKE","geometry":{"type":"Point","coordinates":[0,0]}}]}' | jq .

# Delete it
curl -s -X POST http://localhost:18000/boundary-service/boundary/_delete \
  -H 'Content-Type: application/json' \
  -d '{"RequestInfo":{"apiId":"Rainmaker","ver":"1.0","ts":0,"action":"","msgId":"test","authToken":"'$(curl -s -X POST http://localhost:18000/user/oauth/token -d 'username=ADMIN&password=eGov@123&userType=EMPLOYEE&tenantId=pg&scope=read&grant_type=password' -H 'Authorization: Basic ZWdvdi11c2VyLWNsaWVudDo=' | jq -r .access_token)'"},"Boundary":[{"tenantId":"pg.citya","code":"TEST_DEL_SMOKE"}]}' | jq .
```

Expected: 200 OK with `responseInfo.status: "successful"`.

**Step 11: Commit Java changes**

```bash
cd /root/code/Digit-Core && git add -A && git commit -m "feat(boundary-service): add _delete endpoints for boundary entities and relationships"
```

---

## Task 2: Add new endpoints + client methods to DigitApiClient

**Files:**
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/client/endpoints.ts`
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/client/DigitApiClient.ts`
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/client/DigitApiClient.test.ts`

**Step 1: Add new endpoint constants**

In `endpoints.ts`, add after `BOUNDARY_RELATIONSHIP_SEARCH`:

```typescript
BOUNDARY_UPDATE: '/boundary-service/boundary/_update',
BOUNDARY_DELETE: '/boundary-service/boundary/_delete',
BOUNDARY_RELATIONSHIP_UPDATE: '/boundary-service/boundary-relationships/_update',
BOUNDARY_RELATIONSHIP_DELETE: '/boundary-service/boundary-relationships/_delete',
LOCALIZATION_DELETE: '/localization/messages/v1/_delete',
```

**Step 2: Add `boundaryUpdate()` to DigitApiClient**

Add after `boundaryRelationshipCreate()`:

```typescript
async boundaryUpdate(tenantId: string, boundaries: { code: string; additionalDetails?: Record<string, unknown>; geometry?: Record<string, unknown> }[]): Promise<Record<string, unknown>[]> {
  const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_UPDATE'), {
    RequestInfo: this.buildRequestInfo(),
    Boundary: boundaries.map((b) => ({ tenantId, code: b.code, additionalDetails: b.additionalDetails, geometry: b.geometry })),
  });
  return data.Boundary || [];
}
```

**Step 3: Add `boundaryDelete()` to DigitApiClient**

```typescript
async boundaryDelete(tenantId: string, boundaryCodes: string[]): Promise<Record<string, unknown>[]> {
  const data = await this.request<{ Boundary?: Record<string, unknown>[] }>(this.endpoint('BOUNDARY_DELETE'), {
    RequestInfo: this.buildRequestInfo(),
    Boundary: boundaryCodes.map((code) => ({ tenantId, code })),
  });
  return data.Boundary || [];
}
```

**Step 4: Add `boundaryRelationshipDelete()` to DigitApiClient**

```typescript
async boundaryRelationshipDelete(tenantId: string, code: string, hierarchyType: string): Promise<Record<string, unknown>> {
  const data = await this.request<{ BoundaryRelationship?: Record<string, unknown> }>(this.endpoint('BOUNDARY_RELATIONSHIP_DELETE'), {
    RequestInfo: this.buildRequestInfo(),
    BoundaryRelationship: { tenantId, code, hierarchyType },
  });
  return data.BoundaryRelationship || {};
}
```

**Step 5: Add `localizationDelete()` to DigitApiClient**

Add after `localizationUpsert()`:

```typescript
async localizationDelete(tenantId: string, locale: string, messages: { code: string; module: string }[]): Promise<boolean> {
  const data = await this.request<{ successful?: boolean }>(this.endpoint('LOCALIZATION_DELETE'), {
    RequestInfo: this.buildRequestInfo(),
    tenantId,
    messages: messages.map((m) => ({ code: m.code, module: m.module, locale })),
  });
  return data.successful === true;
}
```

**Step 6: Add unit tests for new methods**

Append to `DigitApiClient.test.ts`:

```typescript
it('exposes boundaryUpdate endpoint', () => {
  assert.equal(client.endpoint('BOUNDARY_UPDATE'), '/boundary-service/boundary/_update');
});

it('exposes boundaryDelete endpoint', () => {
  assert.equal(client.endpoint('BOUNDARY_DELETE'), '/boundary-service/boundary/_delete');
});

it('exposes boundaryRelationshipDelete endpoint', () => {
  assert.equal(client.endpoint('BOUNDARY_RELATIONSHIP_DELETE'), '/boundary-service/boundary-relationships/_delete');
});

it('exposes localizationDelete endpoint', () => {
  assert.equal(client.endpoint('LOCALIZATION_DELETE'), '/localization/messages/v1/_delete');
});
```

**Step 7: Run unit tests**

```bash
cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/client/DigitApiClient.test.ts
```

Expected: All pass (existing + 4 new).

**Step 8: Commit**

```bash
cd /root/DIGIT-MCP && git add packages/data-provider/src/client/ && git commit -m "feat(client): add boundaryUpdate, boundaryDelete, boundaryRelationshipDelete, localizationDelete methods"
```

---

## Task 3: Replace DataProvider no-ops with real API calls

**Files:**
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/providers/dataProvider.ts`

**Step 1: Fix boundary `update` — call real API**

Replace the boundary block inside the `update` method (around line 291-295):

```typescript
// BEFORE (no-op):
if (config.type === 'boundary') {
  const data = params.data as Record<string, unknown>;
  return { data: { ...data, id: String(data.code || params.id) } as RaRecord };
}

// AFTER (real):
if (config.type === 'boundary') {
  const data = params.data as Record<string, unknown>;
  const code = String(data.code || params.id);
  const updated = await client.boundaryUpdate(tenantId, [{
    code,
    additionalDetails: data.additionalDetails as Record<string, unknown> | undefined,
    geometry: data.geometry as Record<string, unknown> | undefined,
  }]);
  if (updated.length) return { data: normalizeRecord(updated[0], config) };
  return { data: { ...data, id: code } as RaRecord };
}
```

**Step 2: Fix boundary `delete` — call real API**

Replace the boundary block inside the `delete` method (around line 356-362):

```typescript
// BEFORE (no-op):
if (config.type === 'boundary') {
  const all = await fetchAll('boundaries');
  const record = all.find((r) => String(r.id) === String(params.id));
  if (!record) throw new Error(`Boundary not found: ${params.id}`);
  return { data: record };
}

// AFTER (real):
if (config.type === 'boundary') {
  const all = await fetchAll('boundaries');
  const record = all.find((r) => String(r.id) === String(params.id));
  if (!record) throw new Error(`Boundary not found: ${params.id}`);
  const code = String(params.id);
  // Delete relationship first (if it exists), then entity
  try {
    await client.boundaryRelationshipDelete(tenantId, code, 'ADMIN');
  } catch { /* relationship may not exist */ }
  await client.boundaryDelete(tenantId, [code]);
  return { data: record };
}
```

**Step 3: Fix localization `delete` — call real API**

Replace the localization block inside the `delete` method (around line 348-355):

```typescript
// BEFORE (no-op):
if (config.type === 'localization') {
  const all = await fetchAll('localization');
  const record = all.find((r) => String(r.id) === String(params.id));
  if (record) return { data: record };
  return { data: { id: params.id, code: params.id } as RaRecord };
}

// AFTER (real):
if (config.type === 'localization') {
  const all = await fetchAll('localization');
  const record = all.find((r) => String(r.id) === String(params.id));
  if (!record) throw new Error(`Localization message not found: ${params.id}`);
  const loc = record as unknown as Record<string, unknown>;
  await client.localizationDelete(tenantId, String(loc.locale || 'en_IN'), [
    { code: String(loc.code), module: String(loc.module) },
  ]);
  return { data: record };
}
```

**Step 4: Run unit tests to verify no regressions**

```bash
cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/**/*.test.ts --test-name-pattern="^(?!.*integration)"
```

Expected: All unit tests pass.

**Step 5: Commit**

```bash
cd /root/DIGIT-MCP && git add packages/data-provider/src/providers/dataProvider.ts && git commit -m "fix(data-provider): replace boundary/localization no-ops with real API calls"
```

---

## Task 4: Fix all dishonest test assertions

**Files:**
- Modify: `/root/DIGIT-MCP/packages/data-provider/src/providers/dataProvider.integration.test.ts`

This task fixes all 16 dishonesty items. Each fix is independent.

**Step 1: Fix localization update tautology (line ~423)**

```typescript
// BEFORE (tautology — can never fail):
assert.equal((result.data as any).message || `Updated ${TEST_PREFIX}`, `Updated ${TEST_PREFIX}`);

// AFTER (honest):
assert.equal((result.data as any).message, `Updated ${TEST_PREFIX}`, 'Updated message should be returned');
```

**Step 2: Fix PGR status filter vacuous assertion (line ~750)**

```typescript
// BEFORE (total >= 0 is always true):
assert.ok(result.total >= 0, 'Should return a valid total');

// AFTER (honest — verify filter actually works):
if (result.data.length > 0) {
  for (const record of result.data) {
    assert.equal((record as any).applicationStatus, 'PENDINGFORASSIGNMENT',
      'All filtered results should have PENDINGFORASSIGNMENT status');
  }
}
```

**Step 3: Fix department getManyReference conditional guard (line ~168)**

```typescript
// BEFORE (silently skips if no active field):
const dept = list.data[0] as any;
if (dept.active !== undefined) {
  const result = await dpRoot.getManyReference('departments', { ... });
  assert.ok(result.data.length > 0, '...');
}

// AFTER (fails if precondition not met):
const dept = list.data[0] as any;
assert.ok(dept.active !== undefined, 'Precondition: department record should have active field');
const result = await dpRoot.getManyReference('departments', {
  target: 'active', id: String(dept.active),
  pagination: { page: 1, perPage: 100 }, sort: { field: 'code', order: 'ASC' }, filter: {},
});
assert.ok(result.data.length > 0, 'Should find departments matching the active field');
```

**Step 4: Fix complaint-types getManyReference conditional guard (line ~279)**

```typescript
// BEFORE:
const dept = (list.data[0] as any).department;
if (dept) { ... }

// AFTER:
const dept = (list.data[0] as any).department;
assert.ok(dept, 'Precondition: complaint type should have department field');
const result = await dpRoot.getManyReference('complaint-types', {
  target: 'department', id: dept,
  pagination: { page: 1, perPage: 100 }, sort: { field: 'serviceCode', order: 'ASC' }, filter: {},
});
assert.ok(result.data.length > 0, `Should find complaint types in department ${dept}`);
```

**Step 5: Fix PGR getManyReference conditional guard (line ~769)**

```typescript
// BEFORE:
const code = (one.data as any).serviceCode;
if (code) { ... }

// AFTER:
const code = (one.data as any).serviceCode;
assert.ok(code, 'Precondition: complaint should have serviceCode');
const result = await dpCity.getManyReference('complaints', {
  target: 'serviceCode', id: code,
  pagination: { page: 1, perPage: 10 }, sort: { field: 'serviceRequestId', order: 'DESC' }, filter: {},
});
assert.ok(result.data.length > 0, 'Should find complaints by service code');
```

**Step 6: Fix pagination guards (departments line ~140, localization line ~371, boundaries line ~473)**

For each pagination test, change `if (p1.total > N)` to `assert.ok(p1.total > N, ...)`:

```typescript
// Departments pagination (line ~140):
assert.ok(p1.total > 3, 'Precondition: need >3 departments to test pagination');
const p2 = await dpRoot.getList('departments', { ... });
assert.notEqual(String(p1.data[0].id), String(p2.data[0].id), 'Page 2 should differ');

// Localization pagination (line ~371):
assert.ok(p1.total > 5, 'Precondition: need >5 localization messages to test pagination');
const p2 = await dpRoot.getList('localization', { ... });
assert.notEqual(String(p1.data[0].id), String(p2.data[0].id), 'Page 2 should differ');

// Boundaries pagination (line ~473):
assert.ok(p1.total > 3, 'Precondition: need >3 boundaries to test pagination');
const p2 = await dpCity.getList('boundaries', { ... });
assert.notEqual(String(p1.data[0].id), String(p2.data[0].id), 'Page 2 should differ');
```

**Step 7: Strengthen HRMS create test (line ~636-638)**

```typescript
// BEFORE (trivial):
it('create — tested via before() hook setup', () => {
  assert.ok(employeeUuid, 'Employee create should have succeeded in before()');
});

// AFTER (verified by independent read):
it('create — verified via getOne', async () => {
  assert.ok(employeeUuid, 'Employee create should have succeeded in before()');
  const fetched = await dpCity.getOne('employees', { id: employeeUuid });
  assert.equal(String(fetched.data.id), employeeUuid, 'getOne should find the created employee');
  assert.ok((fetched.data as any).user?.name?.includes(TEST_PREFIX),
    'Created employee name should contain test prefix');
});
```

**Step 8: Strengthen HRMS update test — actually modify a field (line ~640-651)**

```typescript
// BEFORE (sends same data, checks nothing changed):
it('update modifies employee via full object', async () => {
  assert.ok(employeeUuid, 'Employee should have been created');
  const fetched = await client.employeeSearch(CITY_TENANT, { codes: [testEmployeeCode!] });
  assert.ok(fetched.length > 0, 'Should find employee to update');
  const emp = fetched[0] as Record<string, unknown>;
  const result = await dpCity.update('employees', {
    id: employeeUuid, data: emp, previousData: { id: employeeUuid } as any,
  });
  assert.equal(String(result.data.id), employeeUuid);
});

// AFTER (changes name, verifies via independent read):
it('update modifies employee name', async () => {
  assert.ok(employeeUuid, 'Employee should have been created');
  const fetched = await client.employeeSearch(CITY_TENANT, { codes: [testEmployeeCode!] });
  assert.ok(fetched.length > 0, 'Should find employee to update');
  const emp = fetched[0] as Record<string, unknown>;
  const user = emp.user as Record<string, unknown>;
  const newName = `Updated Employee ${TEST_PREFIX}`;
  user.name = newName;
  const result = await dpCity.update('employees', {
    id: employeeUuid, data: emp, previousData: { id: employeeUuid } as any,
  });
  assert.equal(String(result.data.id), employeeUuid);
  assert.equal((result.data as any).user?.name, newName, 'Returned data should have updated name');
  // Independent read to verify persistence
  const verify = await dpCity.getOne('employees', { id: employeeUuid });
  assert.equal((verify.data as any).user?.name, newName, 'Updated name should persist');
});
```

**Step 9: Strengthen PGR delete — verify status (line ~858)**

```typescript
// BEFORE:
assert.ok(result.data.id, 'Deleted complaint should return data');

// AFTER:
assert.ok(result.data.id, 'Deleted complaint should return data');
assert.equal((result.data as any).applicationStatus, 'REJECTED',
  'Deleted (rejected) complaint should have REJECTED status');
```

**Step 10: Strengthen PGR deleteMany — verify status via re-fetch (line ~878-880)**

```typescript
// BEFORE:
assert.deepEqual(result.data, [dmId]);

// AFTER:
assert.deepEqual(result.data, [dmId]);
const verify = await dpCity.getOne('complaints', { id: dmId });
assert.equal((verify.data as any).applicationStatus, 'REJECTED',
  'Complaint should be REJECTED after deleteMany');
```

**Step 11: Strengthen PGR updateMany — verify status via re-fetch (line ~832-833)**

```typescript
// BEFORE:
assert.deepEqual(result.data, [newId]);

// AFTER:
assert.deepEqual(result.data, [newId]);
const verify = await dpCity.getOne('complaints', { id: newId });
assert.equal((verify.data as any).applicationStatus, 'REJECTED',
  'Complaint should be REJECTED after updateMany');
```

**Step 12: Strengthen MDMS deleteMany — verify records gone (line ~231-232)**

```typescript
// BEFORE:
const result = await dpRoot.deleteMany('departments', { ids: [code1, code2] });
assert.deepEqual(result.data, [code1, code2]);

// AFTER:
const result = await dpRoot.deleteMany('departments', { ids: [code1, code2] });
assert.deepEqual(result.data, [code1, code2]);
await delay(500); // MDMS async persistence
const after = await dpRoot.getList('departments', {
  pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' }, filter: {},
});
assert.ok(!after.data.find((r) => String(r.id) === code1), `${code1} should be deleted`);
assert.ok(!after.data.find((r) => String(r.id) === code2), `${code2} should be deleted`);
```

**Step 13: Fix boundary tests — use real update + delete**

Replace the existing boundary update/delete tests:

```typescript
it('update changes boundary additionalDetails', async () => {
  assert.ok(firstCode, 'Need a boundary code');
  const testDetails = { label: `Updated ${TEST_PREFIX}`, updatedAt: Date.now() };
  const result = await dpCity.update('boundaries', {
    id: firstCode, data: { code: firstCode, additionalDetails: testDetails },
    previousData: { id: firstCode } as any,
  });
  assert.equal(String(result.data.id), firstCode);
  // Verify via independent read
  const verify = await dpCity.getOne('boundaries', { id: firstCode });
  const details = (verify.data as any).additionalDetails;
  assert.ok(details, 'Boundary should have additionalDetails after update');
  assert.equal(details.label, testDetails.label, 'additionalDetails.label should match');
});

it('updateMany updates multiple boundaries', async () => {
  assert.ok(firstCode, 'Need boundary codes');
  const ids = secondCode ? [firstCode, secondCode] : [firstCode];
  const testDetails = { batch: true, prefix: TEST_PREFIX };
  const result = await dpCity.updateMany('boundaries', { ids, data: { additionalDetails: testDetails } });
  assert.deepEqual(result.data, ids);
  // Verify first boundary was updated
  const verify = await dpCity.getOne('boundaries', { id: firstCode });
  assert.equal((verify.data as any).additionalDetails?.batch, true, 'Batch update should persist');
});

it('delete removes boundary entity + relationship', async () => {
  // Create a fresh boundary to delete (don't delete shared test data)
  const delCode = `${TEST_PREFIX}_DEL_BNDRY`;
  assert.ok(parentWardCode, 'Need a Ward code as parent');
  await dpCity.create('boundaries', {
    data: { code: delCode, boundaryType: 'Locality', hierarchyType: 'ADMIN', parent: parentWardCode },
  });
  // Verify it exists
  const before = await dpCity.getList('boundaries', {
    pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' }, filter: {},
  });
  assert.ok(before.data.find((r) => String(r.id) === delCode), 'Boundary should exist before delete');
  // Delete it
  const result = await dpCity.delete('boundaries', {
    id: delCode, previousData: { id: delCode } as any,
  });
  assert.equal(String(result.data.id), delCode);
  // Verify it's gone via independent read
  const after = await dpCity.getList('boundaries', {
    pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' }, filter: {},
  });
  assert.ok(!after.data.find((r) => String(r.id) === delCode), 'Boundary should be gone after delete');
});

it('deleteMany removes multiple boundaries', async () => {
  const delCode1 = `${TEST_PREFIX}_DM_B1`;
  const delCode2 = `${TEST_PREFIX}_DM_B2`;
  assert.ok(parentWardCode, 'Need a Ward code as parent');
  await dpCity.create('boundaries', {
    data: { code: delCode1, boundaryType: 'Locality', hierarchyType: 'ADMIN', parent: parentWardCode },
  });
  await dpCity.create('boundaries', {
    data: { code: delCode2, boundaryType: 'Locality', hierarchyType: 'ADMIN', parent: parentWardCode },
  });
  const result = await dpCity.deleteMany('boundaries', { ids: [delCode1, delCode2] });
  assert.deepEqual(result.data, [delCode1, delCode2]);
  // Verify both are gone
  const after = await dpCity.getList('boundaries', {
    pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' }, filter: {},
  });
  assert.ok(!after.data.find((r) => String(r.id) === delCode1), `${delCode1} should be gone`);
  assert.ok(!after.data.find((r) => String(r.id) === delCode2), `${delCode2} should be gone`);
});
```

**Step 14: Fix localization delete tests — use real delete**

```typescript
it('delete removes a localization message', async () => {
  // Create a test message to delete (don't delete shared data)
  const delCode = `${TEST_PREFIX}_LOC_DEL`;
  await dpRoot.create('localization', {
    data: { code: delCode, message: `Delete me ${TEST_PREFIX}`, module: 'rainmaker-common', locale: 'en_IN' },
  });
  // Verify it exists via search
  const before = await dpRoot.getList('localization', {
    pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' },
    filter: { module: 'rainmaker-common' },
  });
  assert.ok(before.data.find((r) => String(r.id) === delCode), 'Message should exist before delete');
  // Delete it
  const result = await dpRoot.delete('localization', {
    id: delCode, previousData: { id: delCode } as any,
  });
  assert.equal(String(result.data.id), delCode);
  // Verify it's gone
  const after = await dpRoot.getList('localization', {
    pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' },
    filter: { module: 'rainmaker-common' },
  });
  assert.ok(!after.data.find((r) => String(r.id) === delCode), 'Message should be gone after delete');
});

it('deleteMany removes multiple localization messages', async () => {
  const delCode1 = `${TEST_PREFIX}_LOC_DM1`;
  const delCode2 = `${TEST_PREFIX}_LOC_DM2`;
  await dpRoot.create('localization', {
    data: { code: delCode1, message: `DM1 ${TEST_PREFIX}`, module: 'rainmaker-common', locale: 'en_IN' },
  });
  await dpRoot.create('localization', {
    data: { code: delCode2, message: `DM2 ${TEST_PREFIX}`, module: 'rainmaker-common', locale: 'en_IN' },
  });
  const result = await dpRoot.deleteMany('localization', { ids: [delCode1, delCode2] });
  assert.deepEqual(result.data, [delCode1, delCode2]);
  // Verify both are gone
  const after = await dpRoot.getList('localization', {
    pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' },
    filter: { module: 'rainmaker-common' },
  });
  assert.ok(!after.data.find((r) => String(r.id) === delCode1), `${delCode1} should be gone`);
  assert.ok(!after.data.find((r) => String(r.id) === delCode2), `${delCode2} should be gone`);
});
```

**Step 15: Update the matrix comment at the top of the test file**

Change line 26 from:
```
 * Boundary create: entity + hierarchy relationship. Update/delete: no-op (immutable).
 * PGR delete: REJECT via workflow. Localization delete: upsert empty message.
```
To:
```
 * Boundary create: entity + hierarchy relationship. Update: additionalDetails/geometry. Delete: entity + relationship.
 * PGR delete: REJECT via workflow. Localization delete: via _delete endpoint (hard delete).
```

**Step 16: Commit**

```bash
cd /root/DIGIT-MCP && git add packages/data-provider/src/providers/dataProvider.integration.test.ts && git commit -m "test: make all integration tests honest — no no-ops, no tautologies, verify via independent reads"
```

---

## Task 5: Run full test suite and verify stability

**Step 1: Run unit tests**

```bash
cd /root/DIGIT-MCP/packages/data-provider && node --import tsx --test src/**/*.test.ts --test-name-pattern="^(?!.*integration)"
```

Expected: All pass (existing + 4 new endpoint tests).

**Step 2: Run integration tests 3 times**

```bash
cd /root/DIGIT-MCP/packages/data-provider && for i in 1 2 3; do echo "=== Run $i ==="; node --import tsx --test src/providers/dataProvider.integration.test.ts 2>&1 | grep -E "(# tests|# pass|# fail|not ok)"; echo; done
```

Expected: 62+ tests, 0 failures, 3 consecutive passes.

**Step 3: If any failures, debug and fix**

Common issues:
- Boundary delete returns 404: Check that boundary-service rebuilt correctly (`docker compose ps`)
- Localization delete returns 404: Check Kong route (`curl http://localhost:18000/localization/messages/v1/_delete`)
- Boundary update returns error on additionalDetails: The update endpoint may require `geometry` too — check the Java validator

**Step 4: Final commit**

```bash
cd /root/DIGIT-MCP && git add -A && git commit -m "chore: honest integration tests — all cells verified via real API round-trips"
```

---

## Honesty Audit Checklist

After all tasks complete, verify each former dishonesty item is fixed:

| # | Former issue | Fix | Verified by |
|---|---|---|---|
| 1 | Localization update `\|\|` tautology | Assert actual `.message` value | Task 4 Step 1 |
| 2 | PGR status filter `>= 0` | Assert each record has matching status | Task 4 Step 2 |
| 3 | Dept getManyReference `if (active)` | `assert.ok(active)` precondition | Task 4 Step 3 |
| 4 | Complaint-types getManyRef `if (dept)` | `assert.ok(dept)` precondition | Task 4 Step 4 |
| 5 | PGR getManyReference `if (code)` | `assert.ok(code)` precondition | Task 4 Step 5 |
| 6-8 | Pagination `if (total > N)` | `assert.ok(total > N)` precondition | Task 4 Step 6 |
| 9 | HRMS create trivial | Verify via `getOne` + check name | Task 4 Step 7 |
| 10 | HRMS update sends same data | Change name, verify via re-fetch | Task 4 Step 8 |
| 11 | PGR delete only checks ID | Assert `applicationStatus === 'REJECTED'` | Task 4 Step 9 |
| 12 | PGR deleteMany only checks IDs | Re-fetch, assert REJECTED | Task 4 Step 10 |
| 13 | PGR updateMany only checks IDs | Re-fetch, assert REJECTED | Task 4 Step 11 |
| 14 | MDMS deleteMany only checks IDs | Verify records gone from getList | Task 4 Step 12 |
| 15 | Boundary update/delete no-ops | Real API calls + verify | Task 3 + Task 4 Step 13 |
| 16 | Localization delete no-op | Real `_delete` endpoint + verify | Task 3 + Task 4 Step 14 |

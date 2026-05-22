# Honest Integration Tests — Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every cell in the DataProvider coverage matrix represent a real, verified round-trip against the DIGIT backend — no no-ops, no tautologies, no vacuous assertions.

**Architecture:** Fix 4 layers bottom-up: add missing `_delete` endpoint to boundary-service (Java), add 4 new methods to DigitApiClient, replace all DataProvider no-ops with real API calls, then fix all 16 dishonest test assertions.

**Tech Stack:** Java (boundary-service Spring Boot), TypeScript (DigitApiClient + DataProvider + tests), node:test + node:assert

---

## Problem Statement

Of 62 integration tests, 15-16 have honesty problems:

| Category | Count | Examples |
|----------|-------|---------|
| Tautological assertions | 2 | Localization update `\|\|` fallback, PGR status filter `>=0` |
| No-ops claiming green | 6 | Boundary update/delete, Localization delete |
| Weak verifications | 5 | PGR delete only checks ID, HRMS update sends same data |
| Vacuous conditional guards | 5 | `if (field) { assert }` silently passes |

## Layer 1: boundary-service Java (new `_delete` endpoints)

### POST `/boundary-service/boundary/_delete`

Request:
```json
{
  "RequestInfo": { ... },
  "boundary": [{ "code": "LOC_001", "tenantId": "pg.citya" }]
}
```

Behavior:
- Hard delete from `boundary` table (no `isActive` field in schema)
- Cascade: also delete matching `boundary_relationship` rows
- Validation: boundary must exist
- Publish to `deleteBoundaryTopic` for persister

Files:
- `BoundaryController.java` — add `@PostMapping("/_delete")`
- `BoundaryService.java` — add `delete(BoundarySearchRequest)` method
- `BoundaryRepository.java` — add delete query

### POST `/boundary-service/boundary-relationships/_delete`

Request:
```json
{
  "RequestInfo": { ... },
  "boundaryRelationship": [{ "code": "LOC_001", "tenantId": "pg.citya", "hierarchyType": "ADMIN" }]
}
```

Behavior:
- Hard delete from `boundary_relationship` table
- Validation: relationship must exist, must have no children
- Publish to `deleteBoundaryRelationshipTopic` for persister

Files:
- `BoundaryRelationshipController.java` — add `@PostMapping("/_delete")`
- `BoundaryRelationshipService.java` — add `delete()` method
- `BoundaryRelationshipRepository.java` — add delete query

### Persister config
- Add `deleteBoundaryTopic` and `deleteBoundaryRelationshipTopic` to persister YAML
- Map to `DELETE FROM boundary WHERE code = ? AND tenantId = ?`
- Map to `DELETE FROM boundary_relationship WHERE code = ? AND tenantId = ? AND hierarchyType = ?`

### Rebuild
```bash
cd ~/code/tilt-demo && docker compose -f docker-compose.deploy.yaml build boundary-service
docker compose -f docker-compose.deploy.yaml up -d boundary-service
```

## Layer 2: DigitApiClient new methods

Add 4 methods to `DigitApiClient.ts`:

```typescript
async localizationDelete(tenantId: string, locale: string,
  messages: { code: string; module: string }[]): Promise<boolean>
// POST /localization/messages/v1/_delete
// Body: { RequestInfo, tenantId, messages: [{ code, module, locale }] }
// Returns: true if response.deleted === true

async boundaryUpdate(tenantId: string,
  boundaries: { code: string; additionalDetails?: Record<string, unknown> }[]): Promise<Record<string, unknown>[]>
// POST /boundary-service/boundary/_update
// Body: { RequestInfo, boundary: [...] }

async boundaryDelete(tenantId: string, boundaryCodes: string[]): Promise<boolean>
// POST /boundary-service/boundary/_delete
// Body: { RequestInfo, boundary: codes.map(code => ({ code, tenantId })) }

async boundaryRelationshipDelete(tenantId: string,
  codes: string[], hierarchyType?: string): Promise<boolean>
// POST /boundary-service/boundary-relationships/_delete
```

Each method gets a unit test that mocks the HTTP call and verifies the request shape.

## Layer 3: DataProvider fixes

### Boundary update (currently no-op → real)
```typescript
// Before: return { data: { ...data, id: String(data.code || params.id) } }
// After:
if (config.type === 'boundary') {
  const data = params.data as Record<string, unknown>;
  const code = String(data.code || params.id);
  const updated = await client.boundaryUpdate(tenantId, [{ code, additionalDetails: data.additionalDetails }]);
  return { data: normalizeRecord(updated[0] || { ...data, code }, config) };
}
```

### Boundary delete (currently no-op → real)
```typescript
// Before: return record from fetchAll
// After:
if (config.type === 'boundary') {
  const all = await fetchAll('boundaries');
  const record = all.find(r => String(r.id) === String(params.id));
  if (!record) throw new Error(`Boundary not found: ${params.id}`);
  // Delete relationship first, then entity
  await client.boundaryRelationshipDelete(tenantId, [String(params.id)]);
  await client.boundaryDelete(tenantId, [String(params.id)]);
  return { data: record };
}
```

### Localization delete (currently no-op → real)
```typescript
// Before: return record from fetchAll (no-op)
// After:
if (config.type === 'localization') {
  const all = await fetchAll('localization');
  const record = all.find(r => String(r.id) === String(params.id));
  if (!record) throw new Error(`Localization message not found: ${params.id}`);
  const loc = record as Record<string, unknown>;
  await client.localizationDelete(tenantId, String(loc.locale || 'en_IN'),
    [{ code: String(loc.code), module: String(loc.module) }]);
  return { data: record };
}
```

## Layer 4: Test honesty fixes (16 items)

### Fix 1: Localization update tautology (line 423)
```typescript
// Before (tautology — never fails):
assert.equal((result.data as any).message || `Updated ${TEST_PREFIX}`, `Updated ${TEST_PREFIX}`);
// After (honest):
assert.equal((result.data as any).message, `Updated ${TEST_PREFIX}`);
```

### Fix 2: PGR status filter (line 750)
```typescript
// Before (vacuous — total >= 0 is always true):
assert.ok(result.total >= 0, 'Should return a valid total');
// After (honest):
for (const record of result.data) {
  assert.equal((record as any).applicationStatus, 'PENDINGFORASSIGNMENT',
    'Filtered results should match status');
}
```

### Fixes 3-7: Conditional guards → fail on precondition
```typescript
// Before (silently skips):
if (dept.active !== undefined) { ... assert ... }
// After (fails if precondition not met):
assert.ok(dept.active !== undefined, 'Precondition: department should have active field');
// ... assert ...
```

Apply to: department getManyReference, complaint-types getManyReference, PGR getManyReference, all pagination tests.

### Fix 8: HRMS create — verify via independent read
```typescript
// Before: assert.ok(employeeUuid)
// After:
assert.ok(employeeUuid, 'Employee create should have succeeded');
const fetched = await dpCity.getOne('employees', { id: employeeUuid });
assert.equal(String(fetched.data.id), employeeUuid);
assert.ok((fetched.data as any).user?.name?.includes(TEST_PREFIX), 'Should find test employee by name');
```

### Fix 9: HRMS update — actually change something
```typescript
// Before: sends same object back, checks id
// After:
const emp = fetched[0] as Record<string, unknown>;
const user = emp.user as Record<string, unknown>;
const newName = `Updated ${TEST_PREFIX}`;
user.name = newName;
const result = await dpCity.update('employees', { id: employeeUuid, data: emp, previousData: ... });
assert.equal((result.data as any).user?.name, newName, 'Name should be updated');
// Re-fetch to verify persistence
const verify = await dpCity.getOne('employees', { id: employeeUuid });
assert.equal((verify.data as any).user?.name, newName, 'Updated name should persist');
```

### Fix 10: PGR delete — verify status change
```typescript
// Before: assert.ok(result.data.id)
// After:
assert.equal((result.data as any).applicationStatus, 'REJECTED', 'Deleted complaint should be REJECTED');
```

### Fix 11: PGR deleteMany — verify + re-fetch
```typescript
// Before: assert.deepEqual(result.data, [dmId])
// After:
assert.deepEqual(result.data, [dmId]);
const verify = await dpCity.getOne('complaints', { id: dmId });
assert.equal((verify.data as any).applicationStatus, 'REJECTED', 'Should be REJECTED after deleteMany');
```

### Fix 12: PGR updateMany — verify status changed
```typescript
// Before: assert.deepEqual(result.data, [newId])
// After:
assert.deepEqual(result.data, [newId]);
const verify = await dpCity.getOne('complaints', { id: newId });
assert.equal((verify.data as any).applicationStatus, 'REJECTED', 'Should be REJECTED after updateMany');
```

### Fix 13: MDMS deleteMany — verify records gone
```typescript
// Before: assert.deepEqual(result.data, [code1, code2])
// After:
assert.deepEqual(result.data, [code1, code2]);
await delay(500);
const after = await dpRoot.getList('departments', {
  pagination: { page: 1, perPage: 500 }, sort: { field: 'code', order: 'ASC' }, filter: {},
});
assert.ok(!after.data.find(r => String(r.id) === code1), `${code1} should be gone`);
assert.ok(!after.data.find(r => String(r.id) === code2), `${code2} should be gone`);
```

### Fixes 14-16: Boundary/Localization real operations
Tests use the new real DataProvider methods. Each test:
1. Creates test data
2. Calls update/delete via DataProvider
3. Re-fetches via independent read (getList or getOne)
4. Verifies the change actually happened

## Unit Tests (new)

Add to `DigitApiClient.test.ts`:
- `localizationDelete` — mocked HTTP, verify request shape + response parsing
- `boundaryUpdate` — mocked HTTP, verify request shape
- `boundaryDelete` — mocked HTTP, verify request shape
- `boundaryRelationshipDelete` — mocked HTTP, verify request shape

## Success Criteria

- 0 tautological assertions
- 0 no-op operations claiming green
- 0 conditional guards that silently skip
- Every create/update/delete test verifies state change via independent re-read
- All unit tests pass
- All integration tests pass (62+ tests, 3 consecutive runs)

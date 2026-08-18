import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitDataProvider, __setMdmsSearchAllLimitsForTesting } from './dataProvider.js';

describe('createDigitDataProvider', () => {
  let client: DigitApiClient;

  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'pg' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
  });

  afterEach(() => {
    // mdmsSearchAllBatchSize/MaxBatches are module-level state shared across
    // tests — always restore defaults so one test's override can't leak into
    // the next.
    __setMdmsSearchAllLimitsForTesting();
  });

  it('returns a DataProvider with all 9 methods', () => {
    const dp = createDigitDataProvider(client, 'pg');
    assert.ok(dp.getList);
    assert.ok(dp.getOne);
    assert.ok(dp.getMany);
    assert.ok(dp.getManyReference);
    assert.ok(dp.create);
    assert.ok(dp.update);
    assert.ok(dp.updateMany);
    assert.ok(dp.delete);
    assert.ok(dp.deleteMany);
  });

  it('throws for unknown resource in getList', async () => {
    const dp = createDigitDataProvider(client, 'pg');
    await assert.rejects(
      () => dp.getList('nonexistent', {
        pagination: { page: 1, perPage: 10 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      }),
      /Unknown resource/,
    );
  });

  it('throws for unknown resource in getOne', async () => {
    const dp = createDigitDataProvider(client, 'pg');
    await assert.rejects(
      () => dp.getOne('nonexistent', { id: '123' }),
      /Unknown resource/,
    );
  });

  it('throws for unknown resource in create', async () => {
    const dp = createDigitDataProvider(client, 'pg');
    await assert.rejects(
      () => dp.create('nonexistent', { data: {} }),
      /Unknown resource/,
    );
  });

  it('strips id and underscore-prefixed metadata from MDMS create payload', async () => {
    // Same family as the update sanitize fix from PR #40 — a default-
    // record that includes `id` (some forms set id == code on create)
    // or any normalised `_*` field would otherwise pass through
    // mdmsCreate and get rejected by additionalProperties:false.
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'mdmsCreate', async (_t: string, _s: string, _u: string, data: Record<string, unknown>) => {
      captured = data;
      return {
        id: 'new-id',
        tenantId: 'pg',
        schemaCode: 'common-masters.Department',
        uniqueIdentifier: 'DEPT_X',
        data,
        isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      };
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.create('departments', {
      data: {
        id: 'DEPT_X',
        code: 'DEPT_X',
        name: 'pw create',
        active: true,
        _isActive: true,
        _uniqueIdentifier: 'DEPT_X',
        _mdmsId: 'should-be-stripped',
      },
    });

    assert.ok(captured, 'mdmsCreate should have been called');
    assert.deepEqual(Object.keys(captured!).sort(), ['active', 'code', 'name']);
  });

  it('strips id and underscore-prefixed metadata from MDMS update payload', async () => {
    // The form payload includes the ra-admin id and the
    // _-prefixed fields normalizeMdmsRecord glued on. MDMS schemas
    // declare additionalProperties:false, so anything extra makes
    // _update fail (closes egovernments/CCRS#472).
    mock.method(client, 'mdmsSearch', async () => [
      {
        id: 'abc-id',
        tenantId: 'pg',
        schemaCode: 'common-masters.Department',
        uniqueIdentifier: 'DEPT_1',
        data: { code: 'DEPT_1', name: 'Old Name', active: true },
        isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      },
    ]);
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'mdmsUpdate', async (rec: { data: Record<string, unknown> }) => {
      captured = rec.data;
      return rec;
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.update('departments', {
      id: 'DEPT_1',
      data: {
        // Form-style payload react-admin would emit:
        id: 'DEPT_1',
        code: 'DEPT_1',
        name: 'New Name',
        active: false,
        _isActive: true,
        _uniqueIdentifier: 'DEPT_1',
        _auditDetails: { createdBy: 'x' },
        _schemaCode: 'common-masters.Department',
        _mdmsId: 'abc-id',
      },
      previousData: {} as never,
    });

    assert.ok(captured, 'mdmsUpdate should have been called');
    assert.deepEqual(Object.keys(captured!).sort(), ['active', 'code', 'name']);
    assert.equal((captured as { name: string }).name, 'New Name');
    assert.equal((captured as { active: boolean }).active, false);
  });

  it('does not let a stale reActivateEmployee in the form payload override the fresh fetch (closes #813)', async () => {
    // EmployeeEdit.tsx has no input bound to reActivateEmployee, so any value
    // present in the submitted form data is a stale leftover from whatever
    // populated the form's initial defaultValues (e.g. a just-created
    // employee's cached create-response, which never sets this field) —
    // not an intentional edit. egov-hrms/employees/_update NPEs on
    // Employee.getReActivateEmployee().booleanValue() when it's null, so this
    // silently broke editing any newly created employee.
    mock.method(client, 'employeeSearch', async () => [
      {
        id: 42,
        uuid: 'emp-uuid-1',
        code: 'LOKI3',
        tenantId: 'ke',
        reActivateEmployee: false, // fresh fetch: correct, non-null value
      },
    ]);
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'employeeUpdate', async (_t: string, employees: Record<string, unknown>[]) => {
      captured = employees[0];
      return employees;
    });

    const dp = createDigitDataProvider(client, 'ke');
    await dp.update('employees', {
      id: 'emp-uuid-1',
      data: {
        id: 'emp-uuid-1',
        uuid: 'emp-uuid-1',
        code: 'LOKI3',
        tenantId: 'ke',
        reActivateEmployee: null, // stale form payload — must not win
      },
      previousData: {} as never,
    });

    assert.ok(captured, 'employeeUpdate should have been called');
    assert.equal((captured as { reActivateEmployee: unknown }).reActivateEmployee, false);
  });

  it('uses the real mdmsCount total for a generic MDMS list, pushing isActive down to both calls (issue #953)', async () => {
    // Departments/Designations previously faked `total` from the page just fetched
    // (`offset + perPage + 1` while a full page kept coming back), so the "X of Y"
    // footer grew every time you clicked "next" instead of showing a stable total.
    // Mixing in inactive rows also guards the isActive push-down: without it, mdmsSearch
    // and mdmsCount would page through/count the inactive rows too and the total would
    // be wrong (or the fetch would cost far more round trips than necessary).
    const ACTIVE = Array.from({ length: 730 }, (_, i) => ({
      id: i,
      tenantId: 'pg',
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: `DEPT_${i}`,
      data: { code: `DEPT_${i}`, name: `Dept ${i}`, active: true },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));
    const INACTIVE = Array.from({ length: 50 }, (_, i) => ({
      id: 1000 + i,
      tenantId: 'pg',
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: `DEPT_OLD_${i}`,
      data: { code: `DEPT_OLD_${i}`, name: `Old Dept ${i}`, active: false },
      isActive: false,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));
    const bySelector = (isActive: boolean | undefined) =>
      isActive === false ? INACTIVE : isActive === true ? ACTIVE : [...ACTIVE, ...INACTIVE];

    const mdmsSearchMock = mock.method(client, 'mdmsSearch', async (_t: string, _s: string, options?: { limit?: number; offset?: number; isActive?: boolean }) => {
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      return bySelector(options?.isActive).slice(offset, offset + limit);
    });
    const mdmsCountMock = mock.method(client, 'mdmsCount', async (_t: string, _s: string, options?: { isActive?: boolean }) =>
      bySelector(options?.isActive).length);

    const dp = createDigitDataProvider(client, 'pg');
    const page1 = await dp.getList('departments', {
      pagination: { page: 1, perPage: 25 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });
    const page2 = await dp.getList('departments', {
      pagination: { page: 2, perPage: 25 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });

    assert.equal(page1.total, 730, 'total must come from the active-only count, not all 780 rows');
    assert.equal(page2.total, 730, 'total must stay stable across pages instead of growing');
    assert.equal(page1.data.length, 25);
    assert.ok(mdmsCountMock.mock.calls.length > 0, 'mdmsCount must actually be called, not left dead');
    assert.ok(
      mdmsCountMock.mock.calls.every((call) => (call.arguments[2] as { isActive?: boolean } | undefined)?.isActive === true),
      'mdmsCount must be called with isActive:true so its total agrees with what mdmsSearch pages through',
    );
    assert.ok(
      mdmsSearchMock.mock.calls.every((call) => (call.arguments[2] as { isActive?: boolean } | undefined)?.isActive === true),
      'isActive must be pushed down to mdmsSearch, not filtered client-side after fetching everything',
    );
  });

  it('does not truncate a full-tree MDMS fetch at a single page (issue #953)', async () => {
    // Complaint Types (RAINMAKER-PGR.ComplaintHierarchy) route through the
    // leafServiceDefAdapter path, which needs the WHOLE tree to tell leaves from
    // interior nodes — it used to fetch a single hardcoded `{ limit: 500 }` page, so a
    // tenant with 630 leaf rows silently lost 130 of them before filtering even ran.
    const ALL = Array.from({ length: 1230 }, (_, i) => ({
      id: i,
      tenantId: 'pg',
      schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
      uniqueIdentifier: `LEAF_${i}`,
      data: { code: `LEAF_${i}`, name: `Leaf ${i}`, department: 'DEPT_1', slaHours: 24, active: true },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));

    let calls = 0;
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, options?: { limit?: number; offset?: number }) => {
      calls += 1;
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      return ALL.slice(offset, offset + limit);
    });
    mock.method(client, 'mdmsCount', async () => ALL.length);

    const dp = createDigitDataProvider(client, 'pg');
    const result = await dp.getList('complaint-hierarchy', {
      pagination: { page: 1, perPage: 25 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.total, 1230, 'every leaf must be counted, not just the first page');
    assert.ok(calls > 1, 'must page through mdms-v2 rather than a single capped fetch');
  });

  it('dedupes overlapping rows if mdms-v2 ever returns more than requested, instead of inflating the total', async () => {
    // Regression guard for issue found in review: a server that treats `limit` as a
    // hint (or resends a boundary row) could hand back the SAME record across two
    // consecutive batches. mdmsSearchAll must dedupe by uniqueIdentifier and advance
    // offset by the page's ACTUAL length, or the total handed to react-admin inflates.
    __setMdmsSearchAllLimitsForTesting(10, 50);
    const ALL = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      tenantId: 'pg',
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: `DEPT_${i}`,
      data: { code: `DEPT_${i}`, name: `Dept ${i}`, active: true },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));

    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, options?: { limit?: number; offset?: number }) => {
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 10;
      // Deliberately re-serve the previous batch's last row instead of the clean,
      // non-overlapping slice the other tests use.
      const start = Math.max(0, offset - 1);
      return ALL.slice(start, start + limit);
    });
    mock.method(client, 'mdmsCount', async () => ALL.length);

    const dp = createDigitDataProvider(client, 'pg');
    const result = await dp.getList('departments', {
      pagination: { page: 1, perPage: 25 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.total, 25, 'overlapping rows must be deduped, not double-counted into the total');
  });

  it('sorts the full active set before paginating, not each fetched page independently', async () => {
    // mdms-v2's MdmsCriteria has no sort parameter. Ids ascending here map to names
    // DESCENDING, so a naive "sort whatever page got fetched" would only sort within
    // a page and misorder the boundary between page 1 and page 2. The batch size is
    // forced well below the 60-row fixture so the sort must actually span multiple
    // mdmsSearchAll batches — otherwise per-page and full-set sorting are identical
    // and this test can't tell them apart.
    __setMdmsSearchAllLimitsForTesting(10, 20);
    const ALL = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      tenantId: 'pg',
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: `DEPT_${i}`,
      data: { code: `DEPT_${i}`, name: `Dept ${String(59 - i).padStart(2, '0')}`, active: true },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));

    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, options?: { limit?: number; offset?: number }) => {
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;
      return ALL.slice(offset, offset + limit);
    });
    mock.method(client, 'mdmsCount', async () => ALL.length);

    const dp = createDigitDataProvider(client, 'pg');
    const page1 = await dp.getList('departments', {
      pagination: { page: 1, perPage: 25 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    });
    const page2 = await dp.getList('departments', {
      pagination: { page: 2, perPage: 25 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    });

    const names = [...page1.data, ...page2.data].map((r) => (r as { name: string }).name);
    assert.deepEqual(names, [...names].sort(), 'combined pages must be in full ascending name order');
    assert.equal(page1.total, 60);
  });

  it('throws instead of silently truncating when a schema never reaches its own reported count', async () => {
    // Simulates mdms-v2 always returning a full page (bad offset handling, an ignored
    // criterion, etc.) while mdmsCount reports far more rows than paging ever reaches,
    // so mdmsSearchAll hits its safety ceiling before catching up. Limits are forced
    // down so this doesn't have to allocate hundreds of thousands of fixture records
    // to prove the point.
    __setMdmsSearchAllLimitsForTesting(5, 3);
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, options?: { limit?: number; offset?: number }) => {
      const limit = options?.limit ?? 5;
      const offset = options?.offset ?? 0;
      return Array.from({ length: limit }, (_, i) => ({
        id: offset + i,
        tenantId: 'pg',
        schemaCode: 'common-masters.Department',
        uniqueIdentifier: `DEPT_${offset + i}`,
        data: { code: `DEPT_${offset + i}`, name: `Dept ${offset + i}`, active: true },
        isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      }));
    });
    mock.method(client, 'mdmsCount', async () => 1000);

    const dp = createDigitDataProvider(client, 'pg');
    await assert.rejects(
      () => dp.getList('departments', {
        pagination: { page: 1, perPage: 25 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      }),
      /records reported by mdmsCount/,
    );
  });
});

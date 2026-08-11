import { describe, it, beforeEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitDataProvider } from './dataProvider.js';

describe('createDigitDataProvider', () => {
  let client: DigitApiClient;

  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'pg' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
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

  it('getList(localization) does not drop rows when the list pins locales[]', async () => {
    // LocalizationList writes `{ locales: ['en_IN', 'hi_IN', …] }` as a fetcher
    // control. Matching that array against a record field stringifies it to
    // "en_in,hi_in,…" and, because no row has a `locales` column, clientFilter
    // used to return []. Dashboard (filter: {}) kept the real count.
    mock.method(client, 'localizationSearch', async (_tenant: string, locale: string) => {
      if (locale === 'en_IN') {
        return [{ code: 'HELLO', message: 'Hello', module: 'rainmaker-common', locale }];
      }
      return [{ code: 'HELLO', message: 'Bonjour', module: 'rainmaker-common', locale }];
    });

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('localization', {
      pagination: { page: 1, perPage: 25 },
      sort: { field: 'code', order: 'ASC' },
      filter: { locales: ['en_IN', 'fr_FR'] },
    });

    assert.equal(result.total, 1);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].code, 'HELLO');
    assert.equal((result.data[0] as { msg__en_IN: string }).msg__en_IN, 'Hello');
    assert.equal((result.data[0] as { msg__fr_FR: string }).msg__fr_FR, 'Bonjour');
  });

  it('uses the real mdmsCount total for a generic MDMS list, not a page-size heuristic (issue #953)', async () => {
    // Departments/Designations previously faked `total` from the page just fetched
    // (`offset + perPage + 1` while a full page kept coming back), so the "X of Y"
    // footer grew every time you clicked "next" instead of showing a stable total.
    const ALL = Array.from({ length: 730 }, (_, i) => ({
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
      const limit = options?.limit ?? 100;
      return ALL.slice(offset, offset + limit);
    });
    mock.method(client, 'mdmsCount', async () => ALL.length);

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

    assert.equal(page1.total, 730);
    assert.equal(page2.total, 730, 'total must stay stable across pages instead of growing');
    assert.equal(page1.data.length, 25);
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

    const dp = createDigitDataProvider(client, 'pg');
    const result = await dp.getList('complaint-hierarchy', {
      pagination: { page: 1, perPage: 25 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.total, 1230, 'every leaf must be counted, not just the first page');
    assert.ok(calls > 1, 'must page through mdms-v2 rather than a single capped fetch');
  });

  it('sorts the full active set before paginating, not each fetched page independently', async () => {
    // mdms-v2's MdmsCriteria has no sort parameter. Ids ascending here map to names
    // DESCENDING, so a naive "sort whatever page got fetched" would only sort within
    // a page and misorder the boundary between page 1 and page 2.
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

  it('throws instead of silently truncating when a schema never reaches a last page', async () => {
    // Simulates mdms-v2 always returning a full page (bad offset handling, an
    // ignored criterion, etc.) so mdmsSearchAll never sees a short page to stop on.
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, options?: { limit?: number }) => {
      const limit = options?.limit ?? 1000;
      return Array.from({ length: limit }, (_, i) => ({
        id: i,
        tenantId: 'pg',
        schemaCode: 'common-masters.Department',
        uniqueIdentifier: `DEPT_${i}`,
        data: { code: `DEPT_${i}`, name: `Dept ${i}`, active: true },
        isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      }));
    });

    const dp = createDigitDataProvider(client, 'pg');
    await assert.rejects(
      () => dp.getList('departments', {
        pagination: { page: 1, perPage: 25 },
        sort: { field: 'id', order: 'ASC' },
        filter: {},
      }),
      /did not finish paging/,
    );
  });

  it('getList(departments) total is exact past 500 rows and with perPage 1', async () => {
    // Dashboard cards pass perPage: 1. A 500-row cap would report 500 for a
    // 550-row master. Page through offset until a short page.
    const rows = Array.from({ length: 550 }, (_, i) => ({
      id: `id-${i}`,
      tenantId: 'ke',
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: `DEPT_${i}`,
      data: { code: `DEPT_${String(i).padStart(3, '0')}`, name: `Dept ${i}`, active: true },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));
    let calls = 0;
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, opts?: { limit?: number; offset?: number }) => {
      calls += 1;
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 100;
      return rows.slice(offset, offset + limit);
    });

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('departments', {
      pagination: { page: 1, perPage: 1 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.total, 550);
    assert.equal(result.data.length, 1);
    assert.ok(calls >= 6, `should walk past a 500-row cap, got ${calls} pages`);
  });

  it('getList(boundaries) skips PW_* stubs and still queries ADMIN', async () => {
    const stubs = Array.from({ length: 212 }, (_, i) => ({ hierarchyType: `PW_HIER_${i}` }));
    mock.method(client, 'boundaryHierarchySearch', async () => [
      ...stubs,
      { hierarchyType: 'ADMIN' },
      { hierarchyType: 'REVENUE' },
    ]);
    const queried: string[] = [];
    mock.method(client, 'boundaryRelationshipSearch', async (_t: string, ht?: string) => {
      queried.push(ht ?? '');
      if (ht === 'ADMIN') {
        return [{ tenantId: 'ke', hierarchyType: 'ADMIN', boundary: [{ code: 'KE', children: [] }] }];
      }
      return [];
    });

    const dp = createDigitDataProvider(client, 'ke.bomet');
    const result = await dp.getList('boundaries', {
      pagination: { page: 1, perPage: 25 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.total, 1);
    assert.equal(result.data[0].id, 'KE');
    assert.ok(!queried.some((ht) => /^PW_/i.test(ht)), 'must not query PW_* trees');
    assert.ok(queried.includes('ADMIN'));
    assert.ok(queried.includes('REVENUE'));
  });
});

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

  it('resolves hierarchyType/levelCode for a new complaint type from the tenant\'s actual hierarchy definition, not a hardcoded literal', async () => {
    // The tenant's real definition uses non-default names — proves the
    // values come from MDMS, not a 'PGR'/'SUB_TYPE' literal (CCRS#1719 review).
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition') {
        return [{
          id: 'def-1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'CUSTOM',
          data: { hierarchyType: 'CUSTOM', levels: [
            { levelCode: 'CATEGORY', isLeafServiceCode: false },
            { levelCode: 'LEAF_TYPE', isLeafServiceCode: true },
          ] },
          isActive: true,
          auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
        }];
      }
      return [];
    });
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'mdmsCreate', async (_t: string, _s: string, _u: string, data: Record<string, unknown>) => {
      captured = data;
      return {
        id: 'new-id', tenantId: 'pg', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
        uniqueIdentifier: 'CUSTOM.NEW_TYPE', data, isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      };
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.create('complaint-hierarchy', {
      data: { serviceCode: 'NEW_TYPE', name: 'New Type', department: 'DEPT_X', slaHours: 24, active: true },
    });

    assert.ok(captured, 'mdmsCreate should have been called');
    assert.equal(captured!.hierarchyType, 'CUSTOM');
    assert.equal(captured!.levelCode, 'LEAF_TYPE');
  });

  it('falls back to PGR/SUB_TYPE for a new complaint type when the tenant has no hierarchy definition yet', async () => {
    mock.method(client, 'mdmsSearch', async () => []);
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'mdmsCreate', async (_t: string, _s: string, _u: string, data: Record<string, unknown>) => {
      captured = data;
      return {
        id: 'new-id', tenantId: 'pg', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
        uniqueIdentifier: 'PGR.NEW_TYPE', data, isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      };
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.create('complaint-hierarchy', {
      data: { serviceCode: 'NEW_TYPE', name: 'New Type', department: 'DEPT_X', slaHours: 24, active: true },
    });

    assert.ok(captured, 'mdmsCreate should have been called');
    assert.equal(captured!.hierarchyType, 'PGR');
    assert.equal(captured!.levelCode, 'SUB_TYPE');
  });

  it('does not overwrite an existing complaint type\'s hierarchyType/levelCode on update', async () => {
    // The Complaint Type edit form never renders these fields, so an edit
    // that only changes e.g. slaHours must not silently reset them to a
    // default — dataProvider.update() should preserve whatever the
    // existing record already has (CCRS#1719 review).
    mock.method(client, 'mdmsSearch', async () => [{
      id: 'abc-id', tenantId: 'pg', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
      uniqueIdentifier: 'CUSTOM.EXISTING_TYPE',
      data: {
        hierarchyType: 'CUSTOM', levelCode: 'LEAF_TYPE', code: 'EXISTING_TYPE',
        name: 'Existing Type', department: 'DEPT_X', slaHours: 24, active: true,
      },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }]);
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'mdmsUpdate', async (rec: { data: Record<string, unknown> }) => {
      captured = rec.data;
      return rec;
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.update('complaint-hierarchy', {
      id: 'EXISTING_TYPE',
      data: { serviceCode: 'EXISTING_TYPE', name: 'Existing Type', department: 'DEPT_X', slaHours: 48, active: true },
      previousData: { id: 'EXISTING_TYPE' },
    });

    assert.ok(captured, 'mdmsUpdate should have been called');
    assert.equal(captured!.hierarchyType, 'CUSTOM');
    assert.equal(captured!.levelCode, 'LEAF_TYPE');
    assert.equal(captured!.slaHours, 48);
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

  it('getList(departments) reports the real total, not perPage+1', async () => {
    // 15 active rows, list page size 10. The old MDMS path fetched `limit: 10`
    // and set total = 11 whenever the page was full, so the badge read 11
    // ("1-10 of 11") instead of 15.
    const rows = Array.from({ length: 15 }, (_, i) => ({
      id: `id-${i}`,
      tenantId: 'ke',
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: `DEPT_${i}`,
      data: { code: `DEPT_${i}`, name: `Dept ${i}`, active: true },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, opts?: { limit?: number; offset?: number }) => {
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 100;
      return rows.slice(offset, offset + limit);
    });

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('departments', {
      pagination: { page: 1, perPage: 10 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.total, 15);
    assert.equal(result.data.length, 10);
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

  it('getList(gender-types) uses server paging instead of fetching the whole master', async () => {
    const calls: Array<{ limit?: number; offset?: number }> = [];
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, opts?: { limit?: number; offset?: number }) => {
      calls.push({ limit: opts?.limit, offset: opts?.offset });
      return Array.from({ length: 10 }, (_, i) => ({
        id: `id-${i}`,
        tenantId: 'ke',
        schemaCode: 'common-masters.GenderType',
        uniqueIdentifier: `G_${i}`,
        data: { code: `G_${i}` },
        isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      }));
    });

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('gender-types', {
      pagination: { page: 2, perPage: 10 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { limit: 10, offset: 10 });
    assert.equal(result.data.length, 10);
    assert.equal(result.total, 21);
  });
});

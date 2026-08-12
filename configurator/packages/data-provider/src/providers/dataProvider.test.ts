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

  it('with two active hierarchy definitions, picks whichever one has the MOST existing leaf usage — not just any', async () => {
    // Reproduces the exact live-observed state (CCRS#1713 follow-up): a
    // leftover 4-level "test" hierarchyType with its own one-off leaf sitting
    // alongside the real 2-level one backing hundreds of real complaint
    // types, both isActive:true, MDMS returning the test one FIRST. An
    // earlier version of this fix used Set-based "has ANY usage" instead of
    // counting — since the stray hierarchyType has exactly one real leaf too
    // (not zero), that tied with the dominant one and array order silently
    // decided the winner again, live, on a real create. This sample gives
    // BOTH candidates non-zero usage, with "PGR" dominant, specifically to
    // catch that regression.
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition') {
        return [
          {
            id: 'def-test', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR_TEST',
            data: { hierarchyType: 'PGR_TEST', levels: [
              { levelCode: 'AUTHORITY_TYPE', isLeafServiceCode: false },
              { levelCode: 'MAIN_CATEGORY', isLeafServiceCode: false },
              { levelCode: 'SECTOR', isLeafServiceCode: false },
              { levelCode: 'SUB_TYPE', isLeafServiceCode: true },
            ] },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 999, lastModifiedTime: 999 },
          },
          {
            id: 'def-real', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR',
            data: { hierarchyType: 'PGR', levels: [
              { levelCode: 'CATEGORY', isLeafServiceCode: false },
              { levelCode: 'SUB_TYPE', isLeafServiceCode: true },
            ] },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
          },
        ];
      }
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchy') {
        // "PGR_TEST" has exactly one real leaf (matches live: not zero —
        // presence-only disambiguation would tie here). "PGR" has several.
        return [
          { id: 'leaf-test-1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR_TEST.STRAY',
            data: { hierarchyType: 'PGR_TEST', code: 'STRAY' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.EXISTING_1',
            data: { hierarchyType: 'PGR', code: 'EXISTING_1' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-2', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.EXISTING_2',
            data: { hierarchyType: 'PGR', code: 'EXISTING_2' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-3', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.EXISTING_3',
            data: { hierarchyType: 'PGR', code: 'EXISTING_3' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
        ];
      }
      return [];
    });
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

  it('with two active hierarchy definitions and no existing usage of either, picks the earliest-created one', async () => {
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition') {
        return [
          {
            id: 'def-newer', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'NEWER',
            data: { hierarchyType: 'NEWER', levels: [{ levelCode: 'LEAF', isLeafServiceCode: true }] },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 500, lastModifiedTime: 500 },
          },
          {
            id: 'def-older', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'OLDER',
            data: { hierarchyType: 'OLDER', levels: [{ levelCode: 'LEAF', isLeafServiceCode: true }] },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 100, lastModifiedTime: 100 },
          },
        ];
      }
      // A fresh tenant mid-migration between two definitions — nothing
      // created under either one yet.
      return [];
    });
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'mdmsCreate', async (_t: string, _s: string, _u: string, data: Record<string, unknown>) => {
      captured = data;
      return {
        id: 'new-id', tenantId: 'pg', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
        uniqueIdentifier: 'OLDER.NEW_TYPE', data, isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      };
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.create('complaint-hierarchy', {
      data: { serviceCode: 'NEW_TYPE', name: 'New Type', department: 'DEPT_X', slaHours: 24, active: true },
    });

    assert.ok(captured, 'mdmsCreate should have been called');
    assert.equal(captured!.hierarchyType, 'OLDER');
    assert.equal(captured!.levelCode, 'LEAF');
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
});

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

  it('creates a non-root boundary relationship in the login tenant with its direct parent', async () => {
    mock.method(client, 'boundaryHierarchySearch', async (tenantId: string, hierarchyType?: string) => {
      assert.equal(tenantId, 'ke');
      assert.equal(hierarchyType, 'CUSTOM');
      return [{
        tenantId,
        hierarchyType,
        boundaryHierarchy: [
          { boundaryType: 'County', parentBoundaryType: null, active: true },
          { boundaryType: 'Ward', parentBoundaryType: 'County', active: true },
        ],
      }];
    });
    mock.method(client, 'boundaryRelationshipSearch', async (tenantId: string, hierarchyType?: string) => {
      assert.equal(tenantId, 'ke');
      assert.equal(hierarchyType, 'CUSTOM');
      return [{
        tenantId,
        hierarchyType,
        boundary: [{ code: 'COUNTY_1', boundaryType: 'County', children: [] }],
      }];
    });
    let entityTenant = '';
    mock.method(client, 'boundaryCreate', async (tenantId: string) => {
      entityTenant = tenantId;
      return [];
    });
    let relationshipArgs: unknown[] = [];
    mock.method(client, 'boundaryRelationshipCreate', async (...args: unknown[]) => {
      relationshipArgs = args;
      return {};
    });

    const dp = createDigitDataProvider(client, 'ke');
    await dp.create('boundaries', {
      data: {
        code: 'WARD_1',
        hierarchyType: 'CUSTOM',
        boundaryType: 'Ward',
        parent: 'COUNTY_1',
        // Must never override the tenant captured from authentication.
        tenantId: 'ke.wrong',
      },
    });

    assert.equal(entityTenant, 'ke');
    assert.deepEqual(relationshipArgs, ['ke', 'WARD_1', 'CUSTOM', 'Ward', 'COUNTY_1']);
  });

  it('rejects a non-root boundary without a parent before creating the entity', async () => {
    mock.method(client, 'boundaryHierarchySearch', async () => [{
      tenantId: 'ke',
      hierarchyType: 'CUSTOM',
      boundaryHierarchy: [
        { boundaryType: 'County', parentBoundaryType: null, active: true },
        { boundaryType: 'Ward', parentBoundaryType: 'County', active: true },
      ],
    }]);
    let entityCreateCalls = 0;
    mock.method(client, 'boundaryCreate', async () => {
      entityCreateCalls += 1;
      return [];
    });

    const dp = createDigitDataProvider(client, 'ke');
    await assert.rejects(
      () => dp.create('boundaries', {
        data: { code: 'WARD_1', hierarchyType: 'CUSTOM', boundaryType: 'Ward' },
      }),
      /Parent boundary of type County is required/,
    );
    assert.equal(entityCreateCalls, 0);
  });

  it('rejects a missing hierarchy instead of silently defaulting to ADMIN', async () => {
    let hierarchySearchCalls = 0;
    let entityCreateCalls = 0;
    mock.method(client, 'boundaryHierarchySearch', async () => {
      hierarchySearchCalls += 1;
      return [];
    });
    mock.method(client, 'boundaryCreate', async () => {
      entityCreateCalls += 1;
      return [];
    });

    const dp = createDigitDataProvider(client, 'ke');
    await assert.rejects(
      () => dp.create('boundaries', {
        data: { code: 'WARD_1', boundaryType: 'Ward', parent: 'COUNTY_1' },
      }),
      /Boundary hierarchy is required/,
    );
    assert.equal(hierarchySearchCalls, 0);
    assert.equal(entityCreateCalls, 0);
  });

  it('creates a root boundary without a parent', async () => {
    mock.method(client, 'boundaryHierarchySearch', async () => [{
      tenantId: 'ke',
      hierarchyType: 'CUSTOM',
      boundaryHierarchy: [{ boundaryType: 'County', parentBoundaryType: null, active: true }],
    }]);
    mock.method(client, 'boundaryCreate', async () => []);
    let relationshipArgs: unknown[] = [];
    mock.method(client, 'boundaryRelationshipCreate', async (...args: unknown[]) => {
      relationshipArgs = args;
      return {};
    });

    const dp = createDigitDataProvider(client, 'ke');
    await dp.create('boundaries', {
      data: { code: 'COUNTY_1', hierarchyType: 'CUSTOM', boundaryType: 'County' },
    });

    assert.deepEqual(relationshipArgs, ['ke', 'COUNTY_1', 'CUSTOM', 'County', null]);
  });

  it('rejects a parent from the wrong hierarchy level before creating the entity', async () => {
    mock.method(client, 'boundaryHierarchySearch', async () => [{
      tenantId: 'ke',
      hierarchyType: 'CUSTOM',
      boundaryHierarchy: [
        { boundaryType: 'County', parentBoundaryType: null, active: true },
        { boundaryType: 'Ward', parentBoundaryType: 'County', active: true },
      ],
    }]);
    mock.method(client, 'boundaryRelationshipSearch', async () => [{
      tenantId: 'ke',
      hierarchyType: 'CUSTOM',
      boundary: [{ code: 'NOT_A_COUNTY', boundaryType: 'Ward', children: [] }],
    }]);
    let entityCreateCalls = 0;
    mock.method(client, 'boundaryCreate', async () => {
      entityCreateCalls += 1;
      return [];
    });

    const dp = createDigitDataProvider(client, 'ke');
    await assert.rejects(
      () => dp.create('boundaries', {
        data: {
          code: 'WARD_1',
          hierarchyType: 'CUSTOM',
          boundaryType: 'Ward',
          parent: 'NOT_A_COUNTY',
        },
      }),
      /must have boundary type County/,
    );
    assert.equal(entityCreateCalls, 0);
  });

  it('resumes relationship creation when the entity already exists from a partial attempt', async () => {
    mock.method(client, 'boundaryHierarchySearch', async () => [{
      tenantId: 'ke',
      hierarchyType: 'CUSTOM',
      boundaryHierarchy: [{ boundaryType: 'County', parentBoundaryType: null, active: true }],
    }]);
    mock.method(client, 'boundaryCreate', async () => {
      throw new Error('DUPLICATE_RECORD: Boundary already exists');
    });
    mock.method(client, 'boundarySearch', async () => [{ tenantId: 'ke', code: 'COUNTY_1' }]);
    let relationshipCreateCalls = 0;
    mock.method(client, 'boundaryRelationshipCreate', async () => {
      relationshipCreateCalls += 1;
      return {};
    });

    const dp = createDigitDataProvider(client, 'ke');
    await dp.create('boundaries', {
      data: { code: 'COUNTY_1', hierarchyType: 'CUSTOM', boundaryType: 'County' },
    });

    assert.equal(relationshipCreateCalls, 1);
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
    const requestedLimits: number[] = [];
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, opts?: { limit?: number; offset?: number }) => {
      requestedLimits.push(opts?.limit ?? 100);
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 100;
      return rows.slice(offset, offset + limit);
    });
    mock.method(client, 'mdmsCount', async () => rows.length);

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('departments', {
      pagination: { page: 1, perPage: 1 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.total, 550);
    assert.equal(result.data.length, 1);
    assert.ok(requestedLimits.some((limit) => limit > 500), 'must not retain the old 500-row cap');
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

  it('getList(gender-types) sorts a shuffled generic-MDMS response across pages', async () => {
    // MDMS v2 has no ordering criterion, so rows arrive in arbitrary order and
    // sorting must span the whole master, not the current page.
    const codes = ['DELTA', 'ALPHA', 'ECHO', 'CHARLIE', 'BRAVO'];
    const rows = codes.map((code, i) => ({
      id: `id-${i}`,
      tenantId: 'ke',
      schemaCode: 'common-masters.GenderType',
      uniqueIdentifier: code,
      data: { code },
      isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, opts?: { limit?: number; offset?: number }) => {
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 100;
      return rows.slice(offset, offset + limit);
    });
    mock.method(client, 'mdmsCount', async () => rows.length);

    const dp = createDigitDataProvider(client, 'ke');
    const asc = await dp.getList('gender-types', {
      pagination: { page: 1, perPage: 2 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });
    assert.deepEqual(asc.data.map((r) => r.code), ['ALPHA', 'BRAVO']);
    assert.equal(asc.total, 5);

    const descPage2 = await dp.getList('gender-types', {
      pagination: { page: 2, perPage: 2 },
      sort: { field: 'code', order: 'DESC' },
      filter: {},
    });
    assert.deepEqual(descPage2.data.map((r) => r.code), ['CHARLIE', 'BRAVO']);
    assert.equal(descPage2.total, 5);
  });

  // --- CCRS #1923: one record per react-admin id ---------------------------
  //
  // The state tenant's records are concatenated with every city tenant's, and
  // DIGIT does not require a boundary `hierarchyType` or `code` to be unique
  // across tenants. On bomet (`ke`) that yields SEVEN hierarchies called ADMIN
  // and CITY_001/WARD_001 defined under two city tenants. Downstream, every
  // dropdown built from these lists renders one <SelectItem value={id}> per
  // record — and Radix treats items sharing a value as the same selection, so
  // the operator saw seven ticked "ADMIN" rows and a trigger reading
  // "ADMINADMINADMIN…".

  it('getList(boundary-hierarchies) returns one record per hierarchyType across tenants', async () => {
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema !== 'tenant.tenants') return [];
      return ['ke.india', 'ke.mycitynew'].map((code) => ({
        id: code, tenantId: 'ke', schemaCode: schema, uniqueIdentifier: code,
        data: { code }, isActive: true,
      }));
    });
    // Every tenant defines its own "ADMIN"; only ke.india adds "KE-ADMIN".
    mock.method(client, 'boundaryHierarchySearch', async (tenantId: string) => {
      const types = tenantId === 'ke.india' ? ['ADMIN', 'KE-ADMIN'] : ['ADMIN'];
      return types.map((hierarchyType) => ({
        tenantId,
        hierarchyType,
        boundaryHierarchy: [{ boundaryType: 'County', parentBoundaryType: null, active: true }],
      }));
    });

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('boundary-hierarchies', {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'hierarchyType', order: 'ASC' },
      filter: {},
    });

    assert.deepEqual(result.data.map((r) => r.id), ['ADMIN', 'KE-ADMIN']);
    assert.equal(result.total, 2);
    // Keep-FIRST: the survivor must be the session tenant's own definition,
    // not whichever sub-tenant happened to be fetched last.
    assert.equal(result.data.find((r) => r.id === 'ADMIN')?.tenantId, 'ke');
  });

  it('getList(boundaries) returns one record per code when two tenants seed the same code', async () => {
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema !== 'tenant.tenants') return [];
      return ['ke.mycitynew', 'ke.hajbvfg'].map((code) => ({
        id: code, tenantId: 'ke', schemaCode: schema, uniqueIdentifier: code,
        data: { code }, isActive: true,
      }));
    });
    mock.method(client, 'boundaryHierarchySearch', async () => [{
      hierarchyType: 'ADMIN',
      boundaryHierarchy: [{ boundaryType: 'County', parentBoundaryType: null, active: true }],
    }]);
    // ke owns BOMET; the two city tenants BOTH seed CITY_001.
    mock.method(client, 'boundaryRelationshipSearch', async (tenantId: string) => {
      const code = tenantId === 'ke' ? 'BOMET' : 'CITY_001';
      return [{
        tenantId,
        hierarchyType: 'ADMIN',
        boundary: [{ code, boundaryType: 'County', name: code, children: [] }],
      }];
    });

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('boundaries', {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    });

    assert.deepEqual(result.data.map((r) => r.id), ['BOMET', 'CITY_001']);
    assert.equal(result.total, 2);
    assert.equal(result.data.find((r) => r.id === 'CITY_001')?.tenantId, 'ke.mycitynew');
  });

  it('getList(access-roles) returns one record per role code', async () => {
    // egov-accesscontrol merges the tenant's roles with the state tenant's, so
    // a role defined at both levels comes back twice.
    mock.method(client, 'accessRolesSearch', async () => [
      { code: 'HRMS_ADMIN', name: 'HRMS Admin', tenantId: 'ke' },
      { code: 'HRMS_ADMIN', name: 'HRMS Admin', tenantId: 'ke.bomet' },
      { code: 'LOC_ADMIN', name: 'Localisation admin', tenantId: 'ke' },
      { code: 'LOC_ADMIN', name: 'Localisation admin', tenantId: 'ke.bomet' },
      { code: 'MDMS_ADMIN', name: 'MDMS ADMIN', tenantId: 'ke' },
    ]);

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('access-roles', {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    });

    assert.deepEqual(result.data.map((r) => r.id), ['HRMS_ADMIN', 'LOC_ADMIN', 'MDMS_ADMIN']);
    assert.equal(result.total, 3);
  });

  it('keeps records whose id extraction failed, under distinct synthetic ids', async () => {
    // Two records missing the configured idField both normalize to id ''. They
    // are as broken as a real duplicate — react-admin keys on id — but they are
    // NOT the same record, so dropping the later one would hide a real row.
    // Each repeat gets its own id instead.
    mock.method(client, 'accessRolesSearch', async () => [
      { name: 'No code at all', tenantId: 'ke' },
      { name: 'Also no code', tenantId: 'ke' },
      { code: 'MDMS_ADMIN', name: 'MDMS ADMIN', tenantId: 'ke' },
    ]);

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('access-roles', {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.data.length, 3, 'no row may be dropped for lacking an id');
    const ids = result.data.map((r) => String(r.id));
    assert.equal(new Set(ids).size, 3, 'react-admin needs one id per record');
    // The names survive intact — only the id was synthesized.
    assert.deepEqual(
      result.data.map((r) => r.name).sort(),
      ['Also no code', 'MDMS ADMIN', 'No code at all'],
    );
  });

  it('does not let a synthetic blank id swallow a real record that collides with it', async () => {
    // A real record whose code happens to equal the synthetic id must survive,
    // even though it is listed AFTER the blank-id records that generate one.
    mock.method(client, 'accessRolesSearch', async () => [
      { name: 'No code at all', tenantId: 'ke' },
      { name: 'Also no code', tenantId: 'ke' },
      { code: '#blank-1', name: 'Real role oddly named', tenantId: 'ke' },
    ]);

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('access-roles', {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    });

    assert.equal(result.data.length, 3);
    assert.equal(new Set(result.data.map((r) => String(r.id))).size, 3);
    assert.ok(
      result.data.some((r) => r.name === 'Real role oddly named'),
      'the real record must not be mistaken for a duplicate of a synthetic id',
    );
  });

  it('does NOT collapse distinct records that merely share a display name', () => {
    // The dedupe key is the id, never the label — two boundaries called
    // "Central" in different counties are two real choices.
    mock.method(client, 'boundaryHierarchySearch', async () => [{
      hierarchyType: 'ADMIN',
      boundaryHierarchy: [{ boundaryType: 'Ward', parentBoundaryType: null, active: true }],
    }]);
    mock.method(client, 'boundaryRelationshipSearch', async () => [{
      tenantId: 'ke',
      hierarchyType: 'ADMIN',
      boundary: [
        { code: 'BOMET_CENTRAL', boundaryType: 'Ward', name: 'Central', children: [] },
        { code: 'NAIROBI_CENTRAL', boundaryType: 'Ward', name: 'Central', children: [] },
      ],
    }]);

    const dp = createDigitDataProvider(client, 'ke.bomet');
    return dp.getList('boundaries', {
      pagination: { page: 1, perPage: 100 },
      sort: { field: 'code', order: 'ASC' },
      filter: {},
    }).then((result) => {
      assert.deepEqual(result.data.map((r) => r.id), ['BOMET_CENTRAL', 'NAIROBI_CENTRAL']);
    });
  });
});

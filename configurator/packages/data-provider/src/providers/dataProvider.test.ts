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
        // Both definitions' leaf level is SUB_TYPE, so levelCode must be set
        // here for the count to match each candidate's own leaf defaults.
        return [
          { id: 'leaf-test-1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR_TEST.STRAY',
            data: { hierarchyType: 'PGR_TEST', levelCode: 'SUB_TYPE', code: 'STRAY' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.EXISTING_1',
            data: { hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'EXISTING_1' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-2', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.EXISTING_2',
            data: { hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'EXISTING_2' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-3', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.EXISTING_3',
            data: { hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'EXISTING_3' }, isActive: true,
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

  it('counts only ACTIVE rows at each candidate\'s own leaf level — inactive leaves and interior nodes don\'t count as usage', async () => {
    // Reviewer finding on CCRS#1724: the usage sample must not count
    // soft-deleted (isActive:false) rows or interior/non-leaf rows
    // (CATEGORY/SECTOR/etc) — either can inflate a hierarchyType's raw row
    // count without reflecting real complaint-type usage. HTYPE_B here has
    // MORE total rows than HTYPE_A (6 vs 2), but only 1 of them is a
    // genuine active leaf — the rest are inactive leaves and active
    // interior nodes that must be excluded. HTYPE_A, with fewer total rows
    // but 2 genuine active leaves, must win.
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition') {
        return [
          {
            id: 'def-a', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_A',
            data: { hierarchyType: 'HTYPE_A', levels: [
              { levelCode: 'CATEGORY', isLeafServiceCode: false },
              { levelCode: 'SUB_TYPE', isLeafServiceCode: true },
            ] },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
          },
          {
            id: 'def-b', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_B',
            data: { hierarchyType: 'HTYPE_B', levels: [
              { levelCode: 'CATEGORY', isLeafServiceCode: false },
              { levelCode: 'SUB_TYPE', isLeafServiceCode: true },
            ] },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 2, lastModifiedTime: 2 },
          },
        ];
      }
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchy') {
        return [
          // HTYPE_A: 2 genuine active leaves — the real dominant one.
          { id: 'a1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_A.A1',
            data: { hierarchyType: 'HTYPE_A', levelCode: 'SUB_TYPE', code: 'A1' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'a2', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_A.A2',
            data: { hierarchyType: 'HTYPE_A', levelCode: 'SUB_TYPE', code: 'A2' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          // HTYPE_B: only 1 genuine active leaf...
          { id: 'b1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_B.B1',
            data: { hierarchyType: 'HTYPE_B', levelCode: 'SUB_TYPE', code: 'B1' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          // ...plus INACTIVE leaves that must NOT count...
          { id: 'b-old-1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_B.B_OLD_1',
            data: { hierarchyType: 'HTYPE_B', levelCode: 'SUB_TYPE', code: 'B_OLD_1' }, isActive: false,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'b-old-2', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_B.B_OLD_2',
            data: { hierarchyType: 'HTYPE_B', levelCode: 'SUB_TYPE', code: 'B_OLD_2' }, isActive: false,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'b-old-3', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_B.B_OLD_3',
            data: { hierarchyType: 'HTYPE_B', levelCode: 'SUB_TYPE', code: 'B_OLD_3' }, isActive: false,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          // ...plus ACTIVE but INTERIOR (non-leaf) rows that must NOT count either.
          { id: 'b-cat-1', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_B.B_CAT_1',
            data: { hierarchyType: 'HTYPE_B', levelCode: 'CATEGORY', code: 'B_CAT_1' }, isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'b-cat-2', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'HTYPE_B.B_CAT_2',
            data: { hierarchyType: 'HTYPE_B', levelCode: 'CATEGORY', code: 'B_CAT_2' }, isActive: true,
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
        uniqueIdentifier: 'HTYPE_A.NEW_TYPE', data, isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      };
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.create('complaint-hierarchy', {
      data: { serviceCode: 'NEW_TYPE', name: 'New Type', department: 'DEPT_X', slaHours: 24, active: true },
    });

    assert.ok(captured, 'mdmsCreate should have been called');
    assert.equal(captured!.hierarchyType, 'HTYPE_A');
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

  it('does not treat a definition with a missing createdTime as the oldest', async () => {
    // Reviewer finding on CCRS#1724: `auditDetails` is optional on
    // MdmsRecord — a definition with no createdTime must not win the
    // "oldest" tiebreak over one with a real, known creation time it has
    // no evidence of actually predating. NO_TIMESTAMP has no auditDetails
    // at all; WITH_TIMESTAMP has a real, later one — WITH_TIMESTAMP must
    // still be picked, since it's the only one with actual evidence.
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition') {
        return [
          {
            id: 'def-no-ts', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'NO_TIMESTAMP',
            data: { hierarchyType: 'NO_TIMESTAMP', levels: [{ levelCode: 'LEAF', isLeafServiceCode: true }] },
            isActive: true,
          },
          {
            id: 'def-with-ts', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'WITH_TIMESTAMP',
            data: { hierarchyType: 'WITH_TIMESTAMP', levels: [{ levelCode: 'LEAF', isLeafServiceCode: true }] },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 500, lastModifiedTime: 500 },
          },
        ];
      }
      // Nothing created under either one yet — forces the oldest-created
      // tiebreak path.
      return [];
    });
    let captured: Record<string, unknown> | null = null;
    mock.method(client, 'mdmsCreate', async (_t: string, _s: string, _u: string, data: Record<string, unknown>) => {
      captured = data;
      return {
        id: 'new-id', tenantId: 'pg', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
        uniqueIdentifier: 'WITH_TIMESTAMP.NEW_TYPE', data, isActive: true,
        auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
      };
    });

    const dp = createDigitDataProvider(client, 'pg');
    await dp.create('complaint-hierarchy', {
      data: { serviceCode: 'NEW_TYPE', name: 'New Type', department: 'DEPT_X', slaHours: 24, active: true },
    });

    assert.ok(captured, 'mdmsCreate should have been called');
    assert.equal(captured!.hierarchyType, 'WITH_TIMESTAMP');
    assert.equal(captured!.levelCode, 'LEAF');
  });

  it('falls back to the oldest known definition, not the hardcoded bootstrap constants, when the usage-count lookup itself fails', async () => {
    // Reviewer finding on CCRS#1724: the original implementation ran the
    // `definitions` fetch and the usage-count fetch inside the SAME
    // try/catch, so a transient failure in the usage lookup discarded the
    // already-successful `definitions` fetch and fell through to the
    // hardcoded FALLBACK_HIERARCHY_TYPE/FALLBACK_LEAF_LEVEL_CODE — which
    // match neither real definition, reproducing the exact
    // invisible-complaint-type bug (CCRS#1713) this disambiguation exists
    // to fix. It must degrade to the oldest known definition instead.
    // The leaf-adapter create path re-fetches via this same schema AFTER
    // mdmsCreate succeeds (to return the freshly created row) — only the
    // FIRST call, resolveNewLeafDefaults's own usage-count lookup, should
    // fail; the post-create re-fetch must still succeed like real MDMS
    // would on a retry.
    let hierarchySearches = 0;
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
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchy') {
        hierarchySearches += 1;
        if (hierarchySearches === 1) throw new Error('simulated transient MDMS failure');
        return [];
      }
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

  it('seeds departments from the legacy singular department field on read, for records saved before departments existed', async () => {
    // Reviewer finding on CCRS#1724: a pre-existing complaint type only
    // ever had `department` — `departments` is a new field those rows
    // never populated. Without a read-side fallback, the Edit form's
    // required Departments multi-select loads empty, blocking Save until
    // the operator re-picks a department blind.
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchy') {
        return [
          {
            id: 'leaf-legacy', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.LEGACY',
            data: {
              hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'LEGACY', name: 'Legacy Type',
              parentCode: 'CAT', department: 'DEPT_OLD', slaHours: 24,
            },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
          },
        ];
      }
      return [];
    });

    const dp = createDigitDataProvider(client, 'pg');
    const { data } = await dp.getList('complaint-hierarchy', {
      pagination: { page: 1, perPage: 10 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    });

    assert.equal(data.length, 1);
    assert.deepEqual(data[0].departments, ['DEPT_OLD']);
    assert.equal(data[0].department, 'DEPT_OLD');
  });

  it('does not seed the "NA" sentinel (or whitespace) as a real department, but trims a genuine value', async () => {
    // Reviewer finding on CCRS#1724: the bulk-import path
    // (ComplaintHierarchySetup) stamps `department: 'NA'` for rows with no
    // real department. Seeding that into `departments` would show a fake
    // selected department and let it be silently saved as the primary
    // department on an unrelated edit. Case-insensitive and whitespace
    // variants must all be treated as absent; a genuine value is trimmed
    // but keeps its case.
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema === 'RAINMAKER-PGR.ComplaintHierarchy') {
        return [
          { id: 'leaf-na', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.NA_ROW',
            data: { hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'NA_ROW', department: 'na', slaHours: 24 },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-blank', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.BLANK_ROW',
            data: { hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'BLANK_ROW', department: '   ', slaHours: 24 },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
          { id: 'leaf-real', tenantId: 'pg', schemaCode: schema, uniqueIdentifier: 'PGR.REAL_ROW',
            data: { hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'REAL_ROW', department: '  DEPT_X  ', slaHours: 24 },
            isActive: true,
            auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 } },
        ];
      }
      return [];
    });

    const dp = createDigitDataProvider(client, 'pg');
    const { data } = await dp.getList('complaint-hierarchy', {
      pagination: { page: 1, perPage: 10 },
      sort: { field: 'name', order: 'ASC' },
      filter: {},
    });

    const byId = Object.fromEntries(data.map((r) => [r.id, r]));
    assert.deepEqual(byId['PGR.NA_ROW'].departments, []);
    assert.deepEqual(byId['PGR.BLANK_ROW'].departments, []);
    assert.deepEqual(byId['PGR.REAL_ROW'].departments, ['DEPT_X']);
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

  it('resyncs departments when the datagrid\'s legacy single-department cell editor changes department', async () => {
    // Reviewer finding on CCRS#1724 (flagged outside the diff, on
    // ComplaintTypeList.tsx): the datagrid's inline "Department" cell
    // editor predates `departments` and only submits
    // {...record, department: newVal} — leaving the record's existing
    // `departments` array untouched in the payload. Without a resync,
    // `department` (routing) and `departments` (what List/Show render,
    // preferring it whenever non-empty) would silently diverge: the cell
    // shows no visible change while routing changes underneath.
    mock.method(client, 'mdmsSearch', async () => [{
      id: 'abc-id', tenantId: 'pg', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
      uniqueIdentifier: 'PGR.MULTI_DEPT',
      data: {
        hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'MULTI_DEPT',
        name: 'Multi Dept Type', department: 'DEPT_A', departments: ['DEPT_A', 'DEPT_B'],
        slaHours: 24, active: true,
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
    // Mirrors what the datagrid's inline cell editor actually submits:
    // the full existing (adapted) record, spread, with only `department`
    // changed — `departments` carried through byte-for-byte unchanged.
    await dp.update('complaint-hierarchy', {
      id: 'MULTI_DEPT',
      data: {
        serviceCode: 'MULTI_DEPT', name: 'Multi Dept Type',
        department: 'DEPT_C', departments: ['DEPT_A', 'DEPT_B'],
        slaHours: 24, active: true,
      },
      previousData: { id: 'MULTI_DEPT' },
    });

    assert.ok(captured, 'mdmsUpdate should have been called');
    assert.equal(captured!.department, 'DEPT_C');
    assert.deepEqual(captured!.departments, ['DEPT_C']);
  });

  it('does not touch departments when only the multi-select itself changes (department unchanged)', async () => {
    // Safety-net for the resync above: it must key off `department`
    // actually changing, not fire on every update and clobber a genuine
    // departments edit made through the dedicated Edit form's multi-select
    // (where `department` stays derived from — and equal to — departments[0]).
    mock.method(client, 'mdmsSearch', async () => [{
      id: 'abc-id', tenantId: 'pg', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
      uniqueIdentifier: 'PGR.MULTI_DEPT2',
      data: {
        hierarchyType: 'PGR', levelCode: 'SUB_TYPE', code: 'MULTI_DEPT2',
        name: 'Multi Dept Type 2', department: 'DEPT_A', departments: ['DEPT_A'],
        slaHours: 24, active: true,
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
      id: 'MULTI_DEPT2',
      data: {
        serviceCode: 'MULTI_DEPT2', name: 'Multi Dept Type 2',
        department: 'DEPT_A', departments: ['DEPT_A', 'DEPT_C'],
        slaHours: 24, active: true,
      },
      previousData: { id: 'MULTI_DEPT2' },
    });

    assert.ok(captured, 'mdmsUpdate should have been called');
    assert.equal(captured!.department, 'DEPT_A');
    assert.deepEqual(captured!.departments, ['DEPT_A', 'DEPT_C']);
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
});

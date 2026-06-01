// Verifications for the MDMS / configurator surface fixes. Pure API
// tests where we can — the configurator just shells out to mdms-v2 with
// the same payload shape we're checking here.
import { test, expect } from '@playwright/test';
import { loginEmployee, mdmsCreate, mdmsSearch, mdmsUpdate } from '../utils/launch-fixes/api.js';

const T = 'ke.nairobi';

test.describe('01-configurator-mdms: Department CRUD (#472 + follow-ups)', () => {
  test('Department create REJECTS the legacy `description` field', async () => {
    // PR #40 removed `description` from DepartmentCreate. The schema
    // still rejects it server-side — sanity check that the schema
    // contract hasn't drifted.
    const auth = await loginEmployee();
    const uid = `DEPT_PW_DESC_${Date.now()}`;
    const r = await mdmsCreate(auth, 'common-masters.Department', {
      tenantId: T,
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: uid,
      isActive: true,
      data: { code: uid, name: 'pw test', active: true, description: 'leak' },
    });
    expect(r.Errors?.[0]?.message).toMatch(/extraneous key \[description\]/);
  });

  test('Department create with only schema-allowed fields SUCCEEDS', async () => {
    const auth = await loginEmployee();
    const uid = `DEPT_PW_OK_${Date.now()}`;
    const r = await mdmsCreate(auth, 'common-masters.Department', {
      tenantId: T,
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: uid,
      isActive: true,
      data: { code: uid, name: 'pw test', active: true },
    });
    expect(r.Errors).toBeUndefined();
    expect(r.mdms?.[0]?.uniqueIdentifier).toBe(uid);
    // Soft-delete the test record.
    const m = r.mdms[0];
    m.isActive = false;
    await mdmsUpdate(auth, 'common-masters.Department', m);
  });

  test('Department update with leaked `_isActive` / `_uniqueIdentifier` / `id` is REJECTED by MDMS', async () => {
    // Reproduces what the old dataProvider was sending. PR #40 strips
    // these client-side; this test guards against a regression that
    // re-introduces the leak (or a future change to the configurator's
    // form payload that includes new `_*` fields).
    const auth = await loginEmployee();
    const search = await mdmsSearch(auth, T, 'common-masters.Department');
    const existing = search.mdms?.find((r: any) => r.isActive);
    expect(existing).toBeTruthy();
    const polluted = {
      ...existing,
      data: {
        ...existing.data,
        id: existing.id,
        _isActive: existing.isActive,
        _uniqueIdentifier: existing.uniqueIdentifier,
        _auditDetails: existing.auditDetails,
        _schemaCode: existing.schemaCode,
        _mdmsId: existing.id,
      },
    };
    const r = await mdmsUpdate(auth, 'common-masters.Department', polluted);
    const codes = (r.Errors ?? []).map((e: any) => e.code);
    expect(codes.some((c: string) => c?.startsWith('INVALID_REQUEST_ADDITIONALPROPERTIES'))).toBe(true);
  });
});

test.describe('01-configurator-mdms: ComplaintType schema sanity', () => {
  test('ServiceDefs schema declares keywords / order / menuPath (so ComplaintTypeCreate defaults are safe)', async () => {
    // Verified post-explorer: the schema does include all three. This
    // test guards against schema drift removing them.
    const auth = await loginEmployee();
    const r = await fetch(`${process.env.NAIPEPEA_BASE ?? 'https://naipepea.digit.org'}/mdms-v2/schema/v1/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { authToken: auth.token, apiId: 'Rainmaker' },
        SchemaDefCriteria: { tenantId: 'ke', codes: ['RAINMAKER-PGR.ServiceDefs'] },
      }),
    }).then(r => r.json());
    const props = Object.keys(r.SchemaDefinitions?.[0]?.definition?.properties ?? {});
    for (const f of ['keywords', 'order', 'menuPath']) expect(props).toContain(f);
  });
});

test.describe('01-configurator-mdms: dataProvider create needs same sanitize as update', () => {
  test('mdmsCreate REJECTS the same `_isActive` / `id` leak', async () => {
    // PR #40 fixed the *update* path. The *create* path on
    // dataProvider.ts:534 was untouched. This test reproduces the leak
    // shape react-admin would emit if a defaultRecord included `id` or
    // a normaliser glued `_*` fields onto it.
    const auth = await loginEmployee();
    const uid = `DEPT_PW_CREATE_LEAK_${Date.now()}`;
    const r = await mdmsCreate(auth, 'common-masters.Department', {
      tenantId: T,
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: uid,
      isActive: true,
      data: { id: uid, code: uid, name: 'pw test', active: true, _isActive: true },
    });
    const codes = (r.Errors ?? []).map((e: any) => e.code);
    expect(codes.some((c: string) => c?.startsWith('INVALID_REQUEST'))).toBe(true);
  });
});

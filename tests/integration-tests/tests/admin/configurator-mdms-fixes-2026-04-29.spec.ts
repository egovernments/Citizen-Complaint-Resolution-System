// Verifications for the MDMS / configurator surface fixes. Pure API
// tests where we can — the configurator just shells out to mdms-v2 with
// the same payload shape we're checking here.
import { test, expect } from '@playwright/test';
import { loginEmployee, mdmsCreate, mdmsUpdate } from '../utils/launch-fixes/api.js';
import { TENANT, ROOT_TENANT, BASE_URL } from '../utils/env';

test.describe('01-configurator-mdms: Department CRUD (#472 + follow-ups)', () => {
  test('Department create REJECTS the legacy `description` field', {
    annotation: {
      type: 'description',
      description: `Schema-contract sanity check for CCRS#472. PR #40 removed the legacy 'description' field from DepartmentCreate, and the MDMS schema rejects it server-side. This test confirms the schema still rejects the extra key — guards against a schema drift that quietly accepts unknown fields.

Steps:
1. Log in as the test employee.
2. mdmsCreate for common-masters.Department with data: { code, name, active, description: 'leak' } at ke.nairobi.
3. Assert response.Errors[0].message matches /extraneous key \\[description\\]/.

If the assertion fails because the schema started accepting the field, the configurator's create form might silently ship description data and confuse downstream consumers.`,
    },
    tag: ['@area:configurator-manage', '@area:mdms-schema', '@ccrs:472', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    // PR #40 removed `description` from DepartmentCreate. The schema
    // still rejects it server-side — sanity check that the schema
    // contract hasn't drifted.
    const auth = await loginEmployee();
    const uid = `DEPT_PW_DESC_${Date.now()}`;
    const r = await mdmsCreate(auth, 'common-masters.Department', {
      tenantId: TENANT,
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: uid,
      isActive: true,
      data: { code: uid, name: 'pw test', active: true, description: 'leak' },
    });
    expect(r.Errors?.[0]?.message).toMatch(/extraneous key \[description\]/);
  });

  test('Department create with only schema-allowed fields SUCCEEDS', {
    annotation: {
      type: 'description',
      description: `Positive case for CCRS#472: a Department create with only the three schema-allowed fields (code, name, active) succeeds and returns a record with the expected uniqueIdentifier. Soft-deletes the test record afterwards (sets isActive=false) so the test is hygienic.

Steps:
1. Log in as the test employee.
2. mdmsCreate for common-masters.Department with data: { code, name, active: true } and a unique identifier suffixed with Date.now().
3. Assert response.Errors is undefined.
4. Assert response.mdms[0].uniqueIdentifier matches the supplied uid.
5. Soft-delete: set m.isActive = false and call mdmsUpdate.

Teardown is API-only because there's no UI flow inside this spec — it's pure MDMS contract testing.`,
    },
    tag: ['@area:configurator-manage', '@area:mdms-schema', '@ccrs:472', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    const auth = await loginEmployee();
    const uid = `DEPT_PW_OK_${Date.now()}`;
    const r = await mdmsCreate(auth, 'common-masters.Department', {
      tenantId: TENANT,
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

  test('Department update with leaked `_isActive` / `_uniqueIdentifier` / `id` is REJECTED by MDMS', {
    annotation: {
      type: 'description',
      description: `Reproduces the exact leak shape PR #40 fixed in the configurator's dataProvider: it used to forward _isActive, _uniqueIdentifier, _auditDetails, _schemaCode, _mdmsId, and id into the MDMS payload. Post-fix the client strips them. This test sends a polluted update directly to MDMS and asserts the schema rejects with INVALID_REQUEST_ADDITIONALPROPERTIES — guarding against either a regression in the client or schema drift that starts accepting the leaks.

Steps:
1. Log in as the test employee.
2. mdmsCreate a fresh, self-owned active common-masters.Department record (uid DEPT_PW_LEAK_<ts>).
3. Build a polluted record: spread existing + add data.id, _isActive, _uniqueIdentifier, _auditDetails, _schemaCode, _mdmsId.
4. mdmsUpdate with the polluted record.
5. Read response.Errors codes; assert at least one starts with 'INVALID_REQUEST_ADDITIONALPROPERTIES'.
6. finally: soft-delete the seeded record (isActive=false + mdmsUpdate).

Hermetic: self-seeds its own active Department record rather than fishing one out of the tenant, so it doesn't depend on any pre-existing active row (deployments with no active common-masters.Department — e.g. bomet's ke — used to fail here with "existing" undefined).`,
    },
    tag: ['@area:configurator-manage', '@area:mdms-schema', '@ccrs:472', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    // Reproduces what the old dataProvider was sending. PR #40 strips
    // these client-side; this test guards against a regression that
    // re-introduces the leak (or a future change to the configurator's
    // form payload that includes new `_*` fields).
    //
    // B4: self-seed the record we pollute-update instead of fishing an
    // active Department out of the tenant — some deployments (bomet's ke)
    // have no active common-masters.Department, which used to fail this
    // test with "existing" undefined. Soft-delete in `finally` so the
    // probe record doesn't linger.
    const auth = await loginEmployee();
    const uid = `DEPT_PW_LEAK_${Date.now()}`;
    const seeded = await mdmsCreate(auth, 'common-masters.Department', {
      tenantId: TENANT,
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: uid,
      isActive: true,
      data: { code: uid, name: 'pw leak probe', active: true },
    });
    expect(seeded.Errors).toBeUndefined();
    const existing = seeded.mdms?.[0];
    expect(existing).toBeTruthy();
    try {
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
    } finally {
      const m = { ...existing, isActive: false };
      await mdmsUpdate(auth, 'common-masters.Department', m);
    }
  });
});

test.describe('01-configurator-mdms: ComplaintType schema sanity', () => {
  test('ComplaintHierarchy schema declares keywords / order / parentCode (so ComplaintTypeCreate defaults are safe)', {
    annotation: {
      type: 'description',
      description: `Schema-drift guard for the ComplaintType (RAINMAKER-PGR.ComplaintHierarchy) MDMS schema. The legacy RAINMAKER-PGR.ServiceDefs master is gone; complaint types are now LEAF rows of the single ComplaintHierarchy adjacency list. The configurator's ComplaintTypeCreate form sends keywords, order, and parentCode (the grouping key that replaced menuPath) as defaults; if the schema drops any of those properties, creates would start failing. Test queries the schema definition and asserts all three property names appear.

Steps:
1. Log in as the test employee.
2. POST /mdms-v2/schema/v1/_search with codes: ['RAINMAKER-PGR.ComplaintHierarchy'] at root tenant 'ke'.
3. Read SchemaDefinitions[0].definition.properties; capture its keys.
4. For each of ['keywords', 'order', 'parentCode'], assert the keys array contains it.

Note parentCode specifically — it replaced the legacy menuPath grouping key (menuPath/menuPathName are gone from the masters). If a future PR reintroduces menuPath, this guard still passes for parentCode, which is what the tree-derived grouping relies on.`,
    },
    tag: ['@area:configurator-manage', '@area:mdms-schema', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    // Verified post-explorer: the schema does include all three. This
    // test guards against schema drift removing them.
    const auth = await loginEmployee();
    const r = await fetch(`${BASE_URL}/mdms-v2/schema/v1/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { authToken: auth.token, apiId: 'Rainmaker' },
        SchemaDefCriteria: { tenantId: ROOT_TENANT, codes: ['RAINMAKER-PGR.ComplaintHierarchy'] },
      }),
    }).then(r => r.json());
    const props = Object.keys(r.SchemaDefinitions?.[0]?.definition?.properties ?? {});
    for (const f of ['keywords', 'order', 'parentCode']) expect(props).toContain(f);
  });
});

test.describe('01-configurator-mdms: dataProvider create needs same sanitize as update', () => {
  test('mdmsCreate REJECTS the same `_isActive` / `id` leak', {
    annotation: {
      type: 'description',
      description: `Companion test to the update-leak case. PR #40 fixed the dataProvider's update path; the create path on dataProvider.ts:534 was untouched. This test reproduces the leak shape react-admin would emit if a defaultRecord included id or a normaliser glued _* fields onto it. Asserts MDMS rejects the create with an INVALID_REQUEST error.

Steps:
1. Log in as the test employee.
2. mdmsCreate for common-masters.Department with data containing id, code, name, active, AND _isActive.
3. Read response.Errors codes; assert at least one starts with 'INVALID_REQUEST'.

Open follow-up: the create path on the client should also strip these fields. Until that lands, the schema's strictness is the safety net this test guards.`,
    },
    tag: ['@area:configurator-manage', '@area:mdms-schema', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:admin'] }, async () => {
    // PR #40 fixed the *update* path. The *create* path on
    // dataProvider.ts:534 was untouched. This test reproduces the leak
    // shape react-admin would emit if a defaultRecord included `id` or
    // a normaliser glued `_*` fields onto it.
    const auth = await loginEmployee();
    const uid = `DEPT_PW_CREATE_LEAK_${Date.now()}`;
    const r = await mdmsCreate(auth, 'common-masters.Department', {
      tenantId: TENANT,
      schemaCode: 'common-masters.Department',
      uniqueIdentifier: uid,
      isActive: true,
      data: { id: uid, code: uid, name: 'pw test', active: true, _isActive: true },
    });
    const codes = (r.Errors ?? []).map((e: any) => e.code);
    expect(codes.some((c: string) => c?.startsWith('INVALID_REQUEST'))).toBe(true);
  });
});

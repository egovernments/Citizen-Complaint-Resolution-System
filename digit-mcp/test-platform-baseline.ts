import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import { loadPlatformSeed, substituteTenant } from './src/tools/platform-baseline.js';
import { bootstrapPlatform } from './src/tools/platform-bootstrap.js';

function fixture(role = 'SUPERUSER') {
  const schemas = new Map<string, unknown>();
  const rows = new Map<string, any>();
  const users: any[] = [], employees: any[] = [];
  let sourceReads = 0, writes = 0, directCalls = 0;
  let verified: any;
  const user = { uuid: 'platform-admin', userName: 'admin', name: 'Admin', roles: [{ code: role, tenantId: 'in' }] };
  verified = user;
  const api = {
    getAuthInfo: () => ({ authenticated: true, token: 'test-only-token', user }),
    getEnvironmentInfo: () => ({ stateTenantId: 'in' }), getLoginPassword: () => 'test-only-password',
    mdmsV2SearchRaw: async (tenant: string, code: string) => {
      if (tenant !== 'in') return [...rows.values()].filter(r => r.schemaCode === code);
      assert.equal(code, 'common-masters.MobileNumberValidation'); sourceReads++;
      return [{ isActive: true, data: { countryCode: '+91', mobileNumberRegex: '^[6-9][0-9]{9}$', default: true } }];
    },
    mdmsSchemaSearch: async (_tenant: string, codes: string[]) => schemas.has(codes[0]) ? [schemas.get(codes[0])] : [],
    mdmsSchemaCreate: async (_tenant: string, code: string, _description: string, definition: any) => { schemas.set(code, definition); writes++; return definition; },
    mdmsV2Create: async (_tenant: string, code: string, id: string, data: any) => { const row = { schemaCode: code, uniqueIdentifier: id, data }; rows.set(`${code}/${id}`, row); writes++; return row; },
    generateEncKey: async () => true,
    userSearch: async () => users,
    userCreate: async (value: any) => { users.push({ ...value, uuid: 'founder' }); },
    userUpdate: async (value: any) => { users[0] = value; },
    boundaryHierarchySearch: async () => [{}], boundarySearch: async () => [{}], boundaryRelationshipTreeSearch: async () => [{}],
    employeeSearch: async () => employees,
    employeeCreate: async (_tenant: string, values: any[]) => { employees.push(...values); },
  };
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input); const body = JSON.parse(String(init?.body));
    if (path.startsWith('http://user.test/user/_details')) return new Response(JSON.stringify(verified), { status: 200 });
    directCalls++;
    assert.equal(body.RequestInfo.userInfo.uuid, 'platform-admin');
    let result: unknown;
    if (path.endsWith('/schema/v1/_search')) result = { SchemaDefinitions: schemas.has(body.SchemaDefCriteria.codes[0]) ? [schemas.get(body.SchemaDefCriteria.codes[0])] : [] };
    else if (path.endsWith('/schema/v1/_create')) { schemas.set(body.SchemaDefinition.code, body.SchemaDefinition); writes++; result = {}; }
    else if (path.endsWith('/v2/_search')) {
      const c = body.MdmsCriteria;
      result = { mdms: [...rows.values()].filter(r => r.schemaCode === c.schemaCode && (!c.uniqueIdentifiers || c.uniqueIdentifiers.includes(r.uniqueIdentifier))) };
    } else if (path.includes('/v2/_create/')) { const r = body.Mdms; rows.set(`${r.schemaCode}/${r.uniqueIdentifier}`, r); writes++; result = {}; }
    else throw new Error(`Unexpected route ${path}`);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { options: { api: api as any, fetcher: fetcher as typeof fetch, mdmsHost: 'http://mdms.test', userHost: 'http://user.test', direct: true, stateTenant: 'in', deriveMobile: () => '9876543210', defaultPassword: () => 'test-only-password' }, schemas, rows, users, employees, reads: () => sourceReads, writes: () => writes, directCalls: () => directCalls, verifyAs: (value: any) => { verified = value; } };
}

test('canonical baseline records satisfy schemas and exclude workspace business data', () => {
  const seed = loadPlatformSeed(); const ajv = new Ajv({ strict: false, validateFormats: false });
  const schemas = new Map(seed.schemas.map(s => [s.code, ajv.compile(s.definition)]));
  assert.equal(schemas.size, seed.schemas.length); const ids = new Set<string>();
  for (const row of seed.records) {
    const id = `${row.schemaCode}/${row.uniqueIdentifier}`; assert.ok(!ids.has(id), `duplicate ${id}`); ids.add(id);
    const validate = schemas.get(row.schemaCode); assert.ok(validate, `missing schema ${row.schemaCode}`);
    assert.ok(validate(substituteTenant(row.data, 'in.newtown')), `${id}: ${JSON.stringify(validate.errors)}`);
    assert.ok(!['Workflow.BusinessService', 'common-masters.ThemeConfig', 'RAINMAKER-PGR.ComplaintHierarchy'].includes(row.schemaCode));
  }
  assert.ok(seed.founderRoles.includes('SUPERUSER'));
  assert.equal(seed.records.find(r => r.schemaCode === 'identity.invitationPolicy')?.data.invitationExpiryHours, 336);
});

test('privilege and direct-MDMS configuration fail closed', async () => {
  const denied = fixture('CITIZEN'); await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, denied.options), /administrator/); assert.equal(denied.directCalls(), 0);
  const missing = fixture(); await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, { ...missing.options, mdmsHost: '' }), /EGOV_MDMS_HOST/); assert.equal(missing.writes(), 0);
});

test('bootstrap uses canonical inventory, country-only source lookup, and replays without duplicate users', async () => {
  const f = fixture(), seed = loadPlatformSeed();
  const first = await bootstrapPlatform({ target_tenant: 'in.newtown', source_tenant: 'in' }, f.options);
  assert.equal(first.seedVersion, '1'); assert.equal(first.summary.schemas_copied, seed.schemas.length);
  assert.equal(first.summary.data_copied, seed.records.length + 2); assert.equal(first.summary.workflows_created, 0);
  assert.equal(first.summary.admin_employee_provisioned, true); assert.equal(f.reads(), 1);
  assert.ok(!JSON.stringify([...f.rows.values()]).includes('{tenantid}'));
  const writes = f.writes(); const second = await bootstrapPlatform({ target_tenant: 'in.newtown' }, f.options);
  assert.equal(second.summary.data_copied, 0); assert.equal(f.writes(), writes); assert.equal(f.users.length, 1); assert.equal(f.employees.length, 1);
});

test('source and built package receive byte-identical canonical seed', async () => {
  const canonical = await readFile('../backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json');
  for (const dir of ['data', 'src/data', 'dist/data']) assert.deepEqual(await readFile(`${dir}/platform-baseline-v1.json`), canonical);
});

test('built loader resolves seed outside the monorepo', async () => {
  const root = resolve('../.artifacts/onboarding/mcp-package-test');
  await mkdir(`${root}/tools`, { recursive: true }); await mkdir(`${root}/data`, { recursive: true });
  await writeFile(`${root}/package.json`, '{"type":"module"}');
  await copyFile('dist/tools/platform-baseline.js', `${root}/tools/platform-baseline.js`);
  await copyFile('dist/data/platform-baseline-v1.json', `${root}/data/platform-baseline-v1.json`);
  const packaged = await import(pathToFileURL(`${root}/tools/platform-baseline.js`).href);
  assert.deepEqual(packaged.loadPlatformSeed(), loadPlatformSeed());
});


test('direct bootstrap rejects forged claims, missing tokens and non-root roles before MDMS', async () => {
  for (const verified of [null, { uuid: 'forged', roles: [{ code: 'CITIZEN', tenantId: 'in' }] }, { uuid: 'forged', roles: [{ code: 'SUPERUSER', tenantId: 'in.other' }] }]) {
    const f = fixture(); f.verifyAs(verified);
    await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, f.options));
    assert.equal(f.directCalls(), 0); assert.equal(f.reads(), 0);
  }
  const f = fixture(); f.options.api.getAuthInfo = () => ({ authenticated: false, token: null, user: null });
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, f.options), /administrator/);
  assert.equal(f.directCalls(), 0);
});

test('flag-off bootstrap uses gateway methods and never direct MDMS or user hosts', async () => {
  const f = fixture();
  const result = await bootstrapPlatform({ target_tenant: 'in.newtown' }, { ...f.options, direct: false, mdmsHost: 'invalid-direct-host', fetcher: async () => { throw new Error('direct request forbidden'); } });
  assert.equal(result.success, true); assert.ok(f.writes() > 0); assert.equal(f.directCalls(), 0);
});

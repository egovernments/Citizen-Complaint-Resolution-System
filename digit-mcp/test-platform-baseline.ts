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

test('invitation policy has one default and enforces expiry boundaries', () => {
  const seed = loadPlatformSeed();
  const schema = seed.schemas.find(s => s.code === 'identity.invitationPolicy')!;
  const validate = new Ajv({ strict: false }).compile(schema.definition);
  assert.deepEqual(schema.definition['x-unique'], ['id']);
  assert.deepEqual(seed.records.filter(r => r.schemaCode === schema.code), [{
    schemaCode: 'identity.invitationPolicy', uniqueIdentifier: 'default',
    data: { id: 'default', invitationExpiryHours: 336 },
  }]);
  for (const hours of [1, 336, 2160]) assert.ok(validate({ id: 'default', invitationExpiryHours: hours }));
  for (const hours of [0, 2161, 1.5, '336', null]) assert.equal(validate({ id: 'default', invitationExpiryHours: hours }), false);
  assert.equal(validate({ invitationExpiryHours: 336 }), false);
  assert.equal(validate({ id: 'other', invitationExpiryHours: 336 }), false);
});

test('workspace routes grant access only to tenant ACCOUNT_ADMIN', () => {
  const seed = loadPlatformSeed();
  for (const route of ['_search', '_update', '_rename']) {
    const actions = seed.records.filter(r => r.schemaCode === 'ACCESSCONTROL-ACTIONS-TEST.actions-test'
      && r.data.url === `/pgr-services/v2/onboarding/workspaces/${route}`);
    assert.equal(actions.length, 1, route);
    const grants = seed.records.filter(r => r.schemaCode === 'ACCESSCONTROL-ROLEACTIONS.roleactions'
      && r.data.actionid === actions[0].data.id);
    assert.deepEqual(grants.map(r => r.data.rolecode), ['ACCOUNT_ADMIN'], route);
    assert.equal(substituteTenant(grants[0].data, 'in.workspace').tenantId, 'in.workspace');
  }
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

test('direct mode rejects inactive users, missing tokens and failed live verification before MDMS', async () => {
  const inactive = fixture();
  inactive.verifyAs({ uuid: 'inactive', active: false, roles: [{ code: 'SUPERUSER', tenantId: 'in' }] });
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, inactive.options), /verified state administrator/);
  assert.equal(inactive.directCalls(), 0); assert.equal(inactive.reads(), 0);
  const missing = fixture(), claimed = missing.options.api.getAuthInfo();
  missing.options.api.getAuthInfo = () => ({ ...claimed, token: null });
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, missing.options), /verified state administrator/);
  assert.equal(missing.directCalls(), 0); assert.equal(missing.reads(), 0);
  const revoked = fixture();
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, {
    ...revoked.options, fetcher: async input => {
      assert.equal(String(input), 'http://user.test/user/_details?access_token=test-only-token');
      return new Response('{}', { status: 401 });
    },
  }), /verified state administrator/);
  assert.equal(revoked.directCalls(), 0); assert.equal(revoked.reads(), 0); assert.equal(revoked.writes(), 0);
});

test('unset and false environment flags keep the gateway default', async () => {
  const previous = process.env.MCP_PLATFORM_BOOTSTRAP_DIRECT;
  try {
    for (const flag of [undefined, 'false']) {
      if (flag === undefined) delete process.env.MCP_PLATFORM_BOOTSTRAP_DIRECT;
      else process.env.MCP_PLATFORM_BOOTSTRAP_DIRECT = flag;
      const f = fixture();
      const result = await bootstrapPlatform({ target_tenant: 'in.newtown' }, {
        ...f.options, direct: undefined, mdmsHost: 'invalid', userHost: 'invalid',
        fetcher: async () => { throw new Error('direct transport forbidden'); },
      });
      assert.equal(result.success, true); assert.ok(f.writes() > 0);
    }
  } finally {
    if (previous === undefined) delete process.env.MCP_PLATFORM_BOOTSTRAP_DIRECT;
    else process.env.MCP_PLATFORM_BOOTSTRAP_DIRECT = previous;
  }
});

test('legacy workspace inputs emit warnings without changing baseline records', async () => {
  const baseline = fixture(), legacy = fixture();
  const normal = await bootstrapPlatform({ target_tenant: 'in.newtown' }, baseline.options);
  const result = await bootstrapPlatform({ target_tenant: 'in.newtown', pincode_allowlist: ['99999'], dashboard_roles: ['CUSTOM_ROLE'] }, legacy.options);
  assert.equal(normal.summary.warnings, 0);
  assert.equal(result.summary.warnings, 2);
  assert.equal(result.results.warnings.length, 2);
  for (const input of ['pincode_allowlist', 'dashboard_roles']) {
    assert.ok(result.results.warnings.some(warning => warning.includes(input) && warning.includes('ignored') && warning.includes('workspace')));
  }
  assert.deepEqual([...legacy.rows], [...baseline.rows]);
});

test('user_only updates the administrator without writing baseline or employee records', async () => {
  const f = fixture();
  const result = await bootstrapPlatform({ target_tenant: 'in.newtown', user_only: true,
    user_validation: [{ countryCode: '+91', mobileNumberRegex: '^[6-9][0-9]{9}$', default: true }],
  }, f.options);
  assert.equal(result.user_only, true); assert.equal(result.admin_user_provisioned, true);
  assert.equal(result.summary.admin_employee_provisioned, false);
  assert.equal(f.writes(), 0); assert.equal(f.reads(), 0); assert.equal(f.employees.length, 0);
  await bootstrapPlatform({ target_tenant: 'in.newtown', user_only: true }, f.options);
  assert.equal(f.users.length, 1); assert.equal(f.writes(), 0);
});

test('registered bootstrap input schema exposes user_only and retains compatibility inputs', async () => {
  const { ToolRegistry } = await import('./src/tools/registry.js');
  const { registerMdmsTenantTools } = await import('./src/tools/mdms-tenant.js');
  const registry = new ToolRegistry(); registerMdmsTenantTools(registry);
  const tool = registry.getTool('tenant_bootstrap')!;
  const schema = tool.inputSchema as any;
  assert.equal(schema.properties.user_only.type, 'boolean');
  assert.equal(schema.user_only, undefined);
  assert.deepEqual(schema.required, ['target_tenant']);
  for (const input of ['pincode_allowlist', 'dashboard_roles']) {
    assert.equal(schema.properties[input].type, 'array');
    assert.match(schema.properties[input].description, /ignored/);
  }
  const validate = new Ajv({ strict: false }).compile(schema);
  assert.ok(validate({ target_tenant: 'in.newtown', user_only: true }));
  assert.equal(validate({ target_tenant: 'in.newtown', user_only: 'yes' }), false);
});

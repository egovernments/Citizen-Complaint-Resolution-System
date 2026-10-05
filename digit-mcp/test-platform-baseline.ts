import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
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
    assert.ok(!['Workflow.BusinessService', 'RAINMAKER-PGR.ComplaintHierarchy'].includes(row.schemaCode));
  }
  assert.ok(seed.founderRoles.includes('SUPERUSER'));
  assert.equal(seed.records.find(r => r.schemaCode === 'identity.invitationPolicy')?.data.invitationExpiryHours, 336);
});

test('privilege and direct-MDMS configuration fail closed', async () => {
  const denied = fixture('CITIZEN'); await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, denied.options), /administrator/); assert.equal(denied.directCalls(), 0);
  const missing = fixture(); await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, { ...missing.options, mdmsHost: '' }), /EGOV_MDMS_HOST/); assert.equal(missing.writes(), 0);
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
  assert.equal(first.summary.data_copied, seed.records.length + 3); assert.equal(first.summary.workflows_created, 0);
  assert.equal(first.summary.admin_employee_provisioned, true); assert.equal(f.reads(), 1);
  assert.ok(!JSON.stringify([...f.rows.values()]).includes('{tenantid}'));
  const writes = f.writes(); const second = await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, f.options);
  assert.equal(second.summary.data_copied, 0); assert.equal(f.writes(), writes); assert.equal(f.users.length, 1); assert.equal(f.employees.length, 1);
});

test('direct bootstrap rejects forged claims, missing tokens and non-root roles before MDMS', async () => {
  for (const verified of [null, { uuid: 'forged', roles: [{ code: 'CITIZEN', tenantId: 'in' }] }, { uuid: 'forged', roles: [{ code: 'SUPERUSER', tenantId: 'in.other' }] }]) {
    const f = fixture(); f.verifyAs(verified);
    await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, f.options));
    assert.equal(f.directCalls(), 0); assert.equal(f.reads(), 0);
  }
  const f = fixture(); f.options.api.getAuthInfo = () => ({ authenticated: false, token: null, user: null });
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, f.options), /administrator/);
  assert.equal(f.directCalls(), 0);
});

test('flag-off bootstrap uses gateway methods and never direct MDMS or user hosts', async () => {
  const f = fixture();
  const result = await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, { ...f.options, direct: false, mdmsHost: 'invalid-direct-host', fetcher: async () => { throw new Error('direct request forbidden'); } });
  assert.equal(result.success, true); assert.ok(f.writes() > 0); assert.equal(f.directCalls(), 0);
});

test('direct mode rejects inactive users, missing tokens and failed live verification before MDMS', async () => {
  const inactive = fixture();
  inactive.verifyAs({ uuid: 'inactive', active: false, roles: [{ code: 'SUPERUSER', tenantId: 'in' }] });
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, inactive.options), /verified state administrator/);
  assert.equal(inactive.directCalls(), 0); assert.equal(inactive.reads(), 0);
  const missing = fixture(), claimed = missing.options.api.getAuthInfo();
  missing.options.api.getAuthInfo = () => ({ ...claimed, token: null });
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, missing.options), /verified state administrator/);
  assert.equal(missing.directCalls(), 0); assert.equal(missing.reads(), 0);
  const revoked = fixture();
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, {
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
      const result = await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, {
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
  const normal = await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, baseline.options);
  const result = await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN', pincode_allowlist: ['99999'], dashboard_roles: ['CUSTOM_ROLE'] }, legacy.options);
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
  const result = await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN', user_only: true,
    user_validation: [{ countryCode: '+91', mobileNumberRegex: '^[6-9][0-9]{9}$', default: true }],
  }, f.options);
  assert.equal(result.user_only, true); assert.equal(result.admin_user_provisioned, true);
  assert.equal(result.summary.admin_employee_provisioned, false);
  assert.equal(f.writes(), 0); assert.equal(f.reads(), 0); assert.equal(f.employees.length, 0);
  await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN', user_only: true }, f.options);
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

test('every role-action refers to an already seeded role and action', () => {
  const seed = loadPlatformSeed();
  const roles = new Set<unknown>(), actions = new Set<unknown>();
  for (const row of seed.records) {
    if (row.schemaCode === 'ACCESSCONTROL-ROLES.roles') roles.add(row.data.code);
    if (row.schemaCode === 'ACCESSCONTROL-ACTIONS-TEST.actions-test') actions.add(row.data.id);
    if (row.schemaCode === 'ACCESSCONTROL-ROLEACTIONS.roleactions') {
      assert.ok(roles.has(row.data.rolecode), `${row.uniqueIdentifier} needs earlier role ${row.data.rolecode}`);
      assert.ok(actions.has(row.data.actionid), `${row.uniqueIdentifier} needs earlier action ${row.data.actionid}`);
    }
  }
  assert.ok(roles.has('PGR_SUPERVISOR'));
  for (const role of seed.founderRoles) assert.ok(roles.has(role), `founder role ${role} must exist`);
});

test('every nested tenantId in baseline data resolves to the target tenant', () => {
  const target = 'new-workspace';
  function inspect(value: unknown, location: string): void {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, `${location}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        if (key === 'tenantId') assert.equal(entry, target, `${location}.${key}`);
        inspect(entry, `${location}.${key}`);
      }
    }
  }
  for (const row of loadPlatformSeed().records) {
    inspect(substituteTenant(row.data, target), `${row.schemaCode}/${row.uniqueIdentifier}`);
  }
});

test('branding gateway create and update authorize only tenant ACCOUNT_ADMIN', () => {
  const seed = loadPlatformSeed();
  assert.ok(seed.founderRoles.includes('ACCOUNT_ADMIN'));
  for (const verb of ['_create', '_update']) {
    const path = `/mdms-v2/v2/${verb}/common-masters.ThemeConfig`;
    const actions = seed.records.filter(r => r.schemaCode === 'ACCESSCONTROL-ACTIONS-TEST.actions-test' && r.data.url === path);
    assert.equal(actions.length, 1, `exactly one action for ${path}`);
    assert.equal(actions[0].data.enabled, true);
    const grants = seed.records.filter(r => r.schemaCode === 'ACCESSCONTROL-ROLEACTIONS.roleactions' && r.data.actionid === actions[0].data.id);
    assert.deepEqual(grants.map(r => r.data.rolecode), ['ACCOUNT_ADMIN']);
    assert.equal(substituteTenant(grants[0].data, 'newfounder').tenantId, 'newfounder');
  }
});

test('canonical country defaults have an explicit supported inventory and valid mobile-rule data', async () => {
  const seed = loadPlatformSeed();
  // Countries offered at signup: COUNTRIES in configurator/src/pages/SignupPage.tsx.
  assert.deepEqual(Object.keys(seed.countryMobileRules).sort(), ['ET', 'IN', 'KE', 'MZ']);
  assert.deepEqual(seed.countryMobileRules.IN, { countryCode: '+91', mobileNumberRegex: '^[6-9][0-9]{9}$', default: true });
  assert.deepEqual(seed.countryMobileRules.ET, { countryCode: '+251', mobileNumberRegex: '^9[0-9]{8}$', default: true });
  assert.deepEqual(seed.countryMobileRules.MZ, { countryCode: '+258', mobileNumberRegex: '^8[2-7][0-9]{7}$', default: true });
  const nairobi = JSON.parse(await readFile('../ansible/nairobi-mdms/mdms/common-masters/MobileNumberValidation.json', 'utf8'));
  assert.deepEqual(seed.countryMobileRules.KE, nairobi[0].data);
  const definition = seed.schemas.find(s => s.code === 'common-masters.MobileNumberValidation')!.definition;
  const validate = new Ajv({ strict: false }).compile(definition);
  for (const [iso, rule] of Object.entries(seed.countryMobileRules)) {
    assert.match(iso, /^[A-Z]{2}$/); assert.ok(validate(rule)); assert.equal(rule.default, true);
    assert.doesNotThrow(() => new RegExp(rule.mobileNumberRegex));
  }
  assert.equal(seed.records.filter(r => r.schemaCode === 'common-masters.MobileNumberValidation').length, 0,
    'country defaults must not be blindly seeded into every tenant');
});

test('MCP defaults to the seeded country rule and reads source_tenant only on opt-in', async () => {
  const configured = fixture();
  const search = configured.options.api.mdmsV2SearchRaw;
  const override = { countryCode: '+254', mobileNumberRegex: '^7[0-9]{8}$', default: true };
  configured.options.api.mdmsV2SearchRaw = async (tenant: string, code: string, ...rest: any[]) =>
    tenant === 'in' ? [{ isActive: true, data: override }] : search(tenant, code, ...rest);
  await bootstrapPlatform({ target_tenant: 'in.newtown', source_tenant: 'in' }, configured.options);
  assert.deepEqual(configured.rows.get('common-masters.MobileNumberValidation/+254').data, override);

  const missing = fixture();
  missing.options.api.mdmsV2SearchRaw = async () => [];
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', source_tenant: 'in' }, missing.options), /Country mobile rule is missing/);
  assert.equal(missing.writes(), 0, 'matching tenant name must not opt into canonical ISO fallback');

  for (const [country, prefix] of [['KE', '+254'], ['ET', '+251'], ['MZ', '+258']]) {
    const seeded = fixture();
    await bootstrapPlatform({ target_tenant: 'in.newtown', country }, seeded.options);
    assert.equal(seeded.reads(), 0, 'without source_tenant no live tenant is read');
    assert.deepEqual(seeded.rows.get(`common-masters.MobileNumberValidation/${prefix}`).data, loadPlatformSeed().countryMobileRules[country]);
  }
  const byPrefix = fixture();
  await bootstrapPlatform({ target_tenant: 'in.newtown', mobile_prefix: '+254' }, byPrefix.options);
  assert.equal(byPrefix.reads(), 0); assert.equal(byPrefix.rows.get('common-masters.MobileNumberValidation/+254').data.mobileNumberRegex, '^[17][0-9]{8}$');
  const unknown = fixture();
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, unknown.options), /Country mobile rule is missing/);
  assert.equal(unknown.reads(), 0); assert.equal(unknown.writes(), 0);

  const explicit = fixture();
  await bootstrapPlatform({ target_tenant: 'in.newtown', source_tenant: 'pg', user_validation: [override] }, explicit.options);
  assert.equal(explicit.reads(), 0);
  assert.deepEqual(explicit.rows.get('common-masters.MobileNumberValidation/+254').data, override);
});

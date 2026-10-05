import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv';
import { loadPlatformSeed, substituteTenant } from './src/tools/platform-baseline.js';
import { bootstrapPlatform } from './src/tools/platform-bootstrap.js';

function fixture(role = 'SUPERUSER') {
  const schemas = new Map<string, unknown>();
  const rows = new Map<string, any>();
  const users: any[] = [], employees: any[] = [], workflows: any[] = [];
  /** egov-localization rows keyed `tenant|locale`; upserts replace by module and code. */
  const messages = new Map<string, any[]>(); let cacheBusts = 0;
  let sourceReads = 0, writes = 0, directCalls = 0;
  let verified: any;
  const search = (c: any) => [...rows.values()].filter(r => r.tenantId === c.tenantId && r.schemaCode === c.schemaCode
    && (!c.uniqueIdentifiers || c.uniqueIdentifiers.includes(r.uniqueIdentifier)));
  const update = (record: any, data: any) => {
    const key = `${record.tenantId}|${record.schemaCode}/${record.uniqueIdentifier}`;
    assert.ok(rows.has(key), `update of missing ${key}`); rows.set(key, { ...rows.get(key), data }); writes++;
  };
  const user = { uuid: 'platform-admin', userName: 'admin', name: 'Admin', roles: [{ code: role, tenantId: 'in' }] };
  verified = user;
  const api = {
    getAuthInfo: () => ({ authenticated: true, token: 'test-only-token', user }),
    getEnvironmentInfo: () => ({ stateTenantId: 'in' }), getLoginPassword: () => 'test-only-password',
    mdmsV2SearchRaw: async (tenant: string, code: string, criteria?: any) => {
      if (tenant !== 'in' || code !== 'common-masters.MobileNumberValidation') return search({ ...criteria, tenantId: tenant, schemaCode: code });
      sourceReads++;
      return [{ isActive: true, data: { countryCode: '+91', mobileNumberRegex: '^[6-9][0-9]{9}$', default: true } }];
    },
    mdmsSchemaSearch: async (_tenant: string, codes: string[]) => schemas.has(codes[0]) ? [schemas.get(codes[0])] : [],
    mdmsSchemaCreate: async (_tenant: string, code: string, _description: string, definition: any) => { schemas.set(code, definition); writes++; return definition; },
    mdmsV2Create: async (tenant: string, code: string, id: string, data: any) => { const row = { tenantId: tenant, schemaCode: code, uniqueIdentifier: id, data, isActive: true }; rows.set(`${tenant}|${code}/${id}`, row); writes++; return row; },
    mdmsV2UpdateData: async (record: any, data: any) => { update(record, data); return record; },
    generateEncKey: async () => true,
    userSearch: async () => users,
    userCreate: async (value: any) => { users.push({ ...value, uuid: 'founder' }); },
    userUpdate: async (value: any) => { users[0] = value; },
    // Default: the WORKSPACE root already exists, so tests not about boundaries make no boundary writes.
    boundaryHierarchySearch: async (_tenant: string, type: string) => [{ hierarchyType: type }],
    boundarySearch: async (_tenant: string, _type: unknown, opts: any) => opts.codes.map((code: string) => ({ code })),
    boundaryRelationshipTreeSearch: async (tenant: string, type: string) => [{ hierarchyType: type, boundary: [{ code: tenant, boundaryType: 'ROOT' }] }],
    employeeSearch: async () => employees,
    localizationSearch: async (tenant: string, locale: string, module?: string) =>
      (messages.get(`${tenant}|${locale}`) ?? []).filter(m => !module || m.module === module),
    localizationUpsert: async (tenant: string, locale: string, values: any[]) => {
      const held = messages.get(`${tenant}|${locale}`) ?? [];
      for (const m of values) {
        const index = held.findIndex(h => h.module === m.module && h.code === m.code);
        if (index >= 0) held[index] = { ...m, locale }; else held.push({ ...m, locale });
      }
      messages.set(`${tenant}|${locale}`, held); return values;
    },
    localizationCacheBust: async () => { cacheBusts++; },
    workflowBusinessServiceSearch: async (tenant: string, codes: string[]) => workflows.filter(w => w.tenantId === tenant && codes.includes(w.businessService)),
    workflowBusinessServiceCreate: async (tenant: string, definition: any) => { workflows.push({ ...definition, tenantId: tenant }); return definition; },
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
    else if (path.endsWith('/v2/_search')) result = { mdms: search(body.MdmsCriteria) };
    else if (path.includes('/v2/_create/')) { const r = body.Mdms; rows.set(`${r.tenantId}|${r.schemaCode}/${r.uniqueIdentifier}`, r); writes++; result = {}; }
    else if (path.includes('/v2/_update/')) { update(body.Mdms, body.Mdms.data); result = {}; }
    else throw new Error(`Unexpected route ${path}`);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  // eg_mdms_data as seen by the role-action floor; rows it inserts become visible to MDMS reads.
  const sql: { tenant: string; schemaCode: string; uniqueIdentifier: string; data: any; writesBefore: number }[] = [];
  const db = {
    query: async (_text: string, params: any[]) => [{ count: String(sql.filter(r => r.tenant === params[0] && r.schemaCode === 'ACCESSCONTROL-ROLEACTIONS.roleactions').length) }],
    execute: async (_text: string, params: any[]) => {
      const [, tenant, uniqueIdentifier, schemaCode, data] = params;
      if (sql.some(r => r.tenant === tenant && r.schemaCode === schemaCode && r.uniqueIdentifier === uniqueIdentifier)) return 0;
      sql.push({ tenant, schemaCode, uniqueIdentifier, data: JSON.parse(data), writesBefore: writes });
      rows.set(`${tenant}|${schemaCode}/${uniqueIdentifier}`, { tenantId: tenant, schemaCode, uniqueIdentifier, data: JSON.parse(data), isActive: true });
      return 1;
    },
  };
  /** A row by `schema/uid` at a tenant; the city target unless given. */
  const row = (key: string, tenant = 'in.newtown') => rows.get(`${tenant}|${key}`);
  return { row, options: { api: api as any, fetcher: fetcher as typeof fetch, mdmsHost: 'http://mdms.test', userHost: 'http://user.test', direct: true, stateTenant: 'in', db, deriveMobile: () => '9876543210', defaultPassword: () => 'test-only-password' }, schemas, rows, users, employees, workflows, messages, cacheBusts: () => cacheBusts, sql, reads: () => sourceReads, writes: () => writes, directCalls: () => directCalls, verifyAs: (value: any) => { verified = value; } };
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
  assert.equal(first.seedVersion, '2'); assert.equal(first.summary.schemas_copied, seed.schemas.length);
  assert.equal(first.summary.data_copied, seed.records.length + 3); assert.equal(first.summary.workflows_created, 1);
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
  assert.deepEqual(configured.row('common-masters.MobileNumberValidation/+254').data, override);

  const missing = fixture();
  missing.options.api.mdmsV2SearchRaw = async () => [];
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown', source_tenant: 'in' }, missing.options), /Country mobile rule is missing/);
  assert.equal(missing.writes(), 0, 'matching tenant name must not opt into canonical ISO fallback');

  for (const [country, prefix] of [['KE', '+254'], ['ET', '+251'], ['MZ', '+258']]) {
    const seeded = fixture();
    await bootstrapPlatform({ target_tenant: 'in.newtown', country }, seeded.options);
    assert.equal(seeded.reads(), 0, 'without source_tenant no live tenant is read');
    assert.deepEqual(seeded.row(`common-masters.MobileNumberValidation/${prefix}`).data, loadPlatformSeed().countryMobileRules[country]);
  }
  const byPrefix = fixture();
  await bootstrapPlatform({ target_tenant: 'in.newtown', mobile_prefix: '+254' }, byPrefix.options);
  assert.equal(byPrefix.reads(), 0); assert.equal(byPrefix.row('common-masters.MobileNumberValidation/+254').data.mobileNumberRegex, '^[17][0-9]{8}$');
  const unknown = fixture();
  await assert.rejects(bootstrapPlatform({ target_tenant: 'in.newtown' }, unknown.options), /Country mobile rule is missing/);
  assert.equal(unknown.reads(), 0); assert.equal(unknown.writes(), 0);

  const explicit = fixture();
  await bootstrapPlatform({ target_tenant: 'in.newtown', source_tenant: 'pg', user_validation: [override] }, explicit.options);
  assert.equal(explicit.reads(), 0);
  assert.deepEqual(explicit.row('common-masters.MobileNumberValidation/+254').data, override);
});

test('an empty mobile_prefix is treated as absent, as the deploy renders an unset countryCode (#2269 review item 3)', async () => {
  // The playbook's user_only call renders `core_mobile_configs.countryCode | default('')`.
  const userOnly = fixture();
  const result = await bootstrapPlatform({ target_tenant: 'in.newtown', source_tenant: 'in', user_only: true,
    mobile_regex: '^[6-9][0-9]{9}$', mobile_prefix: '' }, userOnly.options);
  assert.equal(result.admin_user_provisioned, true);
  // Without a source rule an explicit regex resolves the seeded country, else the historical +91.
  for (const [regex, prefix] of [['^[17][0-9]{8}$', '+254'], ['^5[0-9]{8}$', '+91']]) {
    const f = fixture();
    await bootstrapPlatform({ target_tenant: 'in.newtown', mobile_regex: regex, mobile_prefix: '' }, f.options);
    assert.deepEqual(f.row(`common-masters.MobileNumberValidation/${prefix}`).data, { countryCode: prefix, mobileNumberRegex: regex, default: true });
  }
  const empty = fixture();
  await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'KE', mobile_prefix: '', mobile_regex: '' }, empty.options);
  assert.deepEqual(empty.row('common-masters.MobileNumberValidation/+254').data, loadPlatformSeed().countryMobileRules.KE);
});

test('user_only merges administrator roles, clears a lockout and is idempotent (#2269 review item 2)', async () => {
  const f = fixture();
  const operational = ['CITIZEN', 'CSR', 'GRO', 'PGR_LME', 'DGRO'];
  const held = [...operational.map(code => ({ code, name: code, tenantId: 'in.newtown' })),
    { code: 'PGR_VIEWER', name: 'PGR_VIEWER', tenantId: 'in.newtown' }, { code: 'SUPERUSER', name: 'SUPERUSER', tenantId: 'in' }];
  f.users.push({ uuid: 'founder', userName: 'admin', accountLocked: true, roles: held });
  const args = { target_tenant: 'in.newtown', source_tenant: 'in', user_only: true, mobile_regex: '^[6-9][0-9]{9}$', mobile_prefix: '' };
  const key = (r: any) => `${r.code}@${r.tenantId}`;
  await bootstrapPlatform(args, f.options);
  const first = f.users[0].roles.map(key);
  for (const role of held) assert.ok(first.includes(key(role)), `kept ${key(role)}`);
  for (const code of loadPlatformSeed().founderRoles) assert.ok(first.includes(`${code}@in.newtown`), `added ${code}`);
  assert.equal(new Set(first).size, first.length, 'no duplicate roles');
  assert.equal(f.users[0].accountLocked, false); assert.equal(f.users[0].password, 'test-only-password');
  await bootstrapPlatform(args, f.options);
  assert.deepEqual(f.users[0].roles.map(key), first, 'a second deploy changes nothing');

  // A fresh administrator gets the PGR operating roles it had before the seed existed.
  const fresh = fixture();
  await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, fresh.options);
  for (const code of operational) assert.ok(fresh.users[0].roles.some((r: any) => r.code === code), code);
  // A full re-run only adds missing roles and never replaces existing ones.
  fresh.users[0].roles = fresh.users[0].roles.filter((r: any) => r.code !== 'GRO').concat({ code: 'CUSTOM', tenantId: 'in.newtown' });
  await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, fresh.options);
  assert.ok(fresh.users[0].roles.some((r: any) => r.code === 'GRO') && fresh.users[0].roles.some((r: any) => r.code === 'CUSTOM'));
});

test('bootstrap roots the founder in the reserved WORKSPACE hierarchy, as PGR onboarding does (#2269 review item 4)', async () => {
  const f = fixture(), api = f.options.api as any;
  const hierarchies: any[] = [], entities: string[] = [], relationships: any[] = [];
  // A legacy ADMIN/ROOT from an older MCP bootstrap must not satisfy the WORKSPACE checks.
  api.boundaryHierarchySearch = async (_tenant: string, type: string) =>
    [{ hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'ROOT' }] }, ...hierarchies.filter(h => h.hierarchyType === type)];
  api.boundaryHierarchyCreate = async (tenant: string, hierarchyType: string, levels: any[]) => { hierarchies.push({ tenant, hierarchyType, levels }); };
  api.boundarySearch = async (_tenant: string, _type: unknown, opts: any) => entities.filter(code => opts.codes.includes(code)).map(code => ({ code }));
  api.boundaryCreate = async (_tenant: string, values: any[]) => { entities.push(...values.map(v => v.code)); };
  // Stock boundary-service returns an empty wrapper when there is no relationship yet.
  api.boundaryRelationshipTreeSearch = async (_tenant: string, type: string) => [{ hierarchyType: type,
    boundary: relationships.filter(r => r.hierarchyType === type).map(r => ({ code: r.code, boundaryType: r.boundaryType, tenantId: r.tenant })) }];
  api.boundaryRelationshipCreate = async (tenant: string, code: string, hierarchyType: string, boundaryType: string, parent: string | null) => {
    relationships.push({ tenant, code, hierarchyType, boundaryType, parent });
  };
  await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, f.options);
  assert.deepEqual(hierarchies, [{ tenant: 'in.newtown', hierarchyType: 'WORKSPACE', levels: [{ boundaryType: 'ROOT', parentBoundaryType: null, active: true }] }]);
  assert.deepEqual(entities, ['in.newtown']);
  assert.deepEqual(relationships, [{ tenant: 'in.newtown', code: 'in.newtown', hierarchyType: 'WORKSPACE', boundaryType: 'ROOT', parent: null }]);
  assert.equal(f.employees[0].jurisdictions[0].hierarchy, 'WORKSPACE');
  assert.equal(f.employees[0].jurisdictions[0].boundaryType, 'ROOT');
  f.employees.length = 0;
  await bootstrapPlatform({ target_tenant: 'in.newtown', country: 'IN' }, f.options);
  assert.equal(hierarchies.length + entities.length + relationships.length, 3, 'a replay creates nothing');
});

test('city_setup never inherits the reserved ROOT level as city geography (#2269 review item 4)', async () => {
  const { ToolRegistry } = await import('./src/tools/registry.js');
  const { registerMdmsTenantTools } = await import('./src/tools/mdms-tenant.js');
  const { digitApi } = await import('./src/services/digit-api.js');
  const registry = new ToolRegistry(); registerMdmsTenantTools(registry);
  const created: { tenant: string; type: string; levels: string[] }[] = [], related: string[] = [];
  const stubs: Record<string, unknown> = {
    isAuthenticated: () => true,
    getAuthInfo: () => ({ authenticated: true, user: { userName: 'admin', tenantId: 'in', roles: [{ code: 'SUPERUSER', tenantId: 'in' }] } }),
    getLoginPassword: () => 'test-only-password', generateEncKey: async () => true,
    mdmsV2SearchRaw: async () => [{ isActive: true, data: {} }], mdmsV2Create: async () => ({}),
    userSearch: async () => [], userCreate: async () => ({}), userUpdate: async () => ({}),
    workflowBusinessServiceSearch: async () => [{ businessService: 'PGR' }], workflowBusinessServiceCreate: async () => ({}),
    boundaryHierarchySearch: async () => [{ boundaryHierarchy: [{ boundaryType: 'ROOT', parentBoundaryType: null }] }],
    boundaryHierarchyCreate: async (tenant: string, type: string, levels: any[]) => { created.push({ tenant, type, levels: levels.map(l => l.boundaryType) }); },
    boundaryCreate: async () => [], employeeSearch: async () => [{}],
    boundaryRelationshipCreate: async (_t: string, _c: string, _h: string, type: string) => { related.push(type); return {}; },
  };
  const api = digitApi as any, saved = Object.fromEntries(Object.keys(stubs).map(k => [k, api[k]]));
  Object.assign(api, stubs);
  try {
    const result = JSON.parse(await registry.getTool('city_setup')!.handler({ tenant_id: 'in.newtown', city_name: 'Newtown' }) as string);
    assert.equal(result.steps.boundaries.hierarchyReused, false);
    assert.ok(created.length > 0);
    for (const h of created) assert.ok(!h.levels.includes('ROOT') && h.levels.length > 1, JSON.stringify(h));
    assert.ok(!related.includes('ROOT'));
  } finally { Object.assign(api, saved); }
});

test('gateway bootstrap seeds the role-action floor before its first write, once (#2269 review item 1d, CCRS#1928)', async () => {
  const seed = loadPlatformSeed();
  const floor = seed.records.filter(r => ['ACCESSCONTROL-ACTIONS-TEST.actions-test', 'ACCESSCONTROL-ROLEACTIONS.roleactions'].includes(r.schemaCode));
  const f = fixture();
  const result = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, { ...f.options, direct: false });
  assert.equal(result.summary.access_floor_seeded, floor.length);
  assert.equal(f.sql.length, floor.length);
  assert.ok(f.sql.every(r => r.tenant === 'ke' && r.writesBefore === 0), 'every floor row precedes the first gateway write');
  assert.ok(f.sql.filter(r => r.schemaCode === 'ACCESSCONTROL-ROLEACTIONS.roleactions').every(r => r.data.tenantId === 'ke'));
  assert.ok(!JSON.stringify(f.sql).includes('{tenantid}'));
  assert.equal(f.sql.findIndex(r => r.schemaCode === 'ACCESSCONTROL-ROLEACTIONS.roleactions'), floor.findIndex(r => r.schemaCode === 'ACCESSCONTROL-ROLEACTIONS.roleactions'), 'actions land before role-actions');
  const replay = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, { ...f.options, direct: false });
  assert.equal(replay.summary.access_floor_seeded, 0); assert.equal(f.sql.length, floor.length);

  const unreachable = fixture();
  const degraded = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, { ...unreachable.options, direct: false,
    db: { query: async () => { throw new Error('DIGIT database not available'); }, execute: async () => 0 } });
  assert.equal(degraded.summary.access_floor_seeded, 0);
  assert.ok(degraded.results.warnings.some((w: string) => w.includes('CCRS#1928')));

  const direct = fixture();
  await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, direct.options);
  assert.equal(direct.sql.length, 0, 'direct MDMS needs no floor');
  const userOnly = fixture();
  await bootstrapPlatform({ target_tenant: 'ke', country: 'KE', user_only: true }, { ...userOnly.options, direct: false });
  assert.equal(userOnly.sql.length, 0);
});

test('a city bootstrap lists the city under its root as Tenant.<city> and in the root modules (#2269 review item 1c)', async () => {
  for (const direct of [true, false]) {
    const f = fixture();
    await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, { ...f.options, direct });
    await bootstrapPlatform({ target_tenant: 'ke.nairobi', country: 'KE' }, { ...f.options, direct });
    const city = f.row('tenant.tenants/Tenant.ke.nairobi', 'ke');
    assert.ok(city, `city record under the root (direct=${direct})`);
    assert.equal(city.data.code, 'ke.nairobi'); assert.equal(city.data.parent, 'ke');
    assert.equal(f.row('tenant.tenants/ke.nairobi', 'ke.nairobi'), undefined, 'no city-scoped tenant record');
    assert.equal(f.row('tenant.tenants/ke', 'ke').data.code, 'ke');
    for (const module of ['PGR', 'Dashboard']) {
      assert.deepEqual(f.row(`tenant.citymodule/${module}`, 'ke').data.tenants.map((t: any) => t.code), ['ke', 'ke.nairobi'], module);
    }
    const writes = f.writes();
    const replay = await bootstrapPlatform({ target_tenant: 'ke.nairobi', country: 'KE' }, { ...f.options, direct });
    assert.equal(f.writes(), writes, 'a replay writes nothing'); assert.equal(replay.summary.data_copied, 0);
  }
});

test('bootstrap creates the seeded PGR workflow once and reports failures (#2269 review item 1a)', async () => {
  const seed = loadPlatformSeed() as any;
  const f = fixture();
  const first = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, f.options);
  assert.equal(first.success, true); assert.deepEqual(first.results.workflow.created, ['PGR']);
  assert.equal(f.workflows.length, 1);
  assert.equal(f.workflows[0].tenantId, 'ke'); assert.equal(f.workflows[0].business, 'pgr-services');
  assert.equal(f.workflows[0].states.length, seed.workflow[0].states.length);
  assert.ok(!JSON.stringify(f.workflows).includes('{tenantid}'));
  const replay = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, f.options);
  assert.deepEqual(replay.results.workflow.skipped, ['PGR']); assert.equal(f.workflows.length, 1);
  await bootstrapPlatform({ target_tenant: 'ke', country: 'KE', user_only: true }, f.options);
  assert.equal(f.workflows.length, 1, 'user_only touches no workflow');

  const duplicate = fixture();
  duplicate.options.api.workflowBusinessServiceCreate = async () => { throw new Error('BusinessService already exists'); };
  const raced = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, duplicate.options);
  assert.equal(raced.success, true); assert.deepEqual(raced.results.workflow.skipped, ['PGR']);
  const broken = fixture();
  broken.options.api.workflowBusinessServiceCreate = async () => { throw new Error('HTTP 500'); };
  const failed = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, broken.options);
  assert.equal(failed.success, false); assert.equal(failed.summary.workflows_failed, 1);
  assert.match(failed.results.workflow.failed[0], /^PGR: HTTP 500/);
});

test('bootstrap copies the source tenant localization packs as before the seed (#2269 review item 1b)', async () => {
  const f = fixture();
  const msg = (code: string, message: string, module = 'rainmaker-common') => ({ code, message, module });
  const ke = loadPlatformSeed().countryMobileRules.KE;
  // Source pg.citest is thin; its root pg holds the packs. StateInfo lists the locales.
  f.rows.set('pg.citest|common-masters.StateInfo/pg', { tenantId: 'pg.citest', schemaCode: 'common-masters.StateInfo', uniqueIdentifier: 'pg',
    isActive: true, data: { languages: [{ value: 'en_IN' }, { value: 'fr_FR' }] } });
  await f.options.api.localizationUpsert('pg.citest', 'en_IN', [msg('CS_COMMON_SUBMIT', 'Submit (city)'), msg('SERVICEDEFS.WATER', 'Water', 'rainmaker-pgr')]);
  await f.options.api.localizationUpsert('pg', 'en_IN', [msg('CS_COMMON_SUBMIT', 'Submit'), msg('CS_HEADER', 'Complaints', 'rainmaker-pgr'), msg('HR_EMPLOYEE', 'Employee', 'rainmaker-hr')]);
  await f.options.api.localizationUpsert('pg', 'fr_FR', [msg('CS_COMMON_SUBMIT', 'Soumettre')]);
  await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, f.options);
  await f.options.api.localizationUpsert('ke', 'en_IN', [msg('TENANT_TENANTS_KE_NAIROBI', 'Nairobi City County')]);
  const result = await bootstrapPlatform({ target_tenant: 'ke.nairobi', source_tenant: 'pg.citest', user_validation: [ke] }, f.options);
  const at = (tenant: string, locale: string) => new Map((f.messages.get(`${tenant}|${locale}`) ?? []).map((m: any) => [`${m.module}::${m.code}`, m.message]));
  const en = at('ke.nairobi', 'en_IN');
  assert.equal(en.get('rainmaker-common::CS_COMMON_SUBMIT'), 'Submit (city)', 'the source wins over its root');
  assert.equal(en.get('rainmaker-pgr::CS_HEADER'), 'Complaints'); assert.equal(en.get('rainmaker-hr::HR_EMPLOYEE'), 'Employee');
  assert.ok(![...en.keys()].some(k => k.includes('SERVICEDEFS')), 'complaint types stay workspace-owned');
  assert.ok([...en.keys()].some(k => k.startsWith('rainmaker-dashboard::')), 'dashboard pack floor');
  assert.equal(en.get('rainmaker-common::TENANT_TENANTS_KE_NAIROBI'), 'Nairobi');
  assert.equal(at('ke', 'en_IN').get('rainmaker-common::TENANT_TENANTS_KE_NAIROBI'), 'Nairobi City County', 'an existing tenant name is kept');
  assert.equal(at('ke.nairobi', 'fr_FR').get('rainmaker-common::CS_COMMON_SUBMIT'), 'Soumettre');
  assert.deepEqual(result.localizations.map((l: any) => l.locale), ['en_IN', 'fr_FR']);
  assert.equal(result.localizations[0].copied, en.size - 1, 'every en_IN message but the tenant name came from the packs');
  assert.equal(result.summary.localizations_failed, 0); assert.equal(result.success, true);
  assert.ok(f.cacheBusts() >= 1);

  // Without source_tenant nothing is copied and nextSteps says so; user_only copies nothing.
  const none = fixture();
  const bare = await bootstrapPlatform({ target_tenant: 'ke', country: 'KE' }, none.options);
  assert.equal(none.messages.size, 0); assert.ok(bare.nextSteps.some((s: string) => s.includes('source_tenant')));
  const userOnly = fixture();
  await bootstrapPlatform({ target_tenant: 'ke', source_tenant: 'pg', user_validation: [ke], user_only: true }, userOnly.options);
  assert.equal(userOnly.messages.size, 0);

  // A row the service rejects is isolated, counted and fails the run.
  const poisoned = fixture(), upsert = poisoned.options.api.localizationUpsert;
  await upsert('pg', 'en_IN', [msg('GOOD', 'ok'), msg('BAD', 'x')]);
  poisoned.options.api.localizationUpsert = async (tenant: string, locale: string, values: any[]) => {
    if (values.some(v => v.code === 'BAD')) throw new Error('HTTP 400'); return upsert(tenant, locale, values);
  };
  const partial = await bootstrapPlatform({ target_tenant: 'ke', source_tenant: 'pg', user_validation: [ke] }, poisoned.options);
  assert.equal(partial.success, false); assert.equal(partial.summary.localizations_failed, 1);
  assert.ok(poisoned.messages.get('ke|en_IN').some((m: any) => m.code === 'GOOD'));
});

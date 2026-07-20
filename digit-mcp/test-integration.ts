/**
 * Integration test — hits the real DIGIT API.
 *
 * Usage: CRS_ENVIRONMENT=dev CRS_USERNAME=ADMIN CRS_PASSWORD=eGov@123 npx tsx test-integration.ts
 */
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';

const passed: string[] = [];
const failed: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed.push(name);
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed.push(name);
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  console.log('=== CRS Validator MCP — Integration Test ===\n');

  const registry = new ToolRegistry();
  let listChangedCount = 0;
  registry.setToolListChangedCallback(() => { listChangedCount++; });
  registerAllTools(registry);

  // Enable all groups for testing
  registry.enableGroups(['mdms', 'boundary', 'masters', 'employees', 'localization', 'pgr', 'admin', 'idgen', 'location', 'encryption']);

  const call = async (toolName: string, args: Record<string, unknown> = {}) => {
    const tool = registry.getTool(toolName);
    if (!tool) throw new Error(`Tool "${toolName}" not found`);
    const raw = await tool.handler(args);
    return JSON.parse(raw);
  };

  // ── configure ──
  const targetEnv = process.env.CRS_ENVIRONMENT || 'local';
  await test(`configure: login to ${targetEnv}`, async () => {
    const result = await call('configure', { environment: targetEnv });
    if (!result.success) throw new Error(result.error);
    console.log(`         Logged in as: ${result.user?.userName} (${result.user?.roles?.join(', ')})`);
  });

  // ── get_environment_info ──
  await test('get_environment_info', async () => {
    const result = await call('get_environment_info');
    if (!result.success) throw new Error('failed');
    if (!result.authenticated) throw new Error('not authenticated after configure');
    console.log(`         Environment: ${result.current.name} (${result.current.url})`);
  });

  // ── mdms_get_tenants ──
  let tenants: { code: string }[] = [];
  await test('mdms_get_tenants', async () => {
    const result = await call('mdms_get_tenants');
    if (!result.success) throw new Error('failed');
    if (result.count === 0) throw new Error('no tenants found');
    tenants = result.tenants;
    console.log(`         Found ${result.count} tenant(s): ${tenants.map(t => t.code).join(', ')}`);
  });

  // ── validate_tenant ──
  // Prefer pg.citya — it has PGR, MDMS, and HRMS data loaded
  const cityTenant = tenants.find(t => t.code === 'pg.citya')
    || tenants.find(t => t.code.startsWith('pg.'))
    || tenants.find(t => t.code.includes('.'))
    || tenants[0];
  await test('validate_tenant: valid tenant', async () => {
    if (!cityTenant) throw new Error('no tenant to validate');
    const result = await call('validate_tenant', { tenant_id: cityTenant.code });
    if (!result.valid) throw new Error(`tenant ${cityTenant.code} not valid`);
    console.log(`         Validated: ${cityTenant.code}`);
  });

  await test('validate_tenant: invalid tenant', async () => {
    const result = await call('validate_tenant', { tenant_id: 'nonexistent.fake' });
    if (result.valid) throw new Error('should have been invalid');
    console.log(`         Correctly rejected "nonexistent.fake"`);
  });

  // ── mdms_search: departments ──
  // Departments are stored at state level, use state tenant for MDMS queries
  const tenantId = cityTenant?.code || 'pg';
  const stateTenantId = tenantId.split('.')[0]; // pg.citya → pg
  await test('mdms_search: departments', async () => {
    const result = await call('mdms_search', {
      tenant_id: stateTenantId,
      schema_code: 'common-masters.Department',
    });
    if (!result.success) throw new Error('failed');
    console.log(`         Found ${result.count} department(s) for ${stateTenantId}`);
  });

  // ── validate_boundary ──
  await test('validate_boundary', async () => {
    const result = await call('validate_boundary', { tenant_id: tenantId });
    if (!result.success) throw new Error('failed');
    console.log(`         ${result.validation.summary}`);
  });

  // ── validate_departments ──
  await test('validate_departments', async () => {
    const result = await call('validate_departments', { tenant_id: tenantId });
    if (!result.success) throw new Error('failed');
    console.log(`         ${result.validation.summary}`);
  });

  // ── validate_designations ──
  await test('validate_designations', async () => {
    const result = await call('validate_designations', { tenant_id: tenantId });
    if (!result.success) throw new Error('failed');
    console.log(`         ${result.validation.summary}`);
  });

  // ── validate_complaint_types ──
  await test('validate_complaint_types', async () => {
    const result = await call('validate_complaint_types', { tenant_id: tenantId });
    if (!result.success) throw new Error('failed');
    console.log(`         ${result.validation.summary}`);
  });

  // ── validate_employees ──
  await test('validate_employees', async () => {
    const result = await call('validate_employees', { tenant_id: tenantId });
    if (!result.success) throw new Error('failed');
    console.log(`         ${result.validation.summary}`);
  });

  // ── localization_search ──
  await test('localization_search', async () => {
    // Try city tenant first, fall back to state tenant for localization
    let result = await call('localization_search', {
      tenant_id: tenantId,
      locale: 'en_IN',
    });
    if (result.count === 0 && tenantId !== stateTenantId) {
      result = await call('localization_search', {
        tenant_id: stateTenantId,
        locale: 'en_IN',
      });
    }
    if (!result.success) throw new Error('failed');
    console.log(`         Found ${result.count} localization message(s)`);
  });

  // ── workflow_business_services ──
  await test('workflow_business_services', async () => {
    const result = await call('workflow_business_services', {
      tenant_id: tenantId,
      business_services: ['PGR'],
    });
    if (!result.success) throw new Error('failed');
    console.log(`         Found ${result.count} business service(s)`);
    if (result.businessServices?.[0]?.states) {
      console.log(`         PGR states: ${result.businessServices[0].states.map((s: Record<string, unknown>) => s.state || s.applicationStatus).join(' → ')}`);
    }
  });

  // ── pgr_search ──
  await test('pgr_search', async () => {
    const result = await call('pgr_search', { tenant_id: tenantId, limit: 5 });
    if (!result.success) throw new Error('failed');
    console.log(`         Found ${result.count} complaint(s)`);
  });

  // ── access_roles_search ──
  await test('access_roles_search', async () => {
    const result = await call('access_roles_search', { tenant_id: tenantId });
    if (!result.success) throw new Error('failed');
    console.log(`         Found ${result.count} role(s)`);
  });

  // ── idgen_generate ──
  await test('idgen_generate', async () => {
    const result = await call('idgen_generate', {
      tenant_id: stateTenantId,
      id_name: 'pgr.servicerequestid',
    });
    if (!result.success) throw new Error('failed');
    console.log(`         Generated ID: ${result.ids?.[0] || 'none'}`);
  });

  // ── encrypt_data ──
  await test('encrypt_data', async () => {
    const result = await call('encrypt_data', {
      tenant_id: stateTenantId,
      values: ['test-value-123'],
    });
    if (!result.success) throw new Error('failed');
    console.log(`         Encrypted ${result.count} value(s): ${result.encrypted?.[0]?.substring(0, 30)}...`);
  });

  // ── boundary_mgmt_search ──
  await test('boundary_mgmt_search', async () => {
    const result = await call('boundary_mgmt_search', { tenant_id: tenantId });
    if (!result.success) throw new Error('failed');
    console.log(`         Found ${result.count} boundary resource(s)`);
  });

  // ── location_search (may not be available in all envs) ──
  if (targetEnv !== 'local') {
    await test('location_search', async () => {
      const result = await call('location_search', { tenant_id: tenantId });
      if (!result.success) throw new Error('failed');
      console.log(`         Found ${result.count} boundary(s)`);
    });
  } else {
    console.log(`  SKIP  location_search (not available in local env)`);
  }

  // ── Summary ──
  console.log('\n=== Results ===');
  console.log(`Passed: ${passed.length}/${passed.length + failed.length}`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(', ')}`);
    process.exit(1);
  } else {
    console.log('All integration tests passed!');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

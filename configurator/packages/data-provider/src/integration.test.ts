import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from './client/DigitApiClient.js';
import { getResourceConfig } from './providers/resourceRegistry.js';
import { ENDPOINTS } from './client/endpoints.js';

/**
 * Integration tests for DigitApiClient against a live DIGIT API.
 *
 * Environment variables:
 *   DIGIT_URL    - API gateway URL (default: http://localhost:18000 for local Docker,
 *                  or https://chakshu-digit.egov.org.in for remote)
 *   DIGIT_USER   - Login username (default: ADMIN)
 *   DIGIT_PASS   - Login password (default: eGov@123)
 *   DIGIT_TENANT - Login tenant  (default: pg)
 *
 * Run:
 *   node --import tsx --test src/integration.test.ts
 */
describe('Integration: DigitApiClient against live API', () => {
  const client = new DigitApiClient({
    url: process.env.DIGIT_URL || 'http://localhost:18000',
    stateTenantId: 'pg',
    // The chakshu-digit environment routes MDMS through mdms-v2 prefix
    endpointOverrides: {
      MDMS_SEARCH: '/mdms-v2/v2/_search',
      MDMS_CREATE: '/mdms-v2/v2/_create',
      MDMS_UPDATE: '/mdms-v2/v2/_update',
    },
  });

  before(async () => {
    await client.login(
      process.env.DIGIT_USER || 'ADMIN',
      process.env.DIGIT_PASS || 'eGov@123',
      process.env.DIGIT_TENANT || 'pg',
    );
  });

  it('authenticates successfully', () => {
    assert.ok(client.isAuthenticated());
    const info = client.getAuthInfo();
    assert.ok(info.token);
    assert.ok(info.user);
  });

  it('searches MDMS departments', async () => {
    const records = await client.mdmsSearch('pg', 'common-masters.Department', { limit: 10 });
    assert.ok(records.length > 0, 'Should have at least 1 department');
    assert.ok(records[0].data, 'Should have data field');
  });

  it('searches HRMS employees', async () => {
    const employees = await client.employeeSearch('pg.citya', { limit: 5 });
    assert.ok(employees.length > 0, 'Should have at least 1 employee');
  });

  it('searches PGR complaints', async () => {
    const wrappers = await client.pgrSearch('pg.citya', { limit: 5 });
    assert.ok(wrappers.length > 0, 'Should have at least 1 complaint');
  });

  it('resource registry matches API responses', async () => {
    const deptConfig = getResourceConfig('departments');
    assert.ok(deptConfig);
    const records = await client.mdmsSearch('pg', deptConfig.schema!, { limit: 1 });
    assert.ok(records.length > 0);
    const data = records[0].data;
    assert.ok(data[deptConfig.idField], `Record should have ${deptConfig.idField} field`);
  });
});

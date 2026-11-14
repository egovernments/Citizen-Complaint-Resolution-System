import { describe, it, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitDataProvider } from './dataProvider.js';

// More than one page of tenant rows at the state (deactivated test tenants first): the child-tenant fallback must
// still find a county on page 2.
describe('child-tenant fallbacks page through the active tenant rows', () => {
  it('lists the employees of a county beyond the first 500 tenant rows', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'pg' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const tenants = Array.from({ length: 600 }, (_, i) => ({
      id: `t${i}`, tenantId: 'pg', schemaCode: 'tenant.tenants', uniqueIdentifier: `pg.city${i}`,
      data: { code: `pg.city${i}` }, isActive: true,
      auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
    }));
    const searched: { offset?: number; isActive?: boolean }[] = [];
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string, o: { limit?: number; offset?: number; isActive?: boolean } = {}) => {
      if (schema !== 'tenant.tenants') return [];
      searched.push({ offset: o.offset, isActive: o.isActive });
      return tenants.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100));
    });
    mock.method(client, 'employeeSearch', async (t: string, o: { offset?: number } = {}) =>
      t === 'pg.city550' && !o.offset ? [{ uuid: 'u1', code: 'EMP1', tenantId: t, user: { name: 'Far County Officer' } }] : []);
    const dp = createDigitDataProvider(client, 'pg');
    const res = await dp.getList('employees', { pagination: { page: 1, perPage: 50 }, sort: { field: 'code', order: 'ASC' }, filter: {} });
    assert.ok(res.data.some((e) => String((e as Record<string, unknown>).code ?? '') === 'EMP1'), JSON.stringify(res.data).slice(0, 300));
    assert.deepEqual(searched.map((s) => s.offset), [0, 500]);
    assert.ok(searched.every((s) => s.isActive === true));
  });
});

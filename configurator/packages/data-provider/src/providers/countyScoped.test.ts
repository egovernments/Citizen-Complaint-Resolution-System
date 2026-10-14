import { describe, it, mock, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitDataProvider } from './dataProvider.js';
import { setStateCounties, skipsState, withoutStateRows } from './countyScoped.js';
import type { MdmsRecord } from '../client/types.js';

const row = (tenantId: string, code: string, schemaCode = 'common-masters.Department'): MdmsRecord => ({
  id: `${tenantId}-${code}`, tenantId, schemaCode, uniqueIdentifier: code, data: { code, name: code, active: true }, isActive: true,
  auditDetails: { createdBy: 'x', lastModifiedBy: 'x', createdTime: 1, lastModifiedTime: 1 },
} as MdmsRecord);

// #1550 option B (owner 2026-10-12): a county with no rows of its own for a county-scoped master shows none, never the
// state's; the state's own county (stateCounty, ke.bomet today) keeps the state's rows.
describe('county-scoped masters below the state (option B)', () => {
  afterEach(() => setStateCounties({ ke: 'ke.bomet' }));

  it('drops the state rows at a county outside stateCounty, keeps them at the state and in stateCounty', () => {
    assert.equal(skipsState('ke.kilima', 'common-masters.Department'), true);
    assert.equal(skipsState('ke.kilima.ward1', 'RAINMAKER-PGR.ComplaintHierarchy'), true);
    assert.equal(skipsState('ke.bomet', 'common-masters.Department'), false);
    assert.equal(skipsState('ke.bomet.health', 'common-masters.Department'), false);
    assert.equal(skipsState('ke.bometx', 'common-masters.Department'), true);
    assert.equal(skipsState('ke', 'common-masters.Department'), false);
    assert.equal(skipsState('ke.kilima', 'tenant.tenants'), false);
    const rows = [row('ke', 'D1'), row('ke.kilima', 'D2')];
    assert.deepEqual(withoutStateRows('ke.kilima', 'common-masters.Department', rows).map((r) => r.uniqueIdentifier), ['D2']);
    assert.equal(withoutStateRows('ke.bomet', 'common-masters.Department', rows).length, 2);
    setStateCounties({});
    assert.equal(skipsState('ke.bomet', 'common-masters.Department'), true);
  });

  it('a county with no departments of its own lists none, even when the backend answers the state rows', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'ke' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'ke' });
    const stateRows = [row('ke', 'D1'), row('ke', 'D2')];
    mock.method(client, 'mdmsCount', async () => stateRows.length);
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, o: { offset?: number } = {}) => (o.offset ? [] : stateRows));
    const atCounty = await createDigitDataProvider(client, 'ke.kilima').getList('departments', { pagination: { page: 1, perPage: 50 }, sort: { field: 'code', order: 'ASC' }, filter: {} });
    assert.equal(atCounty.total, 0);
    const atStateCounty = await createDigitDataProvider(client, 'ke.bomet').getList('departments', { pagination: { page: 1, perPage: 50 }, sort: { field: 'code', order: 'ASC' }, filter: {} });
    assert.equal(atStateCounty.total, 2);
  });

  it('a union read at the state root keeps the state and county rows of one id (count and rows agree)', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'ke' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'ke' });
    const rows = [row('ke', 'D1'), row('ke.kilima', 'D1'), row('ke', 'D2')];
    mock.method(client, 'mdmsCount', async () => rows.length);
    mock.method(client, 'mdmsSearch', async (_t: string, _s: string, o: { offset?: number } = {}) => (o.offset ? [] : rows));
    const res = await createDigitDataProvider(client, 'ke').getList('departments', { pagination: { page: 1, perPage: 50 }, sort: { field: 'code', order: 'ASC' }, filter: {} });
    assert.ok(res.total >= 2, String(res.total));
  });
});

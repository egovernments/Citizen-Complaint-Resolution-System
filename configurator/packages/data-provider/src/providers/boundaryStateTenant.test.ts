// A state whose boundaries live at its child tenants (no hierarchy of its own) answered boundary-relationships with
// 400 HIERARCHY_DEFINITION_DOES_NOT_EXIST.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitDataProvider } from './dataProvider.js';

describe('boundaries at a state with no hierarchy of its own', () => {
  let client: DigitApiClient;
  beforeEach(() => { client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'ke' }); });
  afterEach(() => mock.restoreAll());

  it('getList(boundaries) at the state reads only its counties, never boundary-relationships at the state', async () => {
    mock.method(client, 'mdmsSearch', async (_t: string, schema: string) => {
      if (schema !== 'tenant.tenants') return [];
      return ['ke', 'ke.bomet', 'ke.nairobi'].map((code) => ({
        id: code, tenantId: 'ke', schemaCode: schema, uniqueIdentifier: code, data: { code }, isActive: true,
      }));
    });
    mock.method(client, 'boundaryHierarchySearch', async (tenantId: string) =>
      tenantId === 'ke' ? [] : [{ hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'County', parentBoundaryType: null, active: true }] }]);
    const asked: string[] = [];
    mock.method(client, 'boundaryRelationshipSearch', async (tenantId: string) => {
      asked.push(tenantId);
      if (tenantId === 'ke') throw new Error('400 HIERARCHY_DEFINITION_DOES_NOT_EXIST_ERR');
      const code = tenantId === 'ke.bomet' ? 'BOMET' : 'NAIROBI';
      return [{ tenantId, hierarchyType: 'ADMIN', boundary: [{ code, boundaryType: 'County', name: code, children: [] }] }];
    });

    const dp = createDigitDataProvider(client, 'ke');
    const result = await dp.getList('boundaries', { pagination: { page: 1, perPage: 100 }, sort: { field: 'code', order: 'ASC' }, filter: {} });

    assert.deepEqual(asked.sort(), ['ke.bomet', 'ke.nairobi'], 'no boundary-relationships call at the state');
    assert.deepEqual(result.data.map((r) => r.id), ['BOMET', 'NAIROBI']);
  });

  it('a tenant whose definitions cannot be read still asks ADMIN, as before', async () => {
    mock.method(client, 'mdmsSearch', async () => []);
    mock.method(client, 'boundaryHierarchySearch', async () => { throw new Error('503'); });
    const asked: string[] = [];
    mock.method(client, 'boundaryRelationshipSearch', async (tenantId: string, ht?: string) => {
      asked.push(`${tenantId}/${ht}`);
      return [{ tenantId, hierarchyType: 'ADMIN', boundary: [{ code: 'BOMET', boundaryType: 'County', name: 'BOMET', children: [] }] }];
    });
    const dp = createDigitDataProvider(client, 'ke.bomet');
    const result = await dp.getList('boundaries', { pagination: { page: 1, perPage: 100 }, sort: { field: 'code', order: 'ASC' }, filter: {} });
    assert.deepEqual(asked, ['ke.bomet/ADMIN']);
    assert.equal(result.total, 1);
  });
});

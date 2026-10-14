// every boundary-relationships read at a tenant without a hierarchy definition (a state whose
// boundaries live at its counties) answered 400 HIERARCHY_DEFINITION_DOES_NOT_EXIST. The client asks nothing there.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from './DigitApiClient.js';

describe('boundaryRelationshipSearch at a tenant without a hierarchy', () => {
  let client: DigitApiClient;
  let urls: string[];
  let defined: Set<string>;
  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'ke' });
    urls = [];
    defined = new Set(['ke.bomet']);
    mock.method(globalThis, 'fetch', async (url: string, init: { body?: string }) => {
      urls.push(String(url));
      const body = init?.body ? JSON.parse(init.body) : {};
      const json = String(url).includes('boundary-hierarchy-definition')
        ? { BoundaryHierarchy: defined.has(body.BoundaryTypeHierarchySearchCriteria?.tenantId) ? [{ hierarchyType: 'ADMIN' }] : [] }
        : { TenantBoundary: [{ tenantId: 'ke.bomet', hierarchyType: 'ADMIN', boundary: [{ code: 'BOMET' }] }] };
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  });
  afterEach(() => mock.restoreAll());

  it('asks nothing at a tenant whose definitions were read and are none', async () => {
    assert.deepEqual(await client.boundaryRelationshipSearch('ke', 'ADMIN'), []);
    assert.ok(!urls.some((u) => u.includes('boundary-relationships')), urls.join('\n'));
  });

  it('reads a tenant that has the hierarchy, and remembers that it has it', async () => {
    const trees = await client.boundaryRelationshipSearch('ke.bomet', 'ADMIN');
    assert.equal(trees.length, 1);
    await client.boundaryRelationshipSearch('ke.bomet', 'ADMIN');
    assert.equal(urls.filter((u) => u.includes('boundary-hierarchy-definition')).length, 1, 'definition read once');
    assert.equal(urls.filter((u) => u.includes('boundary-relationships')).length, 2);
  });

  it('never caches "none": a hierarchy created later is read', async () => {
    assert.deepEqual(await client.boundaryRelationshipSearch('ke.kilima', 'ADMIN'), []);
    defined.add('ke.kilima');
    assert.equal((await client.boundaryRelationshipSearch('ke.kilima', 'ADMIN')).length, 1);
  });
});

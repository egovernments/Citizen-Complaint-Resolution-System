import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the transport under the service so we can assert the exact _create vs
// _update decision upsertMapConfig makes — that decision is the guard against
// silently rewriting an inherited (parent-tenant) record.
const post = vi.fn();
vi.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    buildRequestInfo: () => ({ apiId: 'test' }),
  },
}));

import { mdmsService } from './mdms';

const SCHEMA = 'RAINMAKER-PGR.MapConfig';

// The first call every upsert makes is the search; queue its response.
const searchReturns = (records: unknown[]) =>
  post.mockResolvedValueOnce({ mdms: records });

const lastCall = () => post.mock.calls[post.mock.calls.length - 1];

beforeEach(() => {
  post.mockReset();
  // Default: create/update echo back a record.
  post.mockResolvedValue({ Mdms: {} });
});

describe('upsertMapConfig tenant guard', () => {
  it('updates in place when the tenant owns an active record', async () => {
    searchReturns([
      {
        id: 'row-1',
        tenantId: 'ke.bomet',
        schemaCode: SCHEMA,
        uniqueIdentifier: 'DEFAULT',
        isActive: true,
        data: { code: 'DEFAULT', wardHighlightColor: '#111111' },
        auditDetails: { createdBy: 'x' },
      },
    ]);

    await mdmsService.upsertMapConfig('ke.bomet', { defaultZoom: 12 });

    const [url, body] = lastCall();
    expect(url).toContain('_update');
    // Immutable identity is round-tripped, not recomputed.
    expect(body.Mdms.uniqueIdentifier).toBe('DEFAULT');
    expect(body.Mdms.id).toBe('row-1');
    // Patch merges over the existing data.
    expect(body.Mdms.data).toMatchObject({ wardHighlightColor: '#111111', defaultZoom: 12 });
  });

  it('does NOT update a record inherited from a parent tenant — it shadows with a create', async () => {
    // Search at the city returns the STATE-ROOT record (mdms-v2 resolves up the
    // tree). Updating it would rewrite ke for every city. Must create instead.
    searchReturns([
      {
        id: 'root-row',
        tenantId: 'ke',
        schemaCode: SCHEMA,
        uniqueIdentifier: '#22394D',
        isActive: true,
        data: { wardHighlightColor: '#22394D' },
      },
    ]);

    await mdmsService.upsertMapConfig('ke.bomet', { defaultZoom: 12 });

    const [url, body] = lastCall();
    expect(url).toContain('_create');
    expect(body.Mdms.tenantId).toBe('ke.bomet');
    // Inherited colour is carried into the shadow record, not dropped...
    expect(body.Mdms.data.wardHighlightColor).toBe('#22394D');
    expect(body.Mdms.data.defaultZoom).toBe(12);
    // ...and the new record is keyed on the stable singleton key, never a value.
    expect(body.Mdms.data.code).toBe('DEFAULT');
    expect(body.Mdms.uniqueIdentifier).toBe('DEFAULT');
  });

  it('creates a fresh record when the tenant has none at all', async () => {
    searchReturns([]);

    await mdmsService.upsertMapConfig('ke.bomet', { boundaryTenantId: 'ke.bomet' });

    const [url, body] = lastCall();
    expect(url).toContain('_create');
    expect(body.Mdms.data.code).toBe('DEFAULT');
    expect(body.Mdms.data.boundaryTenantId).toBe('ke.bomet');
  });

  it('ignores a soft-deleted own record and creates instead of resurrecting it', async () => {
    searchReturns([
      { id: 'dead', tenantId: 'ke.bomet', schemaCode: SCHEMA, uniqueIdentifier: 'DEFAULT', isActive: false, data: { code: 'DEFAULT' } },
    ]);

    await mdmsService.upsertMapConfig('ke.bomet', { defaultZoom: 12 });

    expect(lastCall()[0]).toContain('_create');
  });
});

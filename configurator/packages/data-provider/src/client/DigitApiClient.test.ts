import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from './DigitApiClient.js';
import { ApiClientError, isSessionExpired } from './errors.js';

describe('DigitApiClient', () => {
  let client: DigitApiClient;

  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com' });
  });

  it('starts unauthenticated', () => {
    assert.equal(client.isAuthenticated(), false);
  });

  it('builds request info', () => {
    const info = client.buildRequestInfo();
    assert.equal(info.apiId, 'Rainmaker');
    assert.equal(info.authToken, '');
    assert.ok(info.ts);
  });

  it('sets auth token and user info', () => {
    client.setAuth('test-token', {
      userName: 'admin',
      name: 'Admin',
      tenantId: 'pg',
    });
    assert.equal(client.isAuthenticated(), true);
    const info = client.buildRequestInfo();
    assert.equal(info.authToken, 'test-token');
  });

  it('resolves endpoint with overrides', () => {
    const c = new DigitApiClient({
      url: 'https://test.example.com',
      endpointOverrides: { MDMS_SEARCH: '/mdms-v2/v2/_search' },
    });
    assert.equal(c.endpoint('MDMS_SEARCH'), '/mdms-v2/v2/_search');
    assert.equal(c.endpoint('USER_SEARCH'), '/user/_search');
  });

  it('encodes basic auth isomorphically', () => {
    const encoded = client.basicAuthEncode('user', 'pass');
    assert.equal(encoded, btoa('user:pass'));
  });

  it('clears auth', () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    assert.equal(client.isAuthenticated(), true);
    client.clearAuth();
    assert.equal(client.isAuthenticated(), false);
  });

  it('getAuthInfo returns structured info', () => {
    client.setAuth('tok', { userName: 'a', name: 'A', tenantId: 'pg' });
    const info = client.getAuthInfo();
    assert.equal(info.authenticated, true);
    assert.equal(info.token, 'tok');
    assert.equal(info.user?.userName, 'a');
  });

  it('exposes boundaryUpdate endpoint', () => {
    assert.equal(client.endpoint('BOUNDARY_UPDATE'), '/boundary-service/boundary/_update');
  });

  it('exposes boundaryDelete endpoint', () => {
    assert.equal(client.endpoint('BOUNDARY_DELETE'), '/boundary-service/boundary/_delete');
  });

  it('exposes boundaryRelationshipDelete endpoint', () => {
    assert.equal(client.endpoint('BOUNDARY_RELATIONSHIP_DELETE'), '/boundary-service/boundary-relationships/_delete');
  });

  it('exposes localizationDelete endpoint', () => {
    assert.equal(client.endpoint('LOCALIZATION_DELETE'), '/localization/messages/v1/_delete');
  });
});

describe('DigitApiClient.mdmsCreate phantom-200', () => {
  it('throws MDMS_DUPLICATE when MDMS returns 200 with an empty mdms array', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    // MDMS v2 duplicate creates return HTTP 200 with an empty `mdms` array.
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async () => ({ mdms: [] });
    await assert.rejects(
      () => client.mdmsCreate('pg', 'RAINMAKER-PGR.NotificationRouting', 'PGR.ASSIGN.PENDINGATLME.CITIZEN.SMS', {}),
      /MDMS_DUPLICATE/,
    );
  });
});

describe('DigitApiClient.boundaryHierarchySearch pagination', () => {
  it('walks offset until a short page when listing all types', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    const first = Array.from({ length: 100 }, (_, i) => ({ hierarchyType: `PW_${i}` }));
    const second = [{ hierarchyType: 'ADMIN' }];
    const offsets: number[] = [];
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async (_path: unknown, body: Record<string, unknown>) => {
        const criteria = body.BoundaryTypeHierarchySearchCriteria as { offset: number; limit: number };
        offsets.push(criteria.offset);
        return { BoundaryHierarchy: criteria.offset === 0 ? first : second };
      };

    const result = await client.boundaryHierarchySearch('ke');
    assert.equal(result.length, 101);
    assert.deepEqual(offsets, [0, 100]);
    assert.equal(result[100].hierarchyType, 'ADMIN');
  });

  it('does not page when looking up a single hierarchyType', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    let calls = 0;
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async () => {
        calls += 1;
        return { BoundaryHierarchy: [{ hierarchyType: 'ADMIN' }] };
      };
    const result = await client.boundaryHierarchySearch('ke', 'ADMIN');
    assert.equal(calls, 1);
    assert.equal(result[0].hierarchyType, 'ADMIN');
  });
});

describe('DigitApiClient paged-search guard', () => {
  it('throws rather than returning a truncated total when the page guard is hit', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    let calls = 0;
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async () => {
        calls += 1;
        return {
          BoundaryHierarchy: Array.from({ length: DigitApiClient.SEARCH_PAGE_SIZE }, (_, i) => ({
            hierarchyType: `TYPE_${calls}_${i}`,
          })),
        };
      };

    await assert.rejects(
      () => client.boundaryHierarchySearch('ke'),
      /truncated after 200 pages/,
    );
    assert.equal(calls, DigitApiClient.SEARCH_MAX_PAGES);
  });
});

describe('DigitApiClient.request session handling', () => {
  it('routes a bodyless 401 to the session-expired handler instead of a JSON parse error', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    let expired = 0;
    DigitApiClient.setSessionExpiredHandler(() => { expired += 1; });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;

    try {
      await assert.rejects(
        () => client.mdmsSearch('ke', 'common-masters.Department'),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError);
          assert.equal(err.statusCode, 401);
          assert.equal(err.errors[0].code, 'SESSION_EXPIRED');
          return true;
        },
      );
      assert.equal(expired, 1);
    } finally {
      globalThis.fetch = originalFetch;
      DigitApiClient.setSessionExpiredHandler(null);
    }
  });

  it('reports an HTML error page as an HTTP error, not a parse failure', async () => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('<html>404 Not Found</html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })) as typeof fetch;

    try {
      await assert.rejects(
        () => client.mdmsSearch('ke', 'common-masters.Department'),
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.errors[0].code, 'HTTP_404');
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('isSessionExpired', () => {
  it('matches InvalidAccessTokenException from access-control / Kong', () => {
    assert.equal(
      isSessionExpired(400, [{ code: 'InvalidAccessTokenException', message: 'InvalidAccessTokenException' }]),
      true,
    );
  });
  it('does not match ordinary validation errors', () => {
    assert.equal(
      isSessionExpired(400, [{ code: 'INVALID_SEARCH', message: 'tenantId is required' }]),
      false,
    );
  });
});

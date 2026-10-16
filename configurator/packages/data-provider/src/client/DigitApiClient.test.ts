import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient, exactTenantRow, withCsrRole } from './DigitApiClient.js';
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

  // egov-hrms drops its tenant filter on a code search unless someone in the tenant has the code as username (#2456).
  it('keeps only the tenant\'s rows (and its cities\') from a code search, reading every page', async () => {
    const urls: string[] = [];
    const pages = [[{ tenantId: 'other' }, { tenantId: 'acme.city' }], [{ tenantId: 'acme' }]];
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async (url: unknown) => { urls.push(String(url)); return { Employees: pages.shift() ?? [] }; };
    pages[0].push(...Array.from({ length: 98 }, () => ({ tenantId: 'other' })));
    const rows = await client.employeeSearch('acme', { codes: ['EMP_0002'] });
    assert.deepEqual(rows.map((r) => r.tenantId), ['acme.city', 'acme']);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /offset=100/);
  });

  it('stops a code search at the page guard with an error, not a hang', async () => {
    let calls = 0;
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async () => { calls += 1; return { Employees: Array.from({ length: DigitApiClient.SEARCH_PAGE_SIZE }, () => ({ tenantId: 'other' })) }; };
    await assert.rejects(() => client.employeeSearch('acme', { codes: ['EMP_0002'] }), /truncated after 200 pages/);
    assert.equal(calls, DigitApiClient.SEARCH_MAX_PAGES);
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

describe('DigitApiClient.pgrCreate geoLocation', () => {
  const sentAddress = async (address: Record<string, unknown>) => {
    const client = new DigitApiClient({ url: 'https://test.example.com' });
    let body: { service: { address: Record<string, unknown> } } | undefined;
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async (_path: unknown, sent: unknown) => {
        body = sent as typeof body;
        return { ServiceWrappers: [{}] };
      };
    await client.pgrCreate('pg.citya', 'StreetLightNotWorking', 'test', address);
    return body!.service.address;
  };

  it('sends an empty geoLocation, not (0, 0), when there is no location (#1581)', async () => {
    assert.deepEqual((await sentAddress({ locality: { code: 'L1' } })).geoLocation, {});
    assert.deepEqual((await sentAddress({ locality: { code: 'L1' }, geoLocation: null })).geoLocation, {});
  });

  it('keeps a location the caller passes', async () => {
    const geoLocation = { latitude: -1.29, longitude: 36.82 };
    assert.deepEqual((await sentAddress({ locality: { code: 'L1' }, geoLocation })).geoLocation, geoLocation);
  });
});

describe('withCsrRole — every new employee can file complaints (#2239)', () => {
  const roles = (employee: Record<string, unknown>) =>
    ((employee.user as Record<string, unknown>).roles as Array<{ code: string; tenantId?: string }>).map((r) => `${r.code}@${r.tenantId}`);

  it('adds CSR on the tenant the other roles are tagged with', () => {
    const out = withCsrRole({ code: 'E1', user: { tenantId: 'ke', roles: [{ code: 'GRO', name: 'GRO', tenantId: 'ke' }] } }, 'pg');
    assert.deepEqual(roles(out), ['GRO@ke', 'CSR@ke']);
  });

  it('follows a state-root tag rather than the city tenant', () => {
    const out = withCsrRole({ user: { tenantId: 'pg.citya', roles: [{ code: 'EMPLOYEE', tenantId: 'pg' }] } }, 'pg.citya');
    assert.deepEqual(roles(out), ['EMPLOYEE@pg', 'CSR@pg']);
  });

  it('adds CSR on every role tenant, and CSR on another tenant does not count', () => {
    const out = withCsrRole({ user: { tenantId: 'pg.citya', roles: [{ code: 'CSR', tenantId: 'pg.cityb' }, { code: 'GRO', tenantId: 'pg.citya' }] } }, 'pg.citya');
    assert.deepEqual(roles(out), ['CSR@pg.cityb', 'GRO@pg.citya', 'CSR@pg.citya']);
  });

  it('falls back to the employee tenant and leaves an existing CSR alone', () => {
    assert.deepEqual(roles(withCsrRole({ user: { tenantId: 'ke' } }, 'pg')), ['CSR@ke']);
    assert.deepEqual(roles(withCsrRole({ user: {} }, 'ke')), ['CSR@ke']);
    const has = { user: { roles: [{ code: 'CSR', tenantId: 'ke' }] } };
    assert.equal(withCsrRole(has, 'ke'), has);
  });

  it('leaves an employee without a user untouched', () => {
    const employee = { code: 'E1' };
    assert.equal(withCsrRole(employee, 'ke'), employee);
  });
});

describe('exactTenantRow — never a city\'s employee that shares the code (#2456)', () => {
  const rows = [{ tenantId: 'acme.city', uuid: 'c' }, { tenantId: 'acme', uuid: 'w' }];
  it('picks the row at exactly the tenant', () => {
    assert.equal(exactTenantRow(rows, 'acme', 'EMP_0002')?.uuid, 'w');
    assert.equal(exactTenantRow(rows, 'acme.city', 'EMP_0002')?.uuid, 'c');
  });
  it('has none for a tenant with no row, and refuses to guess between two', () => {
    assert.equal(exactTenantRow(rows, 'other', 'EMP_0002'), undefined);
    assert.throws(() => exactTenantRow([...rows, { tenantId: 'acme', uuid: 'x' }], 'acme', 'EMP_0002'), /More than one employee EMP_0002 in acme/);
  });
});

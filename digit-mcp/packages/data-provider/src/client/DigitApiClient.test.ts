import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient, withCsrRole } from './DigitApiClient.js';

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

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from './DigitApiClient.js';

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

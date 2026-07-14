import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { DigitApiClient } from '../client/DigitApiClient.js';
import { createDigitAuthProvider } from './authProvider.js';

describe('createDigitAuthProvider', () => {
  let client: DigitApiClient;

  beforeEach(() => {
    client = new DigitApiClient({ url: 'https://test.example.com' });
  });

  it('checkAuth throws when not authenticated', async () => {
    const auth = createDigitAuthProvider(client);
    await assert.rejects(() => auth.checkAuth({}), /Not authenticated/);
  });

  it('checkAuth resolves when authenticated', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    await auth.checkAuth({});
  });

  it('getIdentity returns user info', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', uuid: 'abc-123', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    const identity = await auth.getIdentity!();
    assert.equal(identity.fullName, 'Admin');
    assert.equal(identity.id, 'abc-123');
  });

  it('getIdentity falls back to userName when no uuid', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    const identity = await auth.getIdentity!();
    assert.equal(identity.id, 'admin');
  });

  it('getPermissions returns role codes plus a masters capability', async () => {
    client.setAuth('token', {
      userName: 'admin', name: 'Admin', tenantId: 'pg',
      roles: [{ code: 'SUPERUSER', name: 'Super User' }, { code: 'EMPLOYEE', name: 'Employee' }],
    });
    // No policy-fetch mock needed: mdmsSearch hits the network via
    // client.request, which we stub here (same pattern as
    // DigitApiClient.test.ts's phantom-200 test) so the test never makes a
    // real HTTP call and the fetch resolves to "no data" — canView/canEdit
    // then fall back to their documented open-by-default behavior.
    (client as unknown as { request: (...args: unknown[]) => Promise<unknown> }).request =
      async () => ({ mdms: [] });
    const auth = createDigitAuthProvider(client);
    const perms = await auth.getPermissions!({}) as { roles: string[]; masters: { canView: (s?: string) => boolean; canEdit: (s?: string) => boolean } };
    assert.deepEqual(perms.roles, ['SUPERUSER', 'EMPLOYEE']);
    assert.equal(perms.masters.canView('common-masters.Department'), true);
    assert.equal(perms.masters.canEdit('common-masters.Department'), false);
  });

  it('getPermissions returns empty roles and an open-by-default capability when no roles', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    const perms = await auth.getPermissions!({}) as { roles: string[]; masters: { canView: (s?: string) => boolean } };
    assert.deepEqual(perms.roles, []);
    assert.equal(perms.masters.canView('common-masters.Department'), true);
  });

  it('logout clears auth and returns redirect path', async () => {
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const auth = createDigitAuthProvider(client);
    const redirectPath = await auth.logout({});
    assert.equal(client.isAuthenticated(), false);
    assert.equal(redirectPath, '/login');
  });

  it('checkError throws on 401', async () => {
    const auth = createDigitAuthProvider(client);
    await assert.rejects(() => auth.checkError({ status: 401 }), /Authentication error/);
  });

  it('checkError does not throw on 500', async () => {
    const auth = createDigitAuthProvider(client);
    await auth.checkError({ status: 500 });
  });
});

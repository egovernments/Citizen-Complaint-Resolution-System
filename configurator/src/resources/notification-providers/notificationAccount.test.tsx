// @vitest-environment jsdom
//
// #2203: on a workspace with its own Novu organization, every provider call carries the
// workspace (so the bridge acts on THAT organization), the controls follow the bridge's
// `manageable`, and the screen says whose account it shows. On a deployment without
// per-tenant accounts nothing changes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { client } = vi.hoisted(() => ({ client: { stateTenantId: 'acme', token: 'tok' } }));
vi.mock('@/providers/bridge', () => ({
  digitClient: {
    get stateTenantId() { return client.stateTenantId; },
    getAuthInfo: () => ({ token: client.token }),
  },
}));
vi.mock('ra-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ra-core')>()),
  useTranslate: () => (_key: string, options?: { _?: string }) => options?._ ?? _key,
}));

import { createProvider, deleteProvider, fetchNotificationAccount, testSend, withAccount, type NotificationAccount } from './providerApi';
import { accountNotice, canManageProviders } from './useNotificationAccount';
import { NotificationAccountBanner } from './NotificationAccountBanner';

const own: NotificationAccount = { tenantAccountsEnabled: true, mode: 'TENANT', tenantId: 'acme', status: 'PROVISIONED', manageable: true };
const shared: NotificationAccount = { tenantAccountsEnabled: true, mode: 'SHARED', tenantId: 'acme', status: 'NOT_PROVISIONED', manageable: false };

describe('provider calls carry the workspace', () => {
  const fetchSpy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: { _id: 'x' }, account: own }), { status: 200 }));
  beforeEach(() => { client.stateTenantId = 'acme'; vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear(); });
  afterEach(() => vi.unstubAllGlobals());

  it('appends tenantId to every call, without doubling one the path already has', () => {
    expect(withAccount('/x/providers')).toBe('/x/providers?tenantId=acme');
    expect(withAccount('/x/templates?channel=SMS')).toBe('/x/templates?channel=SMS&tenantId=acme');
    expect(withAccount('/x/logs?tenantId=globex')).toBe('/x/logs?tenantId=globex');
    expect(withAccount('/x/providers', '')).toBe('/x/providers');
  });

  it('create, delete and test-send all go to the workspace’s account', async () => {
    await createProvider({ type: 'jasmin', name: 'gw', credentials: { user: 'u' } });
    await deleteProvider({ id: 'i1' });
    await testSend({ channel: 'SMS', to: { phone: '+254712345678' } });
    const urls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(urls).toHaveLength(3);
    for (const url of urls) expect(url).toContain('tenantId=acme');
  });

  it('reads the account block from the integrations list', async () => {
    await expect(fetchNotificationAccount()).resolves.toEqual(own);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('/novu-bridge/novu-adapter/v1/integrations?tenantId=acme');
  });

  it('a session without a state tenant sends no selector (the shared account, as before)', async () => {
    client.stateTenantId = '';
    await deleteProvider({ id: 'i1' });
    expect(String(fetchSpy.mock.calls[0][0])).not.toContain('tenantId=');
  });
});

describe('who may manage, and what the screen says', () => {
  it('the bridge narrows the role check, never widens it', () => {
    expect(canManageProviders(true, own)).toBe(true);
    expect(canManageProviders(true, { ...own, manageable: false })).toBe(false);
    expect(canManageProviders(false, own)).toBe(false);
    expect(canManageProviders(true, null)).toBe(true); // an older bridge: today's behaviour
  });

  it('says nothing where per-tenant accounts are off or unknown', () => {
    expect(accountNotice(null)).toBeNull();
    expect(accountNotice({ ...own, tenantAccountsEnabled: false })).toBeNull();
    // The deployment's own state admin on the shared account: nothing new to say.
    expect(accountNotice({ ...shared, manageable: true })).toBeNull();
  });

  it('a workspace with its own account is told the providers are its own', () => {
    render(<NotificationAccountBanner account={own} />);
    expect(screen.getByTestId('notification-account-banner').textContent).toContain('its own notification account');
  });

  it('a workspace without one is told why it cannot add providers', () => {
    const notice = accountNotice(shared);
    expect(notice?.tone).toBe('warning');
    expect(notice?.english).toContain('does not have its own notification account');
    expect(accountNotice({ ...shared, status: 'PROVISIONING' })?.key).toBe('app.providers.account_provisioning');
  });
});

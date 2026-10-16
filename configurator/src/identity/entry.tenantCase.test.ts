// The state workspace is listed by the identity service under its v3 realm code (KE); it is worked at
// its DIGIT tenant id (ke): the workspace search and the admin check use `ke`.
import { beforeEach, expect, it, vi } from 'vitest';
import { selectContext } from '@/api/onboarding';
import { installDigitContext } from '@/lib/session';
import { searchWorkspace, WORKSPACE_STEPS } from './workspace';
import { digitTenantId, enterWorkspace } from './entry';
vi.mock('@/api/onboarding', () => ({ API_ORIGIN: '', selectContext: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { setEnvironment: vi.fn(), setAuth: vi.fn(), getAuth: () => ({ token: null, user: null }), getEnvironment: () => '', logout: vi.fn() } }));
vi.mock('@/lib/session', () => ({ installDigitContext: vi.fn() }));
vi.mock('./workspace', async () => ({ ...await vi.importActual<typeof import('./workspace')>('./workspace'), searchWorkspace: vi.fn() }));
const DONE = { Workspace: { tenantId: 'ke', legacy: true, status: 'DONE', version: 0, steps: Object.fromEntries(WORKSPACE_STEPS.map(step => [step, { state: 'DONE' }])) }, Probes: null, Rename: null };
const context = (roleTenant: string) => ({ access_token: 'digit', token_type: 'bearer', expires_in: 100, scope: 'read',
  UserRequest: { uuid: 'u', userName: 'admin', tenantId: 'KE', roles: [{ code: 'ACCOUNT_ADMIN', name: 'Admin', tenantId: roleTenant }] } });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(searchWorkspace).mockResolvedValue(DONE as never);
  window.localStorage.setItem('crs-auth-state', JSON.stringify({ tenant: 'KE', targetTenant: 'KE' }));
  Object.defineProperty(window, 'location', { value: { assign: vi.fn() }, writable: true });
});
it('digitTenantId lower-cases a realm code and keeps a tenant id', () => {
  expect(digitTenantId('KE')).toBe('ke');
  expect(digitTenantId(' KE.Bomet ')).toBe('ke.bomet');
  expect(digitTenantId('ke.bomet')).toBe('ke.bomet');
});
for (const roleTenant of ['ke', 'KE']) {
  it(`entering KE (admin role at ${roleTenant}) selects KE and searches the workspace at ke`, async () => {
    vi.mocked(selectContext).mockResolvedValue(context(roleTenant));
    await enterWorkspace('KE');
    expect(selectContext).toHaveBeenCalledWith('KE');
    expect(searchWorkspace).toHaveBeenCalledWith('ke');
    expect(installDigitContext).toHaveBeenCalledWith(expect.anything(), undefined, [1, 2, 3, 4, 5]);
    expect(window.location.assign).toHaveBeenCalledWith('/configurator/manage');
  });
}

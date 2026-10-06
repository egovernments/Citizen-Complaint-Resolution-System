import { beforeEach, expect, it, vi } from 'vitest';
import { selectContext } from '@/api/onboarding';
import { apiClient } from '@/api/client';
import { installDigitContext } from '@/lib/session';
import { searchWorkspace, WORKSPACE_STEPS } from './workspace';
import { enterWorkspace } from './entry';
vi.mock('@/api/onboarding', () => ({ API_ORIGIN: '', selectContext: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { setEnvironment: vi.fn(), setAuth: vi.fn(), getAuth: () => ({ token: null, user: null }), getEnvironment: () => '', logout: vi.fn() } }));
vi.mock('@/lib/session', () => ({ installDigitContext: vi.fn() }));
vi.mock('./workspace', async () => ({ ...await vi.importActual<typeof import('./workspace')>('./workspace'), searchWorkspace: vi.fn() }));
const context = { access_token: 'digit', token_type: 'bearer', expires_in: 100, scope: 'read', UserRequest: { uuid: 'u', userName: 'employee', tenantId: 'acme', roles: [{ code: 'ACCOUNT_ADMIN', name: 'Admin', tenantId: 'acme' }] } };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(selectContext).mockResolvedValue(context); });
it('keeps legacy workspaces open when PGR returns synthetic DONE and null probes', async () => {
  vi.mocked(searchWorkspace).mockResolvedValue({ Workspace: { tenantId: 'acme', legacy: true, status: 'DONE', version: 0, seedVersion: null, updatedAt: null, updatedBy: null, steps: Object.fromEntries(WORKSPACE_STEPS.map(step => [step, { state: 'DONE', updatedAt: null, updatedBy: null }])) }, Probes: null, Rename: null } as never);
  await enterWorkspace('acme');
  expect(selectContext).toHaveBeenCalledWith('acme');
  expect(searchWorkspace).toHaveBeenCalledWith('acme');
  expect(installDigitContext).toHaveBeenCalledWith(context, undefined, [1, 2, 3, 4, 5]);
});
it('installs server setup progress for an incomplete workspace', async () => {
  vi.mocked(searchWorkspace).mockResolvedValue({ Workspace: { steps: Object.fromEntries(WORKSPACE_STEPS.map((step, index) => [step, { state: index === 0 ? 'SKIPPED' : 'NOT_STARTED' }])) } } as never);
  await enterWorkspace('acme');
  expect(installDigitContext).toHaveBeenCalledWith(context, undefined, [1]);
});
it('does not treat PGR dependency failures as legacy readiness', async () => {
  vi.mocked(searchWorkspace).mockRejectedValue(new Error('WORKSPACE_DEPENDENCY_UNAVAILABLE'));
  await expect(enterWorkspace('acme')).rejects.toThrow('WORKSPACE_DEPENDENCY_UNAVAILABLE');
  expect(installDigitContext).not.toHaveBeenCalled();
  expect(apiClient.logout).toHaveBeenCalled();
});
it('does not call the admin-only setup endpoint for ordinary staff', async () => {
  vi.mocked(selectContext).mockResolvedValue({ ...context, UserRequest: { ...context.UserRequest, roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: 'acme' }] } });
  await enterWorkspace('acme');
  expect(searchWorkspace).not.toHaveBeenCalled();
  expect(installDigitContext).toHaveBeenCalledWith(expect.anything(), undefined, [1, 2, 3, 4, 5]);
});

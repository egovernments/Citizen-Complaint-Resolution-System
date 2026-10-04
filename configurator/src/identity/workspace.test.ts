import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '@/api/client';
import { mdmsService } from '@/api/services/mdms';
import { completedSteps, renameWorkspace, searchWorkspace, updateWorkspace, saveInvitationPolicy, validateExpiry, WORKSPACE_STEPS, type Workspace } from './workspace';
const session = vi.hoisted(() => ({ token: 'digit-token' }));
vi.mock('@/api/client', () => ({ apiClient: { post: vi.fn(), buildRequestInfo: () => ({ authToken: session.token }) } }));
vi.mock('@/api/services/mdms', () => ({ mdmsService: { searchRecords: vi.fn(), update: vi.fn() } }));
beforeEach(() => { vi.resetAllMocks(); session.token = 'digit-token'; });
it('uses direct PGR and the DIGIT RequestInfo token for workspace reads', async () => {
  vi.mocked(apiClient.post).mockResolvedValue({ Workspace: {} });
  await searchWorkspace('acme');
  expect(apiClient.post).toHaveBeenCalledWith('/pgr-services/v2/onboarding/workspaces/_search', { RequestInfo: { authToken: 'digit-token' }, tenantId: 'acme' });
});
it('sends setup expected version and step state', async () => {
  await updateWorkspace('acme', 'BRANDING', 'SKIPPED', 2);
  expect(apiClient.post).toHaveBeenCalledWith(expect.stringContaining('/_update'), expect.objectContaining({ tenantId: 'acme', step: 'BRANDING', state: 'SKIPPED', version: 2 }));
});
it('keeps an exact original request version and name on rename retry', async () => {
  const operation = { id: 'r', version: 4, status: 'PENDING' };
  vi.mocked(apiClient.post).mockResolvedValue({ Rename: operation });
  const request = { tenantId: 'acme', version: 3, name: ' Acme Council ' };
  expect(await renameWorkspace(request)).toEqual(operation);
  await renameWorkspace(request);
  expect(vi.mocked(apiClient.post).mock.calls[0]).toEqual(vi.mocked(apiClient.post).mock.calls[1]);
});
it('keeps legacy absent rows open with nullable audit fields and no probe inference', () => {
  const workspace = { legacy: true, status: 'DONE', version: 0, seedVersion: null, updatedAt: null, updatedBy: null,
    steps: Object.fromEntries(WORKSPACE_STEPS.map(step => [step, { state: 'DONE', updatedAt: null, updatedBy: null }])) } as Workspace;
  expect(completedSteps(workspace)).toEqual([1, 2, 3, 4, 5]);
});
it('does not count incomplete steps as complete', () => {
  const workspace = { steps: Object.fromEntries(WORKSPACE_STEPS.map((step, i) => [step, { state: i === 0 ? 'SKIPPED' : 'IN_PROGRESS' }])) } as Workspace;
  expect(completedSteps(workspace)).toEqual([1]);
});
it.each([0, -1, 2161, 1.5, NaN])('rejects invalid invitation expiry %s', hours => expect(() => validateExpiry(hours)).toThrow());
it.each([1, 336, 2160])('accepts invitation expiry %s hours', hours => expect(() => validateExpiry(hours)).not.toThrow());
it('updates only the tenant-owned default MDMS policy and preserves record metadata', async () => {
  const row = { tenantId: 'acme', uniqueIdentifier: 'default', data: { id: 'default', invitationExpiryHours: 336 }, id: 'policy', schemaCode: 'identity.invitationPolicy', isActive: true };
  vi.mocked(mdmsService.searchRecords).mockResolvedValue([{ ...row, tenantId: 'parent' }, row]);
  await saveInvitationPolicy('acme', 1);
  expect(mdmsService.update).toHaveBeenCalledWith(row, { id: 'default', invitationExpiryHours: 1 });
});

it('uses the fresh session token while replaying the same persisted rename body', async () => {
  const original = { tenantId: 'acme', name: 'New Name', version: 3 };
  vi.mocked(apiClient.post).mockResolvedValue({ Rename: { id: 'r', status: 'PENDING' } });
  await renameWorkspace(original);
  session.token = 'fresh-login-token';
  await renameWorkspace(original);
  expect(vi.mocked(apiClient.post).mock.calls[0][1]).toEqual({ ...original, RequestInfo: { authToken: 'digit-token' } });
  expect(vi.mocked(apiClient.post).mock.calls[1][1]).toEqual({ ...original, RequestInfo: { authToken: 'fresh-login-token' } });
  expect(original).toEqual({ tenantId: 'acme', name: 'New Name', version: 3 });
});

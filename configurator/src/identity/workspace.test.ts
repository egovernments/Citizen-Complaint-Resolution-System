import { beforeEach, expect, it, vi } from 'vitest';
import { apiClient, ApiClientError } from '@/api/client';
import { mdmsService } from '@/api/services/mdms';
import { completedSteps, isWorkspaceApiMissing, recordStep, renameWorkspace, searchWorkspace, updateWorkspace, saveInvitationPolicy, validateExpiry, WORKSPACE_STEPS, type Workspace } from './workspace';
const session = vi.hoisted(() => ({ token: 'digit-token' }));
vi.mock('@/api/client', async () => ({ ApiClientError: (await vi.importActual<typeof import('@/api/client')>('@/api/client')).ApiClientError, apiClient: { post: vi.fn(), buildRequestInfo: () => ({ authToken: session.token }) } }));
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

const missing = (status: number) => new ApiClientError([{ code: `HTTP_${status}`, message: 'Not Found' }], status);
it('treats a pgr-services without the workspace API (404/501) as no workspace state', () => {
  expect(isWorkspaceApiMissing(missing(404))).toBe(true);
  expect(isWorkspaceApiMissing(missing(501))).toBe(true);
  expect(isWorkspaceApiMissing(new ApiClientError([{ code: 'WORKSPACE_DEPENDENCY_UNAVAILABLE', message: 'x' }], 503))).toBe(false);
  expect(isWorkspaceApiMissing(new ApiClientError([{ code: 'WORKSPACE_ADMIN_REQUIRED', message: 'x' }], 404))).toBe(false);
  expect(isWorkspaceApiMissing(new Error('network'))).toBe(false);
});
it('records a phase in PGR when the workspace API exists', async () => {
  const steps = (done: number) => Object.fromEntries(WORKSPACE_STEPS.map((step, index) => [step, { state: index < done ? 'DONE' : 'NOT_STARTED' }]));
  vi.mocked(apiClient.post)
    .mockResolvedValueOnce({ Workspace: { version: 7, steps: steps(0) } })
    .mockResolvedValueOnce({ Workspace: { version: 8, steps: steps(1) } });
  expect(await recordStep('acme', 1, false, [])).toEqual([1]);
  expect(apiClient.post).toHaveBeenLastCalledWith(expect.stringContaining('/_update'), expect.objectContaining({ step: 'BRANDING', state: 'DONE', version: 7 }));
});
it('still advances setup when pgr-services has no workspace API', async () => {
  vi.mocked(apiClient.post).mockRejectedValue(missing(404));
  expect(await recordStep('acme', 3, false, [2, 1])).toEqual([1, 2, 3]);
});
it('does not hide real workspace API failures behind the local fallback', async () => {
  vi.mocked(apiClient.post).mockRejectedValue(new ApiClientError([{ code: 'WORKSPACE_VERSION_CONFLICT', message: 'Reload' }], 409));
  await expect(recordStep('acme', 1, false, [])).rejects.toThrow('Reload');
});

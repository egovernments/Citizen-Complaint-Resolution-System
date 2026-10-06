import { beforeEach, expect, it, vi } from 'vitest';
import { hrmsService } from '@/api/services/hrms';
import { mdmsService } from '@/api/services/mdms';
import { searchWorkspaceEmployees, withinWorkspace, workspaceTenants } from './workspaceEmployees';
vi.mock('@/api/services/hrms', () => ({ hrmsService: { searchEmployees: vi.fn() } }));
vi.mock('@/api/services/mdms', () => ({ mdmsService: { getTenants: vi.fn() } }));
const tenants = (...codes: string[]) => codes.map((code) => ({ code, name: code }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mdmsService.getTenants).mockResolvedValue(tenants('ke', 'ke.nairobi', 'ke.mombasa', 'kex', 'kex.city'));
  vi.mocked(hrmsService.searchEmployees).mockImplementation(async (tenantId: string) => [{ uuid: `u-${tenantId}`, code: tenantId, tenantId }] as never);
});
it('a workspace holds its own tenant and its children, never a prefix-sharing or another root', () => {
  expect(withinWorkspace('ke', 'ke')).toBe(true);
  expect(withinWorkspace('ke.nairobi', 'ke')).toBe(true);
  for (const tenantId of ['kex', 'kex.city', 'pg', 'pg.ke', undefined]) expect(withinWorkspace(tenantId, 'ke')).toBe(false);
});
it('lists the workspace tenant first, then its child tenants from the root tenant list', async () => {
  expect(await workspaceTenants('ke')).toEqual(['ke', 'ke.nairobi', 'ke.mombasa']);
  expect(mdmsService.getTenants).toHaveBeenCalledWith('ke');
});
it('falls back to the workspace tenant when the tenant list is unavailable', async () => {
  vi.mocked(mdmsService.getTenants).mockRejectedValue(new Error('MDMS down'));
  expect(await workspaceTenants('ke')).toEqual(['ke']);
});
it('searches HRMS at each workspace tenant, since HRMS filters tenantId exactly', async () => {
  const rows = await searchWorkspaceEmployees('ke', { uuids: ['u'] });
  expect(rows.map((row) => row.tenantId)).toEqual(['ke', 'ke.nairobi', 'ke.mombasa']);
  expect(hrmsService.searchEmployees).toHaveBeenCalledWith('ke.nairobi', { uuids: ['u'] });
  expect(hrmsService.searchEmployees).not.toHaveBeenCalledWith('kex', expect.anything());
});

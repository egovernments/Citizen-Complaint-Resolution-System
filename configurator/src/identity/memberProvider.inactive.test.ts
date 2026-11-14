import { beforeEach, expect, it, vi } from 'vitest';
import type { DataProvider } from 'ra-core';
import { withIdentityMembers } from './memberProvider';
import { removeMember } from './api';
vi.mock('./api', () => ({ linkMember: vi.fn(), removeMember: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { getAuth: () => ({ user: { uuid: 'admin' } }) } }));
vi.mock('@/api/services/hrms', () => ({ hrmsService: { searchEmployees: vi.fn(async () => []) } }));
const inactive = { id: 'u', uuid: 'u', code: 'E1', tenantId: 'acme', isActive: false, employeeStatus: 'EMPLOYED', user: { id: 1, uuid: 'u', tenantId: 'acme', userName: 'x', emailId: 'x@example.org' } };
const base = { getOne: vi.fn(async () => ({ data: inactive })), update: vi.fn(async (_r, p) => ({ data: p.data })) };
beforeEach(() => { vi.clearAllMocks(); base.getOne.mockResolvedValue({ data: inactive }); });

// pE13 (nightly 2026-10-14): editing an employee who is already inactive saves the edit and keeps them inactive; it is
// not a second deactivation (no membership removal, no skipped write).
it('saves an edit of an already inactive employee as an ordinary update', async () => {
  await withIdentityMembers(base as unknown as DataProvider, 'acme').update('employees', { id: 'u', data: { ...inactive, isActive: false, user: { ...inactive.user, name: 'Renamed' } }, previousData: inactive });
  expect(base.update).toHaveBeenCalledTimes(1);
  expect(base.update.mock.calls[0][1].data).toMatchObject({ isActive: false, user: { name: 'Renamed' } });
  expect(removeMember).not.toHaveBeenCalled();
});

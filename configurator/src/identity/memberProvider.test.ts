import { beforeEach, expect, it, vi } from 'vitest';
import type { DataProvider } from 'ra-core';
import { withIdentityMembers } from './memberProvider';
import { linkMember, removeMember } from './api';
vi.mock('./api', () => ({ linkMember: vi.fn(), removeMember: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { getAuth: () => ({ user: { uuid: 'admin' } }) } }));
vi.mock('@/api/services/hrms', () => ({ hrmsService: { searchEmployees: vi.fn(async () => []) } }));
const row = { id: 'u', uuid: 'u', code: 'E1', tenantId: 'acme', isActive: true, user: { id: 1, uuid: 'u', tenantId: 'acme', userName: 'immutable', emailId: 'fresh@example.org' } };
const base = { getOne: vi.fn(async () => ({ data: row })), update: vi.fn(async (_r, p) => ({ data: p.data })), create: vi.fn(async (_r, p) => ({ data: { ...p.data, uuid: 'u', id: 'u' } })) };
beforeEach(() => { vi.clearAllMocks(); base.getOne.mockResolvedValue({ data: row }); });
const provider = () => withIdentityMembers(base as unknown as DataProvider, 'acme');
it('preserves fresh identity identifiers and discards submitted password on edit', async () => {
  await provider().update('employees', { id: 'u', data: { user: { name: 'New description', emailId: 'stale@example.org', userName: 'changed', password: 'do-not-write' } }, previousData: row });
  expect(base.update.mock.calls[0][1].data.user).toEqual({ ...row.user, name: 'New description' });
});
it('routes management creates through HRMS then link without a password', async () => {
  await provider().create('employees', { data: { ...row, user: { ...row.user, password: 'do-not-write' } } });
  expect(base.create.mock.calls[0][1].data.user).not.toHaveProperty('password');
  expect(linkMember).toHaveBeenCalledWith('acme', 'u', 'fresh@example.org');
});
it('routes edit-form deactivation through both HRMS and BFF removal', async () => {
  await provider().update('employees', { id: 'u', data: { ...row, isActive: false }, previousData: row });
  expect(base.update.mock.calls[0][1].data.isActive).toBe(false);
  expect(removeMember).toHaveBeenCalledWith('acme', 'u');
});
it('refuses cross-workspace removal before HRMS mutation', async () => {
  base.getOne.mockResolvedValue({ data: { ...row, tenantId: 'other' } });
  await expect(provider().delete('employees', { id: 'u' })).rejects.toThrow('this workspace');
  expect(base.update).not.toHaveBeenCalled(); expect(removeMember).not.toHaveBeenCalled();
});
it('refuses direct tenant renames through the generic editor', async () => {
  await expect(provider().update('tenants', { id: 'acme', data: { name: 'New' }, previousData: { id: 'acme', name: 'Old' } })).rejects.toThrow('Workspace settings');
  expect(base.update).not.toHaveBeenCalled();
});

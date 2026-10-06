import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import MembersPage from './MembersPage';
import { linkMember, members, updateMemberEmail } from './api';
import { hrmsService } from '@/api/services/hrms';
import { removeEmployee } from '@/onboarding/employees/employeesApi';
vi.mock('@/App', () => ({ useApp: () => ({ state: { tenant: 'acme', user: { uuid: 'admin', roles: ['ACCOUNT_ADMIN'] } } }) }));
vi.mock('./api', () => ({ members: vi.fn(), updateMemberEmail: vi.fn(), linkMember: vi.fn() }));
vi.mock('@/api/services/hrms', () => ({ hrmsService: { searchEmployees: vi.fn() } }));
vi.mock('@/api/services/mdms', () => ({ mdmsService: { getTenants: vi.fn(async () => [{ code: 'acme' }, { code: 'acme.city' }, { code: 'acmex' }]) } }));
import { mdmsService } from '@/api/services/mdms';
vi.mock('@/onboarding/employees/employeesApi', () => ({ removeEmployee: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(members).mockResolvedValue([{ subject: 's', digitUuid: 'u', name: 'Employee', email: 'old@example.org', state: 'active', invitationVersion: 1 }]);
  vi.mocked(mdmsService.getTenants).mockResolvedValue([{ code: 'acme' }, { code: 'acme.city' }, { code: 'acmex' }] as never);
  vi.mocked(hrmsService.searchEmployees).mockImplementation(async (tenantId: string) => (tenantId === 'acme'
    ? [{ uuid: 'u', code: 'E1', tenantId: 'acme', user: { uuid: 'u', emailId: 'old@example.org' } }]
    : []) as never);
  vi.mocked(updateMemberEmail).mockResolvedValue({ status: 'verification_sent' });
});
const page = () => render(<MemoryRouter><MembersPage /></MemoryRouter>);
it('uses the BFF for admin email changes and reports verification pending', async () => {
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Change email' }));
  fireEvent.change(screen.getByLabelText('New email for Employee'), { target: { value: 'new@example.org' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send verification' }));
  expect(await screen.findByText(/Verification sent/)).toBeInTheDocument();
  expect(updateMemberEmail).toHaveBeenCalledWith('acme', 'u', 'new@example.org');
  expect(screen.getByText(/old@example.org/)).toBeInTheDocument();
});
it('shows unfinished removal errors and retains the confirm action for retry', async () => {
  vi.mocked(removeEmployee).mockRejectedValueOnce(new Error('Membership removal is unfinished. Retry removal.')).mockResolvedValueOnce(undefined);
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Remove member' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await screen.findByText(/Membership removal is unfinished/);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(removeEmployee).toHaveBeenCalledTimes(2));
});
// D16 (amended): a root workspace binds employees at its child tenants too.
const cityEmployee = { uuid: 'c', code: 'EMP-ACME_CITY-1', tenantId: 'acme.city', isActive: true, user: { uuid: 'c', name: 'City Staff', emailId: 'city@example.org' } };
it('lists child-tenant employees for linking and links them at the workspace', async () => {
  vi.mocked(hrmsService.searchEmployees).mockImplementation(async (tenantId: string) => (tenantId === 'acme.city' ? [cityEmployee] : []) as never);
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Complete invitation for EMP-ACME_CITY-1' }));
  expect(hrmsService.searchEmployees).not.toHaveBeenCalledWith('acmex', expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  await waitFor(() => expect(linkMember).toHaveBeenCalledWith('acme', 'c', 'city@example.org'));
});
it('removes a child-tenant member through the workspace', async () => {
  vi.mocked(members).mockResolvedValue([{ subject: 's', digitUuid: 'c', name: 'City Staff', email: 'city@example.org', state: 'active', invitationVersion: 1 }]);
  vi.mocked(hrmsService.searchEmployees).mockImplementation(async (tenantId: string) => (tenantId === 'acme.city' ? [cityEmployee] : []) as never);
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Remove member' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));
  await waitFor(() => expect(removeEmployee).toHaveBeenCalledWith(cityEmployee, 'acme'));
});

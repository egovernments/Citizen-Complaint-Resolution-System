import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import MembersPage from './MembersPage';
import { members, updateMemberEmail } from './api';
import { hrmsService } from '@/api/services/hrms';
import { removeEmployee } from '@/onboarding/employees/employeesApi';
vi.mock('@/App', () => ({ useApp: () => ({ state: { tenant: 'acme', user: { uuid: 'admin', roles: ['ACCOUNT_ADMIN'] } } }) }));
vi.mock('./api', () => ({ members: vi.fn(), updateMemberEmail: vi.fn(), linkMember: vi.fn() }));
vi.mock('@/api/services/hrms', () => ({ hrmsService: { searchEmployees: vi.fn() } }));
vi.mock('@/onboarding/employees/employeesApi', () => ({ removeEmployee: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(members).mockResolvedValue([{ subject: 's', digitUuid: 'u', name: 'Employee', email: 'old@example.org', state: 'active', invitationVersion: 1 }]);
  vi.mocked(hrmsService.searchEmployees).mockResolvedValue([{ uuid: 'u', code: 'E1', tenantId: 'acme', user: { uuid: 'u', emailId: 'old@example.org' } }] as never);
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

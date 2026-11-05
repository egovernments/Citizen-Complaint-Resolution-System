import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import MembersPage from './MembersPage';
vi.mock('@/App', () => ({ useApp: () => ({ state: { tenant: 'acme', user: { uuid: 'admin', roles: ['ACCOUNT_ADMIN'] } } }) }));
vi.mock('./api', () => ({ members: vi.fn(async () => []), updateMemberEmail: vi.fn(), linkMember: vi.fn() }));
vi.mock('./workspaceEmployees', () => ({ searchWorkspaceEmployees: vi.fn(async () => []) }));
vi.mock('@/onboarding/employees/employeesApi', () => ({ removeEmployee: vi.fn() }));

// cfgreview F24 (#1570): Members sits inside the app layout (no second <main>), and "Create and invite" is a control.
it('renders as a section of the layout with a button-styled create link', async () => {
  const { container } = render(<MemoryRouter><MembersPage /></MemoryRouter>);
  expect(container.querySelector('main')).toBeNull();
  expect(screen.getByTestId('members-page')).toBeTruthy();
  const create = await screen.findByRole('link', { name: 'Create and invite an employee' });
  expect(create.getAttribute('href')).toBe('/manage/employees/create');
  expect(create.className).toMatch(/inline-flex/);
});

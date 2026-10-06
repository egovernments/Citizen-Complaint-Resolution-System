import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiClientError } from '@/api/client';
import WorkspacePage from './WorkspacePage';
import { renameWorkspace, searchWorkspace, invitationPolicy } from './workspace';
vi.mock('@/App', () => ({ useApp: () => ({ state: { tenant: 'acme', user: { roles: ['ACCOUNT_ADMIN', 'MDMS_ADMIN'] } } }) }));
vi.mock('@/onboarding/organisation', () => ({ useOrganisation: () => ({ name: 'Acme', logoUrl: null }), announceOrganisation: vi.fn() }));
vi.mock('@/providers/i18nProvider', () => ({ clearTranslationCache: vi.fn() }));
vi.mock('./workspace', () => ({ searchWorkspace: vi.fn(), renameWorkspace: vi.fn(), invitationPolicy: vi.fn(), saveInvitationPolicy: vi.fn() }));
const view = (version: number, status?: 'PENDING' | 'DONE') => ({ Workspace: { version }, Probes: null, Rename: status ? { id: 'r', name: 'New Name', tenantId: 'acme', version: 4, status, updatedAt: 1 } : null }) as Awaited<ReturnType<typeof searchWorkspace>>;
beforeEach(() => { sessionStorage.clear(); vi.resetAllMocks(); vi.mocked(searchWorkspace).mockResolvedValue(view(3)); vi.mocked(invitationPolicy).mockResolvedValue(null); });
afterEach(() => vi.useRealTimers());
const page = () => render(<MemoryRouter><WorkspacePage /></MemoryRouter>);
it('retains the original request after an ambiguous failure, then offers explicit publication retry', async () => {
  vi.mocked(renameWorkspace).mockRejectedValueOnce(new Error('Network unavailable')).mockResolvedValueOnce(view(4, 'PENDING').Rename!);
  const ui = page();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Change workspace name' })).toBeDisabled());
  fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'New Name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change workspace name' }));
  await screen.findByRole('button', { name: 'Retry name change' });
  vi.mocked(searchWorkspace).mockResolvedValue(view(8, 'PENDING'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry name change' }));
  await screen.findByText(/Name change is pending/);
  expect(vi.mocked(renameWorkspace).mock.calls).toEqual([[{ tenantId: 'acme', version: 3, name: 'New Name' }], [{ tenantId: 'acme', version: 3, name: 'New Name' }]]);
  expect(screen.queryByText('Workspace name updated to New Name.')).not.toBeInTheDocument();
  ui.unmount();
});
it('polls pending publication, uses fresh workspace version for the next rename, and stops on unmount', async () => {
  vi.useFakeTimers();
  vi.mocked(searchWorkspace).mockResolvedValueOnce(view(8, 'PENDING')).mockResolvedValue(view(9, 'DONE'));
  vi.mocked(renameWorkspace).mockResolvedValue({ ...view(10, 'PENDING').Rename!, name: 'Next Name', version: 10 });
  const ui = page();
  await act(async () => {});
  expect(screen.getByText(/Name change to New Name is pending/)).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText('Workspace name updated to New Name.')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Workspace name' }), { target: { value: 'Next Name' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change workspace name' })); });
  expect(renameWorkspace).toHaveBeenCalledWith({ tenantId: 'acme', name: 'Next Name', version: 9 });
  ui.unmount(); const calls = vi.mocked(searchWorkspace).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect(searchWorkspace).toHaveBeenCalledTimes(calls);
});

it('reloads a pending operation and retries its original version instead of the newer setup version', async () => {
  vi.mocked(searchWorkspace).mockResolvedValue(view(12, 'PENDING'));
  vi.mocked(renameWorkspace).mockResolvedValue(view(12, 'DONE').Rename!);
  const ui = page();
  await screen.findByRole('button', { name: 'Retry name change' });
  expect(renameWorkspace).not.toHaveBeenCalled();
  expect(screen.queryByText(/retry automatically/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry name change' }));
  await waitFor(() => expect(renameWorkspace).toHaveBeenCalledWith({ tenantId: 'acme', name: 'New Name', version: 3 }));
  ui.unmount();
});
it.each([401, 403])('keeps an accepted rename after HTTP %s and resumes after fresh login/reload', async status => {
  vi.mocked(searchWorkspace).mockResolvedValue(view(11, 'PENDING'));
  vi.mocked(renameWorkspace).mockRejectedValueOnce(new ApiClientError([{ code: 'DENIED', message: 'Denied' }], status)).mockResolvedValueOnce(view(11, 'DONE').Rename!);
  let ui = page();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry name change' }));
  await screen.findByText(/Sign in again with workspace administrator access/);
  expect(JSON.parse(sessionStorage.getItem('configurator:rename:undefined:acme')!)).toEqual({ tenantId: 'acme', name: 'New Name', version: 3 });
  ui.unmount();
  // API helper reads the current session's token for each call; storage holds only the replay body.
  ui = page();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry name change' }));
  await waitFor(() => expect(renameWorkspace).toHaveBeenCalledTimes(2));
  expect(vi.mocked(renameWorkspace).mock.calls).toEqual([[{ tenantId: 'acme', name: 'New Name', version: 3 }], [{ tenantId: 'acme', name: 'New Name', version: 3 }]]);
  ui.unmount();
});
it('preserves an uncertain request across reload without automatically publishing', async () => {
  const original = { tenantId: 'acme', name: 'Uncertain Name', version: 8 };
  sessionStorage.setItem('configurator:rename:undefined:acme', JSON.stringify(original));
  vi.mocked(searchWorkspace).mockResolvedValue(view(12, 'DONE')); // Historical operation must not erase a later uncertain request.
  vi.mocked(renameWorkspace).mockResolvedValue({ ...view(12, 'PENDING').Rename!, name: original.name, version: 9 });
  const ui = page();
  await screen.findByRole('button', { name: 'Retry name change' });
  await waitFor(() => expect(searchWorkspace).toHaveBeenCalled());
  expect(renameWorkspace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry name change' }));
  await waitFor(() => expect(renameWorkspace).toHaveBeenCalledWith(original));
  ui.unmount();
});

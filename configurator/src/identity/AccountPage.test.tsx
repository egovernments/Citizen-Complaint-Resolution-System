import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import AccountPage from './AccountPage';
import { authMethods, logout, session } from '@/api/onboarding';
import { accountAction, unlinkProvider } from './api';
import { AUTH_STORAGE_KEY } from '@/lib/session';
vi.mock('@/api/onboarding', () => ({ authMethods: vi.fn(), logout: vi.fn(), session: vi.fn() }));
vi.mock('./api', () => ({ accountAction: vi.fn(), unlinkProvider: vi.fn() }));
vi.mock('@/api', () => ({ apiClient: { logout: vi.fn() } }));
vi.mock('@/providers/bridge', () => ({ digitClient: { clearAuth: vi.fn() }, resetProviders: vi.fn() }));
vi.mock('@/lib/telemetry', () => ({ clearUser: vi.fn() }));
vi.mock('@/hooks/useAuthResult', () => ({ useAuthResult: () => ({ result: null, error: null }) }));
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ isAuthenticated: true, authToken: "test-digit-token" }));
  vi.mocked(session).mockResolvedValue({ authenticated: true, account: { actions: ['UPDATE_PASSWORD', 'CONFIGURE_TOTP', 'UPDATE_EMAIL', 'delete_credential', 'idp_link'], credentials: [{ id: 'password', type: 'password', label: 'Password' }, { id: 'otp', type: 'otp', label: 'Phone app' }], providers: [{ alias: 'google' }] }, sessions: [{ id: 's', current: true, surface: 'configurator', createdAt: 1, lastSeenAt: 1 }] });
  vi.mocked(authMethods).mockResolvedValue({ methods: [{ id: 'github', idpHint: 'github', type: 'idp', label: 'GitHub' }] });
});
const page = () => render(<MemoryRouter><AccountPage /></MemoryRouter>);
it('loads metadata on the account view and sends only allowed actions and second factors', async () => {
  page();
  fireEvent.click(await screen.findByRole('button', { name: 'Set or change password' }));
  expect(session).toHaveBeenCalledWith(undefined, true);
  expect(accountAction).toHaveBeenCalledWith('UPDATE_PASSWORD');
  fireEvent.click(screen.getByRole('button', { name: 'Remove second factor: Phone app' }));
  expect(accountAction).toHaveBeenCalledWith('delete_credential', { credentialId: 'otp' });
  expect(screen.queryByRole('button', { name: 'Remove second factor: Password' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Link GitHub' }));
  expect(accountAction).toHaveBeenCalledWith('idp_link', { provider: 'github' });
});
it('surfaces last-method protection from the provider unlink', async () => {
  vi.mocked(unlinkProvider).mockRejectedValue(new Error('Keep at least one sign-in method.'));
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Unlink google' }));
  expect(await screen.findByText('Keep at least one sign-in method.')).toBeInTheDocument();
});
it('signs out others without dropping the initiating local session', async () => {
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Sign out other sessions' }));
  await waitFor(() => expect(logout).toHaveBeenCalledWith('others'));
  expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain("test-digit-token");
});
it('signs out everywhere and clears the local token after acknowledgement', async () => {
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
  await waitFor(() => expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull());
  expect(logout).toHaveBeenCalledWith('all');
});
it('clears the local token before the BFF acknowledges sign-out everywhere', async () => {
  vi.mocked(logout).mockReturnValue(new Promise<void>(() => undefined));
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
  await waitFor(() => expect(logout).toHaveBeenCalledWith('all'));
  expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
});
it('clears the local token but reports a failed sign-out everywhere', async () => {
  vi.mocked(logout).mockRejectedValue(new Error('UNTRUSTED_ORIGIN'));
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
  expect(await screen.findByText(/could not be confirmed\. Other devices may still be signed in/)).toBeInTheDocument();
  expect(logout).toHaveBeenCalledWith('all');
  expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
});
it('keeps this session when signing out other sessions fails', async () => {
  vi.mocked(logout).mockRejectedValue(new Error('Sign-out failed'));
  page(); fireEvent.click(await screen.findByRole('button', { name: 'Sign out other sessions' }));
  expect(await screen.findByText('Sign-out failed')).toBeInTheDocument();
  expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toContain('test-digit-token');
});

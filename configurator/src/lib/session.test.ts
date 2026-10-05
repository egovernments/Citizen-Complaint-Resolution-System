import { beforeEach, expect, it, vi } from 'vitest';
import { logout } from '@/api/onboarding';
import { apiClient } from '@/api';
import { AUTH_STORAGE_KEY, SIGN_OUT_INCOMPLETE_KEY, signOutThisDevice } from './session';
vi.mock('@/api/onboarding', () => ({ API_ORIGIN: '', logout: vi.fn() }));
vi.mock('@/api', () => ({ apiClient: { logout: vi.fn() } }));
vi.mock('@/providers/bridge', () => ({ digitClient: { clearAuth: vi.fn() }, resetProviders: vi.fn() }));
vi.mock('@/lib/telemetry', () => ({ clearUser: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ authToken: 'digit-token' }));
});
it.each([
  ['a 403 UNTRUSTED_ORIGIN', () => Promise.reject(new Error('UNTRUSTED_ORIGIN')), false],
  ['an unreachable BFF', () => Promise.reject(new TypeError('Failed to fetch')), false],
  ['a successful BFF logout', () => Promise.resolve(), true],
])('clears the DIGIT session on %s', async (_label, outcome, confirmed) => {
  window.sessionStorage.setItem(SIGN_OUT_INCOMPLETE_KEY, '1');
  vi.mocked(logout).mockImplementation(outcome);
  await expect(signOutThisDevice()).resolves.toBe(confirmed);
  // An unconfirmed sign-out leaves the BFF cookie live, so the login page must not resume it.
  expect(window.sessionStorage.getItem(SIGN_OUT_INCOMPLETE_KEY)).toBe(confirmed ? null : '1');
  expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  expect(apiClient.logout).toHaveBeenCalled();
  expect(logout).toHaveBeenCalledWith('current');
});
it('clears local state before revoking the BFF session', async () => {
  vi.mocked(logout).mockImplementation(async () => {
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
  await signOutThisDevice('all');
  expect(logout).toHaveBeenCalledWith('all');
});

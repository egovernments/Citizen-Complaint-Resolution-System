/**
 * The configurator's login lives in this tab only (#224). The point of these
 * tests: no admin token is ever written to localStorage, and a copy an older
 * build left there is taken into the tab once and then gone, so it cannot
 * outlive the first page load after the update.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AUTH_STORAGE_KEY, readSavedAuth, saveAuth, clearSavedAuth } from './authStorage';

const LOGIN = JSON.stringify({ isAuthenticated: true, authToken: 'tok', user: { name: 'Admin' }, tenant: 'ke' });

describe('authStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('saves the login in this tab only, never in localStorage', () => {
    saveAuth(LOGIN);
    expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe(LOGIN);
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(readSavedAuth()).toBe(LOGIN);
  });

  it('has nothing to restore in a new tab', () => {
    expect(readSavedAuth()).toBeNull();
  });

  it("takes an older build's localStorage copy into the tab once, and deletes it", () => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, LOGIN);
    expect(readSavedAuth()).toBe(LOGIN);
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBe(LOGIN);
  });

  it("keeps this tab's own login over an older build's copy, and still deletes the copy", () => {
    const mine = JSON.stringify({ isAuthenticated: true, authToken: 'mine' });
    window.sessionStorage.setItem(AUTH_STORAGE_KEY, mine);
    window.localStorage.setItem(AUTH_STORAGE_KEY, LOGIN);
    expect(readSavedAuth()).toBe(mine);
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  it('clearing removes the login from the tab and any leftover copy', () => {
    saveAuth(LOGIN);
    window.localStorage.setItem(AUTH_STORAGE_KEY, LOGIN);
    clearSavedAuth();
    expect(window.sessionStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});

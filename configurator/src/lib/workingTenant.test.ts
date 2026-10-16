import { afterEach, expect, it } from 'vitest';
import { setWorkingTenant } from './workingTenant';

// digit-3 P0 (2026-10-14): a state admin (home tenant ke) who enters ke.bomet works at ke.bomet.
afterEach(() => localStorage.clear());

it('moves the saved session to the entered workspace', () => {
  localStorage.setItem('crs-auth-state', JSON.stringify({ isAuthenticated: true, tenant: 'ke', targetTenant: 'ke', authToken: 't' }));
  setWorkingTenant('ke.bomet');
  expect(JSON.parse(localStorage.getItem('crs-auth-state') as string)).toMatchObject({ tenant: 'ke.bomet', targetTenant: 'ke.bomet', authToken: 't' });
});

it('does nothing without a session or a tenant', () => {
  setWorkingTenant('ke.bomet');
  expect(localStorage.getItem('crs-auth-state')).toBeNull();
  localStorage.setItem('crs-auth-state', JSON.stringify({ tenant: 'ke' }));
  setWorkingTenant('');
  expect(JSON.parse(localStorage.getItem('crs-auth-state') as string).tenant).toBe('ke');
});

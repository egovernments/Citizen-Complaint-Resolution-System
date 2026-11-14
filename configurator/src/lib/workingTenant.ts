/**
 * ours (digit-3 P0, 2026-10-14): the working tenant is the workspace the person entered (contexts/_select's tenant).
 * installDigitContext stores the user record's tenantId, which is their HOME tenant (a state admin's is the state), so
 * every list queried the state root: an admin signed in at ke.bomet saw 0 complaints and the state's 2 employees in
 * the org chart. Applied right after installDigitContext, to the same saved session (crs-auth-state).
 */
const AUTH_STORAGE_KEY = 'crs-auth-state'; // src/lib/session.ts AUTH_STORAGE_KEY

export function setWorkingTenant(tenant: string | undefined | null): void {
  const t = (tenant ?? '').trim();
  if (!t) return;
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ ...JSON.parse(raw), tenant: t, targetTenant: t }));
  } catch {
    // storage blocked or unreadable: the session keeps the home tenant
  }
}

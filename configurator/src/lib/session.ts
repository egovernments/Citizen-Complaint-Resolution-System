import { apiClient } from '@/api';
import { digitClient, resetProviders } from '@/providers/bridge';
import { clearUser } from '@/lib/telemetry';
import { API_ORIGIN, logout as identityLogout, type DigitContext, type SessionUser } from '@/api/onboarding';

/** The one blob App restores a DIGIT session from. */
export const AUTH_STORAGE_KEY = 'crs-auth-state';
export const SESSION_EXPIRED_KEY = 'crs-session-expired';
/**
 * Set when sign-out cleared the local session but the identity BFF did not
 * confirm it. Its HttpOnly cookie may then still be live, so the login page
 * must not silently resume that session. Cleared by a confirmed sign-out or an
 * explicit sign-in. It lives in localStorage, not sessionStorage, so a new tab
 * or window on a shared device is covered too.
 */
export const SIGN_OUT_INCOMPLETE_KEY = 'crs-sign-out-incomplete';

/**
 * Drop the DIGIT half of a session: the stored token, both API clients and the
 * cached providers built from them.
 *
 * This is separate from the identity BFF's own `logout()`, and both have to
 * run. Revoking only the identity session leaves the DIGIT token sitting in
 * localStorage, where App restores it on the next visit to `/` or `/manage`,
 * so the operator is signed out of one thing and still signed in to the other.
 *
 * It deliberately does not touch React state, so it can be called from anywhere
 * without reaching into App's context. Callers that are not App itself should
 * follow it with a full-page navigation, which is what makes App re-initialise
 * from the now-empty storage rather than keeping a stale in-memory session.
 */
export function clearLocalSession(): void {
  // The stored token goes first and on its own. It is the half that survives a
  // reload, so it must not be left behind because a later step threw.
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Private windows and blocked site data both throw on access.
  }
  for (const step of [() => apiClient.logout(), () => digitClient.clearAuth(), resetProviders, clearUser]) {
    try {
      step();
    } catch {
      // In-memory teardown, and one failing must not skip the rest.
    }
  }
}

/** True when this browser's last sign-out could not be confirmed by the BFF. */
export function signOutIncomplete(): boolean {
  try {
    return window.localStorage.getItem(SIGN_OUT_INCOMPLETE_KEY) === '1';
  } catch {
    return false;
  }
}

/** An explicit sign-in or sign-up: the user chose to continue despite the warning. */
export function clearSignOutIncomplete(): void {
  try {
    window.localStorage.removeItem(SIGN_OUT_INCOMPLETE_KEY);
  } catch {
    // Storage can be unavailable; authentication itself does not depend on it.
  }
}

/**
 * Sign this device out. Fails open: the DIGIT token is cleared first, so a BFF
 * outage or a 403 (e.g. UNTRUSTED_ORIGIN) can never leave a shared device
 * signed in. Revoking the identity session is then best-effort; its cookie is
 * HttpOnly, so when revocation fails SIGN_OUT_INCOMPLETE_KEY stops the login
 * page from resuming it. Resolves to whether the BFF confirmed the sign-out.
 */
export async function signOutThisDevice(scope: 'current' | 'all' = 'current'): Promise<boolean> {
  clearLocalSession();
  let confirmed = false;
  try {
    await identityLogout(scope);
    confirmed = true;
  } catch {
    // The local session is already gone; the identity session may not be.
  }
  try {
    if (confirmed) window.localStorage.removeItem(SIGN_OUT_INCOMPLETE_KEY);
    else window.localStorage.setItem(SIGN_OUT_INCOMPLETE_KEY, '1');
  } catch {
    // Private windows and blocked site data both throw on access.
  }
  return confirmed;
}

/**
 * Install the ordinary DIGIT session returned by the BFF. Both Configurator
 * sign-in and self-serve signup end here, so keeping this in one place prevents
 * the two surfaces from drifting on identity fields or tenant scope.
 */
export function installDigitContext(
  context: DigitContext,
  identityUser?: Pick<SessionUser, 'name' | 'email'> | null,
  completedPhases: number[] = [1, 2, 3, 4, 5],
): void {
  const { UserRequest: user, access_token: authToken } = context;
  window.localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      isAuthenticated: true,
      user: {
        name: user.name || identityUser?.name || user.userName,
        email: user.emailId || identityUser?.email || '',
        roles: user.roles?.map((role) => role.code) ?? [],
        uuid: user.uuid,
        id: user.id,
        mobileNumber: user.mobileNumber,
      },
      environment: API_ORIGIN || window.location.origin,
      tenant: user.tenantId,
      targetTenant: user.tenantId,
      currentPhase: 1,
      completedPhases,
      authToken,
    }),
  );
}

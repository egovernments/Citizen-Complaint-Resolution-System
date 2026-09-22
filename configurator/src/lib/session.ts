import { apiClient } from '@/api';
import { digitClient, resetProviders } from '@/providers/bridge';
import { clearUser } from '@/lib/telemetry';

/** The one blob App restores a DIGIT session from. */
export const AUTH_STORAGE_KEY = 'crs-auth-state';

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

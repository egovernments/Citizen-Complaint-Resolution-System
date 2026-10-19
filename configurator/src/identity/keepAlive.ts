import { useEffect } from 'react';
import { session } from '@/api/onboarding';

/** At most this often, activity checks in with the identity BFF. Keycloak's access token lasts 5 minutes and its session idles out after 30. */
export const KEEP_ALIVE_MS = 5 * 60_000;

/**
 * While someone is working, check in with the identity BFF now and then. Most setup steps only call
 * DIGIT, whose token outlives the identity session, so the session idled out mid-setup and inviting
 * employees then failed (#2456). Each check lets the BFF refresh the session; time away still ends it.
 */
export function useIdentityKeepAlive(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const onActivity = () => {
      if (Date.now() - last < KEEP_ALIVE_MS) return;
      last = Date.now();
      // A failed check changes nothing: the next call that needs the session says so.
      void session().catch(() => undefined);
    };
    const events = ['pointerdown', 'keydown'] as const;
    for (const event of events) window.addEventListener(event, onActivity, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, onActivity);
    };
  }, [active]);
}

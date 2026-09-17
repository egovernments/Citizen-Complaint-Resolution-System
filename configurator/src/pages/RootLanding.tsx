import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { session } from '@/api/onboarding';

/**
 * Where an unauthenticated visitor to `/` actually belongs (CCRS#1999).
 *
 * The identity BFF finishes sign-in by redirecting to one configured URL for
 * the whole deployment — `IDENTITY_POST_LOGIN_REDIRECT`, whose shipped example
 * is `<PUBLIC_URL>/`. There is no per-request return path: `/identity/v1/callback`
 * ends in a fixed `303` and the login attempt it consumes carries no
 * destination. So the app root is the landing pad for a completed sign-in, and
 * working out where that person was headed is this component's job.
 *
 * Without it the root guard sees no legacy `crs-auth-state` blob and sends a
 * founder who just verified their email to the operator login — a username,
 * password and tenant code they do not have.
 *
 * Any live identity session goes to `/signup`, which is deliberately the only
 * decision made here. SignupPage's own bootstrap already fans a session out
 * into resume / tenant chooser / stuck / signed-out, and duplicating that
 * branch would be a second copy to keep in step with the contract.
 */
const PROBE_TIMEOUT_MS = 2000;

export default function RootLanding() {
  const [destination, setDestination] = useState<'/signup' | '/login' | null>(null);

  useEffect(() => {
    let live = true;
    // A deployment that does not run the identity BFF answers this path with a
    // 404, and a wedged proxy may not answer at all. Neither should hold the
    // operator login hostage, so anything other than a clear "signed in"
    // resolves to the legacy route.
    const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    session(timeout)
      .then((current) => {
        if (live) setDestination(current.authenticated ? '/signup' : '/login');
      })
      .catch(() => {
        if (live) setDestination('/login');
      });
    return () => {
      live = false;
    };
  }, []);

  if (!destination) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing you in…
      </div>
    );
  }

  return <Navigate to={destination} replace />;
}

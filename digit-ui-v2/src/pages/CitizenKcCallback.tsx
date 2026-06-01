/**
 * Keycloak OAuth2 Authorization Code callback page.
 *
 * Route: /citizen/auth/callback  (mounted in App.tsx as "/auth/callback"
 * under the /citizen basename).
 *
 * Flow on mount:
 *   1. Parse `code` + `state` from window.location.search.
 *   2. Verify state matches the persisted one (single-use, anti-CSRF).
 *   3. POST /token to exchange code for tokens.
 *   4. Save tokens to localStorage (keys in KC_STORAGE_KEYS).
 *   5. (Best-effort) fetch /userinfo via the overlay to seed AppContext.
 *   6. Navigate to /dashboard on success, /login?error=... on failure.
 *
 * The page renders only a tiny status string — it's expected to live for
 * about one round-trip then redirect away. If something goes wrong we send
 * the user back to /login with an `error` query param so the login page
 * can surface it via its existing Alert component.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  consumeAndVerifyState,
  exchangeCodeForTokens,
  saveKcTokens,
  clearKcTokens,
} from '@/api/keycloak';
import { apiClient, getApiBaseUrl } from '@/api';
import { useApp } from '@/App';

const CITY_TENANT = (import.meta.env.VITE_CITIZEN_TENANT as string) || 'ke.nairobi';
const REDIRECT_PATH = '/citizen/auth/callback';

interface UserInfoResponse {
  sub?: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  phone_number?: string;
}

export default function CitizenKcCallback() {
  const navigate = useNavigate();
  const { login } = useApp();
  // React 19 in StrictMode mounts effects twice; guard so we don't burn the
  // single-use authorization code on the dev-mode replay.
  const didRunRef = useRef(false);
  const [status, setStatus] = useState<'pending' | 'error'>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;

    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const oauthError = params.get('error');

      if (oauthError) {
        const desc = params.get('error_description') || oauthError;
        clearKcTokens();
        setErrorMessage(desc);
        setStatus('error');
        navigate(`/login?error=${encodeURIComponent(desc)}`, { replace: true });
        return;
      }

      if (!code || !consumeAndVerifyState(state)) {
        const msg = 'Sign-in could not be verified. Please try again.';
        clearKcTokens();
        setErrorMessage(msg);
        setStatus('error');
        navigate(`/login?error=${encodeURIComponent(msg)}`, { replace: true });
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code, REDIRECT_PATH);
        saveKcTokens(tokens);

        // Best-effort identity hydration. The overlay exposes /userinfo
        // proxied to Keycloak. If it fails (network blip, misconfig) we
        // still proceed to /dashboard — the AppContext can fall back to a
        // placeholder name and the protected pages will fetch their own
        // citizen profile.
        let display = { name: 'Citizen', mobile: '', uuid: '' as string | undefined };
        try {
          const res = await fetch(`${getApiBaseUrl()}/userinfo`, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          if (res.ok) {
            const info = (await res.json()) as UserInfoResponse;
            display = {
              name: info.name || info.preferred_username || 'Citizen',
              mobile: info.phone_number || info.preferred_username || '',
              uuid: info.sub,
            };
          }
        } catch {
          // Swallow — best-effort.
        }

        // Seed apiClient so subsequent overlay-routed DIGIT calls carry the
        // KC bearer (DigitApiClient now reads it from localStorage too, but
        // legacy fetch sites in pages/hooks read apiClient.getAuth().token).
        apiClient.setEnvironment(window.location.origin);
        apiClient.setAuth(tokens.access_token, {
          id: 0,
          uuid: display.uuid ?? '',
          userName: display.mobile,
          name: display.name,
          mobileNumber: display.mobile,
          type: 'CITIZEN',
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: CITY_TENANT }],
          tenantId: CITY_TENANT,
        });
        apiClient.setTenantId(CITY_TENANT);

        login(
          {
            name: display.name,
            mobile: display.mobile,
            uuid: display.uuid,
            type: 'CITIZEN',
          },
          CITY_TENANT,
        );
        navigate('/dashboard', { replace: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sign-in failed.';
        clearKcTokens();
        setErrorMessage(msg);
        setStatus('error');
        navigate(`/login?error=${encodeURIComponent(msg)}`, { replace: true });
      }
    })();
    // We deliberately depend on nothing — this is one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-4">
          {status === 'pending' ? (
            <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
              <span
                aria-hidden
                className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
              />
              <span>Signing you in&hellip;</span>
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage ?? 'Sign-in failed.'}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Citizen login — mobile + fixed OTP (123456 on local dev).
 *
 * Auth model (verified against egov-user, 2026-05-17):
 *
 *   /user-otp/v1/_send       Kong request-termination, always returns 200.
 *                            We call it for parity with digit-ui-esbuild's
 *                            flow even though it doesn't actually mint an
 *                            OTP — useful as a typo-safety beat before the
 *                            citizen enters the code.
 *   /user/oauth/token        password=<OTP> against
 *                            CITIZEN_LOGIN_PASSWORD_OTP_FIXED_VALUE.
 *                            Returns access_token + UserRequest.
 *   /user/citizen/_create    On a fresh mobile the auth call fails ("Invalid
 *                            login credentials"); we register first (no auth
 *                            required — register returns the token directly)
 *                            and skip the retry.
 *
 * tenantId for the auth + register calls is the STATE tenant, not the
 * city tenant — egov-user keeps citizens at root.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { apiClient, getApiBaseUrl, ENDPOINTS, isKeycloakMode } from '@/api';
import { buildAuthorizeUrl, decodeJwtPayload, passwordGrantViaOverlay, saveKcTokens } from '@/api/keycloak';
import { useApp } from '@/App';

const STATE_TENANT = (import.meta.env.VITE_CITIZEN_STATE_TENANT as string) || 'statea';
const CITY_TENANT = (import.meta.env.VITE_CITIZEN_TENANT as string) || 'statea.citya';

// Read mobile validation config from globalConfigs (injected by nginx/Ansible).
// Falls back to Kenya defaults (+254, 9-10 digits starting with 7 or 1).
function getMobileConfig(): { regex: RegExp; prefix: string; maxLength: number; errorMessage: string } {
  const gc = (window as unknown as Record<string, { getConfig?: (k: string) => Record<string, unknown> | undefined }>)
    .globalConfigs?.getConfig?.('CORE_MOBILE_CONFIGS');
  const pattern = (gc?.mobileNumberPattern as string | undefined) ?? '^0?[17][0-9]{8}$';
  const prefix = (gc?.mobilePrefix as string | undefined) ?? '+254';
  const maxLength = (gc?.mobileNumberLength as number | undefined) ?? 10;
  let regex: RegExp;
  try { regex = new RegExp(pattern); } catch { regex = /^0?[17][0-9]{8}$/; }
  const errorMessage = `Enter a ${maxLength}-digit mobile number`;
  return { regex, prefix, maxLength, errorMessage };
}

type Step = 'mobile' | 'otp';

export default function CitizenLoginPage() {
  const navigate = useNavigate();
  const { login } = useApp();
  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kcMode = isKeycloakMode();
  const mobileCfg = getMobileConfig();

  // Surface errors bubbled up from the Keycloak callback page (e.g. the
  // overlay rejected the JWT or the user denied consent at the KC login
  // screen). Read once, clear the query param so refresh doesn't replay.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromCallback = params.get('error');
    if (fromCallback) {
      setError(fromCallback);
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  async function signInWithGoogle() {
    setError(null);
    setPending(true);
    try {
      // `kc_idp_hint=google` skips the Keycloak account-chooser and
      // redirects straight to Google's OAuth consent screen. The realm
      // must have the `google` IdP provisioned (ansible's keycloak-bootstrap
      // task does this when keycloak_google_client_id is set in host_vars).
      // buildAuthorizeUrl is async because it computes a PKCE
      // code_challenge (SHA-256 via WebCrypto) — the digit-ui client is
      // a public client and the realm requires PKCE.
      const url = await buildAuthorizeUrl('/citizen/auth/callback', 'google');
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Google sign-in.');
      setPending(false);
    }
  }

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!mobileCfg.regex.test(mobile)) {
      setError(mobileCfg.errorMessage);
      return;
    }
    setPending(true);
    try {
      await fetch(`${getApiBaseUrl()}${ENDPOINTS.OTP_SEND}?tenantId=${STATE_TENANT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'citizen-ui', action: '_send' },
          otp: { mobileNumber: mobile, tenantId: STATE_TENANT, type: 'login' },
        }),
      });
      // Kong's mock returns 200 regardless; don't surface the response at all.
      setStep('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send OTP.');
    } finally {
      setPending(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(otp)) {
      setError('OTP is 6 digits.');
      return;
    }
    setPending(true);

    const attemptAuth = async (): Promise<{ token: string; user: Record<string, unknown> } | null> => {
      // In KC mode, route the password grant through the overlay's
      // standard OAuth2 token endpoint. The overlay tries KC first; on
      // KC failure it falls back to DIGIT's /user/oauth/token (using
      // tenantId + userType from the body), then provisions the KC user
      // from the DIGIT result. The SPA gets a KC-signed JWT either way.
      // Crucially this requires NO redirect — the form posts and we
      // stay on the page. Direct KC SSO (Google, etc) happens via the
      // separate "Continue with Google" button.
      if (kcMode) {
        try {
          const tokens = await passwordGrantViaOverlay({
            username: mobile,
            password: otp,
            tenantId: STATE_TENANT,
            userType: 'CITIZEN',
          });
          saveKcTokens(tokens);
          // Decode the access_token payload for a thin user shape — the
          // overlay also exposes /userinfo for richer identity, but the
          // JWT claims are enough to seed app state for the dashboard.
          const claims = decodeJwtPayload(tokens.access_token);
          return {
            token: tokens.access_token,
            user: {
              uuid: claims.sub,
              name: claims.name || `Citizen ${mobile}`,
              userName: mobile,
              mobileNumber: mobile,
              roles: claims.realm_access?.roles?.map((code: string) => ({ code })) ?? [],
            } as Record<string, unknown>,
          };
        } catch {
          return null;   // overlay returns 401 → fall through to register
        }
      }

      const body = new URLSearchParams({
        username: mobile,
        password: otp,
        tenantId: STATE_TENANT,
        userType: 'CITIZEN',
        scope: 'read',
        grant_type: 'password',
      });
      // egov-user-client : (no secret). Matches digit-ui-esbuild's JWT_TOKEN
      // default. Production deploys override via globalConfigs.JWT_TOKEN.
      const res = await fetch(`${getApiBaseUrl()}${ENDPOINTS.AUTH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        },
        body: body.toString(),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { token: data.access_token, user: data.UserRequest };
    };

    const registerThenAuth = async (): Promise<{ token: string; user: Record<string, unknown> } | null> => {
      // Register endpoint returns the access_token directly — no separate
      // auth call needed after a successful register.
      const res = await fetch(`${getApiBaseUrl()}${ENDPOINTS.CITIZEN_REGISTER}?tenantId=${STATE_TENANT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          RequestInfo: { apiId: 'citizen-ui', action: '_create' },
          User: {
            name: `Citizen ${mobile}`,
            username: mobile,
            mobileNumber: mobile,
            otpReference: otp,
            tenantId: STATE_TENANT,
            type: 'CITIZEN',
          },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return { token: data.access_token, user: data.UserRequest };
    };

    try {
      let result = await attemptAuth();
      if (!result) {
        // Fresh mobile — register, which returns the token.
        result = await registerThenAuth();
      }
      if (!result) {
        setError('Login failed. Double-check the OTP (it should be 123456 on this preview).');
        return;
      }

      // Persist into apiClient so subsequent API calls inherit auth.
      apiClient.setAuth(result.token, result.user as unknown as Parameters<typeof apiClient.setAuth>[1]);
      apiClient.setTenantId(CITY_TENANT);

      login(
        {
          name: (result.user.name as string) ?? `Citizen ${mobile}`,
          mobile,
          uuid: result.user.uuid as string,
          type: 'CITIZEN',
        },
        CITY_TENANT,
      );
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Citizen sign in</CardTitle>
          <CardDescription>
            {step === 'mobile'
              ? 'Enter your mobile number to receive a sign-in code.'
              : `We sent a code to ${mobile}. Enter 123456 for this preview.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {kcMode && step === 'mobile' && (
            <div className="space-y-4 mb-4">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={signInWithGoogle}
                disabled={pending}
              >
                Continue with Google
              </Button>
              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 -translate-x-1/2 -top-2.5 bg-card px-2 text-xs text-muted-foreground">
                  Or continue with mobile
                </span>
              </div>
            </div>
          )}
          {step === 'mobile' ? (
            <form onSubmit={sendOtp} className="space-y-4">
              <div>
                <Label htmlFor="mobile">Mobile number</Label>
                <div className="flex items-center mt-1">
                  <span className="px-3 py-2 border rounded-l-md bg-muted text-sm text-muted-foreground">{mobileCfg.prefix}</span>
                  <Input
                    id="mobile"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder={'7' + '0'.repeat(mobileCfg.maxLength - 1)}
                    maxLength={mobileCfg.maxLength}
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                    className="rounded-l-none"
                    required
                  />
                </div>
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Sending…' : 'Send OTP'}
              </Button>
            </form>
          ) : (
            <form onSubmit={verifyOtp} className="space-y-4">
              <div>
                <Label htmlFor="otp">One-time code</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="mt-1"
                  required
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? 'Signing in…' : 'Sign in'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep('mobile');
                  setOtp('');
                  setError(null);
                }}
              >
                Change mobile number
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Citizen login — mobile + fixed OTP (123456 on naipepea).
 *
 * Auth model (verified against egov-user on naipepea, 2026-05-17):
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
 * tenantId for the auth + register calls is the STATE tenant (`ke`), not the
 * city tenant — egov-user keeps citizens at root.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiClient, getApiBaseUrl, ENDPOINTS } from '@/api';
import { useApp } from '@/App';

const STATE_TENANT = (import.meta.env.VITE_CITIZEN_STATE_TENANT as string) || 'ke';
const CITY_TENANT = (import.meta.env.VITE_CITIZEN_TENANT as string) || 'ke.nairobi';

// 9-digit Kenya mobile, must start with 1 or 7. Enforced at egov-user too;
// catching it client-side gives a nicer error than the upstream NPE.
const MOBILE_RE = /^[17][0-9]{8}$/;

type Step = 'mobile' | 'otp';

export default function CitizenLoginPage() {
  const navigate = useNavigate();
  const { login } = useApp();
  const [step, setStep] = useState<Step>('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!MOBILE_RE.test(mobile)) {
      setError('Enter a 9-digit Kenyan mobile number starting with 1 or 7.');
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
          <CardTitle>Nai Pepea — Citizen sign in</CardTitle>
          <CardDescription>
            {step === 'mobile'
              ? 'Enter your Kenyan mobile number to receive a sign-in code.'
              : `We sent a code to ${mobile}. Enter 123456 for this preview.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'mobile' ? (
            <form onSubmit={sendOtp} className="space-y-4">
              <div>
                <Label htmlFor="mobile">Mobile number</Label>
                <div className="flex items-center mt-1">
                  <span className="px-3 py-2 border rounded-l-md bg-muted text-sm text-muted-foreground">+254</span>
                  <Input
                    id="mobile"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="712345678"
                    maxLength={9}
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

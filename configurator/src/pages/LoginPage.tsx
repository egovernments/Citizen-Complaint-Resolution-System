import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, LogOut, Mail } from 'lucide-react';
import {
  type AuthMethod,
  type SessionUser,
  type TenantOption,
  authMethods,
  logout,
  requestPasswordSetup,
  selectContext,
  session,
  startSignIn,
  tenantReadiness,
  tenants,
} from '@/api/onboarding';
import { AuthShell } from '@/components/signup/AuthPanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clearLocalSession, installDigitContext, SESSION_EXPIRED_KEY } from '@/lib/session';
import { useAuthResult } from '@/hooks/useAuthResult';

type Phase = 'loading' | 'methods' | 'tenants' | 'noAccess' | 'setupRequired' | 'entering';

function expiredSessionMessage(): string | null {
  try {
    if (sessionStorage.getItem(SESSION_EXPIRED_KEY)) {
      sessionStorage.removeItem(SESSION_EXPIRED_KEY);
      return 'Your session expired. Sign in again to continue.';
    }
  } catch {
    // Storage can be unavailable; authentication itself does not depend on it.
  }
  return null;
}

export default function LoginPage() {
  const [searchParams] = useSearchParams();
  const authResult = useAuthResult();
  const [phase, setPhase] = useState<Phase>('loading');
  const [methods, setMethods] = useState<AuthMethod[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [identityUser, setIdentityUser] = useState<SessionUser | null>(null);
  const [gatedTenant, setGatedTenant] = useState<TenantOption | null>(null);
  const [error, setError] = useState<string | null>(expiredSessionMessage);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTitle, setNoticeTitle] = useState('Check your email');
  const [showPasswordSetup, setShowPasswordSetup] = useState(
    () => searchParams.get('passwordHelp') === '1',
  );
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      const current = await session();
      if (current.authenticated && current.user) {
        setIdentityUser(current.user);
        const available = await tenants();
        setTenantOptions(available.tenants);
        setPhase(available.tenants.length ? 'tenants' : 'noAccess');
        return;
      }
      const available = await authMethods('signin');
      setMethods(available.methods);
      setPhase('methods');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in is temporarily unavailable.');
      setPhase('methods');
    }
  }, []);

  useEffect(() => {
    // `load` only updates state after its session request settles. The rule
    // follows the function call but does not model that async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const enter = async (option: TenantOption) => {
    setError(null);
    const readiness = tenantReadiness(option);
    if (readiness && readiness !== 'READY') {
      setGatedTenant(option);
      setPhase('setupRequired');
      return;
    }
    setPhase('entering');
    try {
      const context = await selectContext(option.tenantId);
      installDigitContext(context, identityUser);
      window.location.assign('/configurator/manage');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not open that workspace.');
      setPhase('tenants');
    }
  };

  const submitPasswordSetup = async (event: FormEvent) => {
    event.preventDefault();
    // A consumed callback result describes the previous attempt. Once the user
    // starts recovery it must not mask this request's success or failure.
    authResult.clear();
    setShowPasswordSetup(true);
    setSending(true);
    setError(null);
    try {
      const response = await requestPasswordSetup(email);
      setNoticeTitle('Check your email');
      setNotice(response.message);
      setShowPasswordSetup(false);
      setEmail('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not request a password setup link.');
    } finally {
      setSending(false);
    }
  };

  const requestSignedInPasswordSetup = async () => {
    authResult.clear();
    setSending(true);
    setError(null);
    try {
      const response = await requestPasswordSetup();
      setNoticeTitle('Check your email');
      setNotice(response.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not request a password setup link.');
    } finally {
      setSending(false);
    }
  };

  const signOut = async () => {
    clearLocalSession();
    await logout().catch(() => undefined);
    setIdentityUser(null);
    setError(null);
    setNotice(null);
    setShowPasswordSetup(false);
    setPhase('loading');
    await load();
  };

  const resultError = authResult.result?.status === 'failed' ? authResult.result.message : null;
  const resultNotice = authResult.result?.status === 'complete' ? authResult.result.message : null;
  const bannerError = authResult.error || resultError || error;
  const bannerNotice = resultNotice || notice;
  const banner = bannerError ? (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Could not sign in</AlertTitle>
      <AlertDescription>{bannerError}</AlertDescription>
    </Alert>
  ) : bannerNotice ? (
    <Alert>
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      <AlertTitle>{resultNotice && authResult.result?.code === 'PASSWORD_SETUP_COMPLETE' ? 'Password ready' : noticeTitle}</AlertTitle>
      <AlertDescription>{bannerNotice}</AlertDescription>
    </Alert>
  ) : null;

  if (phase === 'loading' || phase === 'entering') {
    return (
      <AuthShell>
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {phase === 'entering' ? 'Opening your workspace…' : 'Loading sign-in…'}
        </div>
      </AuthShell>
    );
  }

  if (phase === 'tenants') {
    return (
      <AuthShell>
        <section className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Signed in</p>
            <h1 className="mt-2 text-[28px] font-semibold leading-[1.15]">Choose a workspace</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {identityUser?.email ? `Signed in as ${identityUser.email}. ` : ''}
              Select the tenant you want to manage.
            </p>
          </div>
          {banner}
          <div className="space-y-3">
            {tenantOptions.map((option) => (
              <Button
                key={option.tenantId}
                variant="outline"
                className="h-auto min-h-11 w-full justify-between px-4 py-3 text-left"
                onClick={() => void enter(option)}
              >
                <span>
                  <span className="block font-semibold text-foreground">{option.name}</span>
                  <span className="block text-xs font-normal text-muted-foreground">{option.tenantId}</span>
                </span>
                <span aria-hidden="true">→</span>
              </Button>
            ))}
          </div>
          <Button
            variant="link"
            className="h-auto w-full p-0"
            disabled={sending}
            onClick={() => void requestSignedInPasswordSetup()}
          >
            {sending && <Loader2 className="mr-2 animate-spin" />}
            Set up or reset your password
          </Button>
          <Button variant="tertiary" className="w-full" onClick={() => void signOut()}>
            <LogOut className="mr-2" /> Sign out
          </Button>
        </section>
      </AuthShell>
    );
  }

  if (phase === 'setupRequired' && gatedTenant) {
    return (
      <AuthShell>
        <section className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Workspace</p>
            <h1 className="mt-2 text-[28px] font-semibold leading-[1.15]">Workspace setup required</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Your identity and membership are ready, but {gatedTenant.name} is not ready for management yet.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            <div className="font-semibold">{gatedTenant.name}</div>
            <div className="text-xs text-muted-foreground">{gatedTenant.tenantId}</div>
          </div>
          <Button variant="outline" className="h-11 w-full" onClick={() => setPhase('tenants')}>
            Choose another workspace
          </Button>
          <Button variant="tertiary" className="w-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        </section>
      </AuthShell>
    );
  }

  if (phase === 'noAccess') {
    return (
      <AuthShell>
        <section className="space-y-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Signed in</p>
            <h1 className="mt-2 text-[28px] font-semibold leading-[1.15]">No workspace access yet</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This identity is valid, but it does not belong to a tenant you can manage.
            </p>
          </div>
          {banner}
          <Button asChild className="h-11 w-full">
            <Link to="/signup">Create a new account</Link>
          </Button>
          <Button
            variant="link"
            className="h-auto w-full p-0"
            disabled={sending}
            onClick={() => void requestSignedInPasswordSetup()}
          >
            {sending && <Loader2 className="mr-2 animate-spin" />}
            Set up or reset your password
          </Button>
          <Button variant="outline" className="h-11 w-full" onClick={() => void signOut()}>
            Sign in another way
          </Button>
        </section>
      </AuthShell>
    );
  }

  const hostedSignIn = methods.find((method) => method.type === 'password');
  return (
    <AuthShell>
      <section className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Welcome back</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[1.15]">Sign in to your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Continue to the secure sign-in page. You will choose a workspace after sign-in.
          </p>
        </div>

        {banner}

        {hostedSignIn ? (
          <Button className="h-11 w-full" onClick={() => startSignIn(hostedSignIn.id, 'signin')}>
            Log in
            <ArrowRight data-icon="inline-end" />
          </Button>
        ) : (
          <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Hosted sign-in is not enabled on this environment.
          </p>
        )}

        {(showPasswordSetup || authResult.result?.actions.includes('SETUP_PASSWORD')) ? (
          <form className="space-y-3 rounded-lg border bg-muted/30 p-4" onSubmit={submitPasswordSetup}>
            <div>
              <label htmlFor="password-setup-email" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Email address
              </label>
              <Input
                id="password-setup-email"
                type="email"
                autoComplete="email"
                className="mt-1 h-11 bg-card"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.org"
                required
              />
            </div>
            <Button type="submit" className="h-11 w-full" disabled={sending}>
              {sending ? <Loader2 className="mr-2 animate-spin" /> : <Mail className="mr-2" />}
              Send password setup link
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              If an eligible account exists, we will email a secure one-use link. We never reveal which sign-in methods an email uses.
            </p>
          </form>
        ) : (
          <Button variant="link" className="h-auto w-full p-0" onClick={() => setShowPasswordSetup(true)}>
            Set up or reset your password
          </Button>
        )}

        <p className="text-center text-sm text-muted-foreground">
          New to DIGIT?{' '}
          <Link to="/signup" className="font-medium text-primary underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </section>
    </AuthShell>
  );
}

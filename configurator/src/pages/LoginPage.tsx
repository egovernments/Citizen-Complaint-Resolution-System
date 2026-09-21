import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Github, KeyRound, Loader2, LogOut, Mail } from 'lucide-react';
import {
  type AuthMethod,
  type AuthResult,
  type SessionUser,
  type TenantOption,
  authMethods,
  consumeAuthResult,
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

type Phase = 'loading' | 'methods' | 'tenants' | 'noAccess' | 'setupRequired' | 'entering';

function MethodIcon({ method }: { method: AuthMethod }) {
  if (method.id.toLowerCase().includes('github')) return <Github aria-hidden="true" />;
  if (method.id.toLowerCase().includes('google')) {
    return <span aria-hidden="true" className="text-base font-semibold leading-none">G</span>;
  }
  return <KeyRound aria-hidden="true" />;
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('loading');
  const [methods, setMethods] = useState<AuthMethod[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [identityUser, setIdentityUser] = useState<SessionUser | null>(null);
  const [gatedTenant, setGatedTenant] = useState<TenantOption | null>(null);
  const [error, setError] = useState<string | null>(expiredSessionMessage);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTitle, setNoticeTitle] = useState('Check your email');
  const [resultActions, setResultActions] = useState<AuthResult['actions']>([]);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
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
    const resultId = searchParams.get('authResult');
    if (resultId) {
      consumeAuthResult(resultId)
        .then((result) => {
          if (result.status === 'complete') {
            setNoticeTitle(result.code === 'PASSWORD_SETUP_COMPLETE' ? 'Password ready' : 'Complete');
            setNotice(result.message);
          } else {
            setError(result.message);
          }
          setResultActions(result.actions);
          if (result.actions.includes('SETUP_PASSWORD')) setShowPasswordSetup(true);
        })
        .catch(() => setError('That sign-in message expired. Please try again.'))
        .finally(() => {
          const next = new URLSearchParams(searchParams);
          next.delete('authResult');
          setSearchParams(next, { replace: true });
        });
    }
    // `load` only updates state after its session request settles. The rule
    // follows the function call but does not model that async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Auth results are deliberately consumed once on the initial landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const signOut = async () => {
    clearLocalSession();
    await logout().catch(() => undefined);
    setIdentityUser(null);
    setError(null);
    setNotice(null);
    setResultActions([]);
    setShowPasswordSetup(false);
    setPhase('loading');
    await load();
  };

  const banner = error ? (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Could not sign in</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : notice ? (
    <Alert>
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      <AlertTitle>{noticeTitle}</AlertTitle>
      <AlertDescription>{notice}</AlertDescription>
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
          <Button variant="outline" className="h-11 w-full" onClick={() => void signOut()}>
            Sign in another way
          </Button>
        </section>
      </AuthShell>
    );
  }

  const [primary, ...alternatives] = methods;
  return (
    <AuthShell>
      <section className="space-y-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-primary">Welcome back</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[1.15]">Sign in to your account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Continue with your password or an identity provider. You will choose a workspace after sign-in.
          </p>
        </div>

        {banner}

        {primary ? (
          <Button className="h-11 w-full" onClick={() => startSignIn(primary.id, 'signin')}>
            <MethodIcon method={primary} /> {primary.label}
          </Button>
        ) : (
          <p className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            No sign-in method is enabled on this environment.
          </p>
        )}

        {alternatives.length > 0 && (
          <>
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">OR</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="space-y-3">
              {alternatives.map((method) => (
                <Button
                  key={method.id}
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => startSignIn(method.id, 'signin')}
                >
                  <MethodIcon method={method} /> {method.label}
                </Button>
              ))}
            </div>
          </>
        )}

        {(showPasswordSetup || resultActions.includes('SETUP_PASSWORD')) ? (
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

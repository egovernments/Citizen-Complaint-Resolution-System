import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, Loader2, Mail, ShieldCheck } from 'lucide-react';
import {
  deriveAccountCode,
  getOnboardingClient,
  isOnboardingConfigured,
  mockOnboardingClient,
  slugifyAccountName,
  type AvailabilityResult,
} from '@/api/onboarding';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stepper } from '@/components/ui/stepper';

const STEPS = [
  { id: 'account', label: 'Account' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'review', label: 'Review' },
];

/** Base countries, with the timezone each one suggests. */
const COUNTRIES: { code: string; name: string; timezone: string }[] = [
  { code: 'KE', name: 'Kenya', timezone: 'Africa/Nairobi' },
  { code: 'IN', name: 'India', timezone: 'Asia/Kolkata' },
  { code: 'ET', name: 'Ethiopia', timezone: 'Africa/Addis_Ababa' },
  { code: 'NG', name: 'Nigeria', timezone: 'Africa/Lagos' },
  { code: 'SN', name: 'Senegal', timezone: 'Africa/Dakar' },
  { code: 'MZ', name: 'Mozambique', timezone: 'Africa/Maputo' },
  { code: 'ZA', name: 'South Africa', timezone: 'Africa/Johannesburg' },
  { code: 'ID', name: 'Indonesia', timezone: 'Asia/Jakarta' },
];

const TIMEZONES = [...new Set(COUNTRIES.map((c) => c.timezone))].sort();
const LANGUAGES = ['English', 'French', 'Portuguese', 'Hindi'];
const FINANCIAL_YEARS = [
  { code: 'JAN', label: 'January to December' },
  { code: 'APR', label: 'April to March' },
  { code: 'JUL', label: 'July to June' },
  { code: 'OCT', label: 'October to September' },
];

/** The account step runs through three states before Preferences opens. */
type AccountPhase = 'details' | 'linkSent' | 'verified';

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

/** Availability line under the code and URL fields. */
function AvailabilityNote({ state, checking }: { state: AvailabilityResult | null; checking: boolean }) {
  if (checking) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking availability…
      </p>
    );
  }
  if (!state) return null;
  if (state.available) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-green-700">
        <Check className="h-3 w-3" /> Available.
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-destructive">
      {state.reason}
      {state.suggestion ? ` Try ${state.suggestion}.` : ''}
    </p>
  );
}

export default function SignupPage() {
  const client = useMemo(() => getOnboardingClient(), []);
  const live = isOnboardingConfigured();

  const [step, setStep] = useState<string>('account');
  const [phase, setPhase] = useState<AccountPhase>('details');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Account
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [accountName, setAccountName] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [codeState, setCodeState] = useState<AvailabilityResult | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);

  // Preferences
  const [country, setCountry] = useState('');
  const [languages, setLanguages] = useState<string[]>(['English']);
  const [timezone, setTimezone] = useState('');
  const [financialYear, setFinancialYear] = useState('JAN');
  const [accountUrl, setAccountUrl] = useState('');
  const [urlTouched, setUrlTouched] = useState(false);
  const [urlState, setUrlState] = useState<AvailabilityResult | null>(null);
  const [urlChecking, setUrlChecking] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Code follows the account name (and later the country) until it is edited by
  // hand, matching the prototype. Once touched, it is the operator's to own.
  useEffect(() => {
    if (codeTouched) return;
    setAccountCode(deriveAccountCode(accountName, country));
  }, [accountName, country, codeTouched]);

  useEffect(() => {
    if (urlTouched) return;
    setAccountUrl(slugifyAccountName(accountName));
  }, [accountName, urlTouched]);

  // Selecting a country suggests its timezone, but never overwrites a choice
  // already made.
  useEffect(() => {
    if (!country) return;
    const match = COUNTRIES.find((c) => c.code === country);
    if (match) setTimezone((current) => current || match.timezone);
  }, [country]);

  // Debounced availability checks. The trailing-call guard stops a slow early
  // response from overwriting the verdict for what is now in the field.
  useEffect(() => {
    const code = accountCode.trim();
    if (!code) { setCodeState(null); return; }
    let stale = false;
    setCodeChecking(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await client.checkAccountCode(code);
        if (!stale) setCodeState(result);
      } finally {
        if (!stale) setCodeChecking(false);
      }
    }, 400);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [accountCode, client]);

  useEffect(() => {
    const slug = accountUrl.trim();
    if (!slug) { setUrlState(null); return; }
    let stale = false;
    setUrlChecking(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await client.checkAccountUrl(slug);
        if (!stale) setUrlState(result);
      } finally {
        if (!stale) setUrlChecking(false);
      }
    }, 400);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [accountUrl, client]);

  const sendLink = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await client.startEmailVerification({ email: email.trim(), firstName, lastName });
      setPhase('linkSent');
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not send the sign-in link.');
    } finally {
      setBusy(false);
    }
  }, [client, email, firstName, lastName]);

  const confirmVerified = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!live) mockOnboardingClient.markVerified(email.trim());
      const ok = await client.isEmailVerified(email.trim());
      if (ok) setPhase('verified');
      else setError('That link has not been opened yet. Check your inbox and try again.');
    } finally {
      setBusy(false);
    }
  }, [client, email, live]);

  const createAccount = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await client.createAccount({
        firstName, lastName, email: email.trim(), accountName, accountCode,
        baseCountry: country, languages, timezone, financialYear, accountUrl,
      });
      setSubmitted(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }, [client, firstName, lastName, email, accountName, accountCode, country, languages, timezone, financialYear, accountUrl]);

  const toggleLanguage = (language: string) =>
    setLanguages((current) =>
      current.includes(language)
        ? current.filter((l) => l !== language)
        : [...current, language],
    );

  const detailsReady = firstName.trim() && lastName.trim() && email.trim().includes('@') && agreed;
  const accountReady = accountName.trim() && accountCode.trim() && codeState?.available === true;
  const preferencesReady = country && timezone && languages.length > 0 && urlState?.available === true;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel. Hidden on small screens so the form owns the viewport. */}
      <aside className="hidden flex-col justify-between bg-secondary p-10 text-white lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="h-10 w-1 bg-primary" />
            <div>
              <p className="font-condensed text-xl font-bold">DIGIT Complaint Management</p>
              <p className="text-xs uppercase tracking-widest text-white/70">
                Digital infrastructure for public services
              </p>
            </div>
          </div>
        </div>
        <div>
          <h1 className="font-condensed text-4xl font-bold leading-tight">
            Manage complaints from intake to closure.
          </h1>
          <p className="mt-4 max-w-md text-sm text-white/80">
            Set up your account to receive complaints, assign them to the right team, track service
            timelines, and monitor resolution across departments and localities.
          </p>
        </div>
        <p className="text-xs text-white/50">© 2026 eGovernments Foundation · DIGIT</p>
      </aside>

      <main className="flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-6">
          <Stepper steps={STEPS} current={step} />

          {!live && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Preview mode</AlertTitle>
              <AlertDescription>
                The onboarding backend is not wired yet, so this flow runs against mock data and
                creates nothing.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {submitted ? (
            <section className="space-y-4">
              <h2 className="font-condensed text-2xl font-bold">Account requested</h2>
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>Setting up your workspace</AlertTitle>
                <AlertDescription>
                  Setup usually takes 10 to 15 minutes. We will email {email} as soon as it is done.
                </AlertDescription>
              </Alert>
              <Link to="/login" className="inline-block text-sm text-primary underline underline-offset-4">
                Go to sign in
              </Link>
            </section>
          ) : step === 'account' ? (
            <section className="space-y-4">
              {phase === 'details' && (
                <>
                  <div>
                    <h2 className="font-condensed text-2xl font-bold">Verify your email to begin</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Confirm who you are first. Once your email is verified, you can name your
                      account and continue the setup.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      First name
                      <Input className="mt-1" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </label>
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Last name
                      <Input className="mt-1" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </label>
                  </div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Email address
                    <Input className="mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      aria-label="Agree to the Terms of Service and Privacy Notice"
                    />
                    <span className="text-muted-foreground">
                      By continuing, you agree to the Terms of Service and Privacy Notice.
                    </span>
                  </label>
                  {/* No password field: identity is a magic link (#1999). */}
                  <Button className="w-full" disabled={!detailsReady || busy} onClick={() => void sendLink()}>
                    {busy ? <Loader2 className="animate-spin" /> : <Mail />} Continue with email
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <Link to="/login" className="text-primary underline underline-offset-4">Sign in</Link>
                  </p>
                </>
              )}

              {phase === 'linkSent' && (
                <>
                  <div>
                    <h2 className="font-condensed text-2xl font-bold">Check your email</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      We sent a sign-in link to <strong>{email}</strong>. Open the link to verify your
                      address and continue.
                    </p>
                  </div>
                  <Button className="w-full" disabled={busy} onClick={() => void confirmVerified()}>
                    {busy ? <Loader2 className="animate-spin" /> : null}
                    {live ? 'I have opened the link' : 'Simulate email verification'}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => { setPhase('details'); setError(null); }}>
                    Use a different email
                  </Button>
                </>
              )}

              {phase === 'verified' && (
                <>
                  <div>
                    <h2 className="font-condensed text-2xl font-bold">Set up your account</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Create the account details that will identify your account in DIGIT Complaint
                      Management.
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    <span>{email}</span>
                    <span className="flex items-center gap-1 text-green-700">
                      <Check className="h-4 w-4" /> Verified
                    </span>
                  </div>
                  <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Account name
                    <Input
                      className="mt-1"
                      value={accountName}
                      placeholder="Bomet County Government"
                      onChange={(e) => setAccountName(e.target.value)}
                    />
                  </label>
                  <p className="-mt-2 text-xs text-muted-foreground">
                    The name of your account. It could be a government organisation, agency,
                    department, institution, or programme.
                  </p>
                  <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Account code
                    <Input
                      className="mt-1"
                      value={accountCode}
                      onChange={(e) => { setCodeTouched(true); setAccountCode(e.target.value.toUpperCase()); }}
                    />
                  </label>
                  <div className="-mt-2">
                    <p className="text-xs text-muted-foreground">
                      Used as a short identifier for your account across configuration, URLs, and
                      system references.
                    </p>
                    <AvailabilityNote state={codeState} checking={codeChecking} />
                  </div>
                  <Button className="w-full" disabled={!accountReady} onClick={() => setStep('preferences')}>
                    Continue
                  </Button>
                </>
              )}
            </section>
          ) : step === 'preferences' ? (
            <section className="space-y-4">
              <div>
                <h2 className="font-condensed text-2xl font-bold">Personalise your account</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Set the defaults your account will use across the product.
                </p>
              </div>

              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Base country of operations
                <select
                  className={`mt-1 ${selectClass}`}
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  aria-label="Base country of operations"
                >
                  <option value="">Select a country</option>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>
              <p className="-mt-2 text-xs text-muted-foreground">
                Used to suggest locale, timezone, and account code defaults.
              </p>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Languages</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {LANGUAGES.map((language) => {
                    const on = languages.includes(language);
                    return (
                      <button
                        key={language}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleLanguage(language)}
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                          on ? 'border-primary bg-primary/10 text-primary' : 'border-input text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        {language}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Timezone
                <select
                  className={`mt-1 ${selectClass}`}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  aria-label="Timezone"
                >
                  <option value="">Select a timezone</option>
                  {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </label>

              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Financial year
                <select
                  className={`mt-1 ${selectClass}`}
                  value={financialYear}
                  onChange={(e) => setFinancialYear(e.target.value)}
                  aria-label="Financial year"
                >
                  {FINANCIAL_YEARS.map((fy) => <option key={fy.code} value={fy.code}>{fy.label}</option>)}
                </select>
              </label>

              <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Account URL
                <Input
                  className="mt-1"
                  value={accountUrl}
                  onChange={(e) => { setUrlTouched(true); setAccountUrl(slugifyAccountName(e.target.value)); }}
                />
              </label>
              <div className="-mt-2">
                <p className="text-xs text-muted-foreground">
                  This short name will be used in your account URLs.
                </p>
                {accountUrl && (
                  <p className="text-xs text-muted-foreground">
                    Preview: <strong>https://{accountUrl}.cms.digit.org</strong>
                  </p>
                )}
                <AvailabilityNote state={urlState} checking={urlChecking} />
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep('account')}>Back</Button>
                <Button className="flex-1" disabled={!preferencesReady} onClick={() => setStep('review')}>
                  Continue
                </Button>
              </div>
            </section>
          ) : (
            <section className="space-y-4">
              <div>
                <h2 className="font-condensed text-2xl font-bold">Review and create your account</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  These will be the main entry points for your account once your workspace has been
                  set up.
                </p>
              </div>

              <dl className="divide-y rounded-md border">
                {[
                  ['Account name', accountName],
                  ['Account code', accountCode],
                  ['Base country', COUNTRIES.find((c) => c.code === country)?.name ?? country],
                  ['Languages', languages.join(', ')],
                  ['Timezone', timezone],
                  ['Financial year', FINANCIAL_YEARS.find((f) => f.code === financialYear)?.label ?? financialYear],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 px-3 py-2 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">Primary URL</p>
                <p className="text-xs text-muted-foreground">
                  Main entry point for administrators, supervisors, resolvers, and other government
                  employees.
                </p>
                <code className="mt-2 block break-all rounded bg-muted px-2 py-1 text-xs">
                  https://{accountUrl}.cms.digit.org
                </code>
                <p className="mt-1 text-xs text-muted-foreground">
                  This URL is representative. Working URLs will be available post provisioning.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setStep('preferences')}>Back</Button>
                <Button className="flex-1" disabled={busy} onClick={() => void createAccount()}>
                  {busy ? <Loader2 className="animate-spin" /> : null} Create account
                </Button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

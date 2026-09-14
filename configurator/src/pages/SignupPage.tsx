import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, LogIn, RefreshCw } from 'lucide-react';
import {
  type AvailabilityResult,
  type Operation,
  type Signup,
  type SignupDraftInput,
  type TenantOption,
  OnboardingError,
  PROVISIONING_STEPS,
  authMethods,
  checkIdentifier,
  createSignup,
  deriveAccountCode,
  findOperation,
  findSignup,
  isOperationSettled,
  isValidAccountCode,
  isValidUrlSlug,
  newIdempotencyKey,
  retryOperation,
  selectContext,
  session,
  slugifyAccountName,
  startSignIn,
  submitSignup,
  tenants,
  updateSignup,
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

/** Base countries, with the IANA zone each one suggests. */
const COUNTRIES: { code: string; name: string; timeZone: string }[] = [
  { code: 'KE', name: 'Kenya', timeZone: 'Africa/Nairobi' },
  { code: 'IN', name: 'India', timeZone: 'Asia/Kolkata' },
  { code: 'ET', name: 'Ethiopia', timeZone: 'Africa/Addis_Ababa' },
  { code: 'NG', name: 'Nigeria', timeZone: 'Africa/Lagos' },
  { code: 'SN', name: 'Senegal', timeZone: 'Africa/Dakar' },
  { code: 'MZ', name: 'Mozambique', timeZone: 'Africa/Maputo' },
  { code: 'ZA', name: 'South Africa', timeZone: 'Africa/Johannesburg' },
  { code: 'ID', name: 'Indonesia', timeZone: 'Asia/Jakarta' },
];

const TIME_ZONES = [...new Set(COUNTRIES.map((c) => c.timeZone))].sort();

/** The contract wants lowercase BCP-47-like codes, not display names. */
const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'sw', label: 'Swahili' },
  { code: 'hi', label: 'Hindi' },
];

/**
 * The contract only requires a non-blank string and gives `JULY_JUNE` as its
 * one example, so this list is our best guess at the vocabulary rather than a
 * published enum. Confirm with the backend before this ships. (#1999)
 */
const FINANCIAL_YEARS = [
  { code: 'JANUARY_DECEMBER', label: 'January to December' },
  { code: 'APRIL_MARCH', label: 'April to March' },
  { code: 'JULY_JUNE', label: 'July to June' },
  { code: 'OCTOBER_SEPTEMBER', label: 'October to September' },
];

const TERMS_VERSION = '2026-09';

const selectClass =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

/** Poll cadence the contract asks for: every 2-5 seconds. */
const POLL_MS = 3000;

type Phase =
  | 'loading'
  | 'signedOut'
  | 'chooseTenant'
  | 'wizard'
  | 'provisioning'
  | 'entering'
  | 'failed';

function errorText(error: unknown): string {
  if (error instanceof OnboardingError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

const isExpiredSession = (error: unknown) =>
  error instanceof OnboardingError && error.isUnauthenticated;

/** Availability line under the code and URL fields. */
function AvailabilityNote({
  state,
  checking,
  invalidReason,
}: {
  state: AvailabilityResult | null;
  checking: boolean;
  invalidReason?: string;
}) {
  if (invalidReason) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
        <AlertCircle className="h-3 w-3" /> {invalidReason}
      </p>
    );
  }
  if (checking) {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking availability…
      </p>
    );
  }
  if (!state) return null;
  return state.available ? (
    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
      <Check className="h-3 w-3" /> Available
    </p>
  ) : (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <AlertCircle className="h-3 w-3" /> Already taken
    </p>
  );
}

export default function SignupPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<{ id: string; label: string }[]>([]);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [signup, setSignup] = useState<Signup | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [step, setStep] = useState<string>('account');
  const [saving, setSaving] = useState(false);

  // Form state, seeded from the server draft so a resumed signup shows what was
  // already entered rather than an empty wizard.
  const [accountName, setAccountName] = useState('');
  const [accountCode, setAccountCode] = useState('');
  const [urlSlug, setUrlSlug] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [languages, setLanguages] = useState<string[]>(['en']);
  const [timeZone, setTimeZone] = useState('');
  const [financialYearPolicy, setFinancialYearPolicy] = useState('');
  const [founderMobile, setFounderMobile] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [codeState, setCodeState] = useState<AvailabilityResult | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);
  const [slugState, setSlugState] = useState<AvailabilityResult | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);

  // Fields the operator has edited by hand stop being derived from the name.
  const codeTouched = useRef(false);
  const slugTouched = useRef(false);
  // Reused when retrying the *same* action after a network failure, which is
  // the whole point of the header.
  const createKey = useRef<string>(newIdempotencyKey());
  const submitKey = useRef<string>(newIdempotencyKey());

  const seedFrom = useCallback((record: Signup) => {
    setSignup(record);
    setAccountName(record.accountName || '');
    setAccountCode(record.accountCode || '');
    setUrlSlug(record.urlSlug || '');
    setCountryCode(record.countryCode || '');
    setLanguages(record.languages?.length ? record.languages : ['en']);
    setTimeZone(record.timeZone || '');
    setFinancialYearPolicy(record.financialYearPolicy || '');
    setFounderMobile(String(record.tenantMetadata?.founder?.mobileNumber || ''));
    setAcceptedTerms(Boolean(record.acceptedTermsVersion));
    if (record.accountCode) codeTouched.current = true;
    if (record.urlSlug) slugTouched.current = true;
  }, []);

  /** Session → tenants → onboarding or chooser. The contract's own order. */
  const bootstrap = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const current = await session();
      if (!current.authenticated) {
        const { methods: available } = await authMethods();
        setMethods(available);
        setPhase('signedOut');
        return;
      }
      const view = await tenants();
      if (!view.onboardingRequired && view.tenants.length) {
        setTenantOptions(view.tenants);
        setPhase('chooseTenant');
        return;
      }
      // One signup per founder: search first so a closed tab resumes rather
      // than starting a second.
      const existing = await findSignup();
      if (existing) seedFrom(existing);
      setPhase('wizard');
    } catch (caught) {
      setError(errorText(caught));
      setPhase('failed');
    }
  }, [seedFrom]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Derivations, only while the operator has not taken the field over.
  useEffect(() => {
    if (!codeTouched.current) setAccountCode(deriveAccountCode(accountName, countryCode));
  }, [accountName, countryCode]);
  useEffect(() => {
    if (!slugTouched.current) setUrlSlug(slugifyAccountName(accountName));
  }, [accountName]);

  /**
   * Debounced, with a trailing-call guard: a slow early response must not
   * overwrite the verdict for what is in the field now.
   */
  const useAvailability = (
    type: 'ACCOUNT_CODE' | 'URL_SLUG',
    value: string,
    valid: boolean,
    setState: (v: AvailabilityResult | null) => void,
    setChecking: (v: boolean) => void
  ) => {
    useEffect(() => {
      if (!valid) {
        setState(null);
        setChecking(false);
        return;
      }
      let current = true;
      setChecking(true);
      const timer = setTimeout(async () => {
        try {
          const result = await checkIdentifier(type, value, signup?.id);
          if (current) setState(result);
        } catch {
          if (current) setState(null);
        } finally {
          if (current) setChecking(false);
        }
      }, 400);
      return () => {
        current = false;
        clearTimeout(timer);
      };
    }, [type, value, valid, setState, setChecking]);
  };

  const codeValid = isValidAccountCode(accountCode);
  const slugValid = isValidUrlSlug(urlSlug);
  useAvailability('ACCOUNT_CODE', accountCode, codeValid, setCodeState, setCodeChecking);
  useAvailability('URL_SLUG', urlSlug, slugValid, setSlugState, setSlugChecking);

  /**
   * Only what has actually been filled in. The validator rejects a blank value
   * but accepts an absent field, so sending `financialYearPolicy: ""` from the
   * first step fails the create while omitting it succeeds — the fields the
   * contract marks "on submit" are optional by absence, not by emptiness.
   */
  const draft = useMemo<SignupDraftInput>(() => {
    const next: SignupDraftInput = {
      accountName: accountName.trim(),
      accountCode,
      urlSlug,
      countryCode,
    };
    if (languages.length) next.languages = languages;
    if (timeZone) next.timeZone = timeZone;
    if (financialYearPolicy) next.financialYearPolicy = financialYearPolicy;
    if (acceptedTerms) next.acceptedTermsVersion = TERMS_VERSION;
    if (founderMobile.trim()) {
      next.tenantMetadata = { schemaVersion: 1, founder: { mobileNumber: founderMobile.trim() } };
    }
    return next;
  }, [accountName, accountCode, urlSlug, countryCode, languages, timeZone, financialYearPolicy, acceptedTerms, founderMobile]);

  /** Create on first save, update thereafter — one signup per founder. */
  const persist = useCallback(async (): Promise<Signup> => {
    if (signup) {
      const updated = await updateSignup(signup.id, draft);
      setSignup(updated);
      return updated;
    }
    const created = await createSignup(draft, createKey.current);
    setSignup(created);
    return created;
  }, [draft, signup]);

  /**
   * The session is a cookie with its own lifetime, so it can lapse mid-wizard.
   * The contract's answer to a 401 is to restart sign-in, and leaving the
   * operator on Review with a button that can only keep failing is not that.
   * The server-side draft is what makes this cheap: signing back in resumes
   * exactly where they were.
   */
  const handleFailure = useCallback(async (caught: unknown) => {
    if (!isExpiredSession(caught)) {
      setError(errorText(caught));
      return;
    }
    try {
      const { methods: available } = await authMethods();
      setMethods(available);
    } catch {
      /* The gate still renders; it just may list nothing. */
    }
    setError('Your sign-in expired. Sign in again to pick up where you left off.');
    setPhase('signedOut');
  }, []);

  const advance = async (next: string) => {
    setSaving(true);
    setError(null);
    try {
      await persist();
      setStep(next);
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const record = await persist();
      const started = await submitSignup(record.id, submitKey.current);
      setOperation(started);
      setPhase('provisioning');
    } catch (caught) {
      await handleFailure(caught);
    } finally {
      setSaving(false);
    }
  };

  // Poll while the worker runs. Stops as soon as the operation settles, so a
  // terminal failure does not sit here hammering the endpoint.
  useEffect(() => {
    if (phase !== 'provisioning' || !operation || isOperationSettled(operation.status)) return;
    const timer = setTimeout(async () => {
      try {
        const latest = await findOperation(operation.id);
        if (latest) setOperation(latest);
      } catch (caught) {
        await handleFailure(caught);
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [phase, operation]);

  // Provisioning done: the new tenant appears without another sign-in.
  useEffect(() => {
    if (phase !== 'provisioning' || operation?.status !== 'SUCCEEDED') return;
    let live = true;
    (async () => {
      try {
        const view = await tenants();
        if (!live) return;
        setTenantOptions(view.tenants);
        setPhase('chooseTenant');
      } catch (caught) {
        if (live) setError(errorText(caught));
      }
    })();
    return () => {
      live = false;
    };
  }, [phase, operation?.status]);

  const enter = async (tenantId: string) => {
    setSaving(true);
    setError(null);
    try {
      const context = await selectContext(tenantId);
      // The existing DIGIT auth state takes it from here; normal business calls
      // resume with RequestInfo.authToken = access_token.
      window.localStorage.setItem('Employee.token', context.access_token);
      window.localStorage.setItem('Employee.tenant-id', context.UserRequest.tenantId);
      window.localStorage.setItem('Employee.user-info', JSON.stringify(context.UserRequest));
      setPhase('entering');
      window.location.assign('/configurator/');
    } catch (caught) {
      setError(errorText(caught));
      setSaving(false);
    }
  };

  const accountReady =
    accountName.trim().length > 0 &&
    // Required by the server at create time, not only at submit.
    countryCode.length === 2 &&
    codeValid &&
    slugValid &&
    codeState?.available !== false &&
    slugState?.available !== false;
  const preferencesReady =
    languages.length > 0 && timeZone.length > 0 && financialYearPolicy.length > 0 && founderMobile.trim().length > 0;

  const banner = error ? (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Could not continue</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  if (phase === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (phase === 'signedOut') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-2xl font-semibold">Set up your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to begin. We will create your workspace once the details are confirmed.
        </p>
        {banner}
        <div className="mt-6 space-y-2">
          {/* Only what the backend actually has enabled. Google, GitHub and the
              magic link appear here once their Keycloak providers are switched
              on, and they use this same redirect, so nothing changes here. */}
          {methods.map((method) => (
            <Button key={method.id} className="w-full" onClick={() => startSignIn(method.id)}>
              <LogIn className="mr-2 h-4 w-4" /> Continue with {method.label}
            </Button>
          ))}
          {!methods.length && (
            <p className="text-sm text-muted-foreground">No sign-in method is enabled on this environment.</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'chooseTenant') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-2xl font-semibold">Choose a workspace</h1>
        {banner}
        <div className="mt-6 space-y-2">
          {tenantOptions.map((option) => (
            <Button
              key={option.tenantId}
              variant="outline"
              className="w-full justify-between"
              disabled={saving}
              onClick={() => enter(option.tenantId)}
            >
              <span>{option.name}</span>
              <span className="text-xs text-muted-foreground">{option.tenantId}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'entering') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening your workspace…
      </div>
    );
  }

  if (phase === 'provisioning' && operation) {
    const done = new Set(operation.completedSteps);
    const failed = operation.status === 'RETRYABLE_FAILED' || operation.status === 'TERMINAL_FAILED';
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-semibold">Setting up {accountName}</h1>
        <p className="mt-2 text-sm text-muted-foreground">This usually takes a minute or two.</p>
        {banner}
        <ol className="mt-6 space-y-3">
          {PROVISIONING_STEPS.map((name) => {
            const isDone = done.has(name);
            const isCurrent = operation.currentStep === name && !isDone;
            return (
              <li key={name} className="flex items-center gap-3 text-sm">
                {isDone ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : isCurrent && !failed ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-muted-foreground/40" />
                )}
                <span className={isDone ? 'text-foreground' : 'text-muted-foreground'}>
                  {name.replace(/_/g, ' ').toLowerCase()}
                </span>
              </li>
            );
          })}
        </ol>
        {failed && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Setup did not finish</AlertTitle>
            <AlertDescription>
              {operation.errorMessage || 'The setup could not be completed.'}
              {operation.errorCode ? ` (${operation.errorCode})` : ''}
            </AlertDescription>
          </Alert>
        )}
        {operation.status === 'RETRYABLE_FAILED' && (
          <Button
            className="mt-4"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                setOperation(await retryOperation(operation.id));
              } catch (caught) {
                setError(errorText(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" /> Try again
          </Button>
        )}
        {operation.status === 'TERMINAL_FAILED' && (
          <p className="mt-4 text-sm text-muted-foreground">
            This signup cannot be retried. Please contact support to continue.
          </p>
        )}
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        {banner}
        <Button onClick={() => void bootstrap()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Set up your account</h1>
      <div className="mt-6">
        <Stepper steps={STEPS} current={step} />
      </div>
      <div className="mt-8">{banner}</div>

      {step === 'account' ? (
        <div className="space-y-5">
          <div>
            <label className="text-sm font-medium" htmlFor="accountName">
              Account name
            </label>
            <Input
              id="accountName"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Bomet County Government"
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="countryCode">
              Base country
            </label>
            <select
              id="countryCode"
              className={selectClass}
              value={countryCode}
              onChange={(e) => {
                const next = e.target.value;
                setCountryCode(next);
                // Suggest, never overwrite a zone already chosen by hand.
                const suggested = COUNTRIES.find((c) => c.code === next)?.timeZone;
                if (suggested && !timeZone) setTimeZone(suggested);
              }}
            >
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="accountCode">
              Account code
            </label>
            <Input
              id="accountCode"
              value={accountCode}
              onChange={(e) => {
                codeTouched.current = true;
                setAccountCode(e.target.value.toUpperCase());
              }}
            />
            <AvailabilityNote
              state={codeState}
              checking={codeChecking}
              invalidReason={
                accountCode && !codeValid ? '2 to 32 characters, using A-Z, 0-9 and hyphens.' : undefined
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="urlSlug">
              Account URL
            </label>
            <Input
              id="urlSlug"
              value={urlSlug}
              onChange={(e) => {
                slugTouched.current = true;
                setUrlSlug(e.target.value.toLowerCase());
              }}
            />
            <AvailabilityNote
              state={slugState}
              checking={slugChecking}
              invalidReason={
                urlSlug && !slugValid
                  ? '2 to 63 characters, lowercase letters, digits and hyphens, with at least two letters.'
                  : undefined
              }
            />
          </div>
          <div className="flex justify-end">
            <Button disabled={!accountReady || saving} onClick={() => advance('preferences')}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Continue
            </Button>
          </div>
        </div>
      ) : step === 'preferences' ? (
        <div className="space-y-5">
          <div>
            <span className="text-sm font-medium">Languages</span>
            <div className="mt-2 flex flex-wrap gap-3">
              {LANGUAGES.map((language) => (
                <label key={language.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={languages.includes(language.code)}
                    onChange={(e) =>
                      setLanguages((prev) =>
                        e.target.checked
                          ? [...prev, language.code]
                          : prev.filter((code) => code !== language.code)
                      )
                    }
                  />
                  {language.label}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="timeZone">
              Time zone
            </label>
            <select
              id="timeZone"
              className={selectClass}
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
            >
              <option value="">Select a time zone</option>
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="financialYearPolicy">
              Financial year
            </label>
            <select
              id="financialYearPolicy"
              className={selectClass}
              value={financialYearPolicy}
              onChange={(e) => setFinancialYearPolicy(e.target.value)}
            >
              <option value="">Select a financial year</option>
              {FINANCIAL_YEARS.map((fy) => (
                <option key={fy.code} value={fy.code}>
                  {fy.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="founderMobile">
              Your mobile number
            </label>
            <Input
              id="founderMobile"
              value={founderMobile}
              onChange={(e) => setFounderMobile(e.target.value)}
              placeholder="+254700000199"
            />
            {/* Not optional metadata: the provisioning worker needs it to create
                the tenant-local employee, and without it setup ends in
                FOUNDER_ACCOUNT_REJECTED rather than a validation message. */}
            <p className="mt-1 text-xs text-muted-foreground">
              Used to create your account inside the new workspace.
            </p>
          </div>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('account')}>
              Back
            </Button>
            <Button disabled={!preferencesReady || saving} onClick={() => advance('review')}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Continue
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <dl className="divide-y rounded-md border">
            {[
              ['Account name', accountName],
              ['Account code', accountCode],
              ['Account URL', urlSlug],
              ['Base country', COUNTRIES.find((c) => c.code === countryCode)?.name || countryCode],
              ['Languages', languages.join(', ')],
              ['Time zone', timeZone],
              ['Financial year', FINANCIAL_YEARS.find((f) => f.code === financialYearPolicy)?.label || financialYearPolicy],
              ['Mobile number', founderMobile],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 px-4 py-3 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
            />
            <span>I agree to the terms of service.</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Setup runs in the background and takes a minute or two. You will see its progress on the next
            screen.
          </p>
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('preferences')}>
              Back
            </Button>
            <Button disabled={!acceptedTerms || saving} onClick={submit}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create account
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

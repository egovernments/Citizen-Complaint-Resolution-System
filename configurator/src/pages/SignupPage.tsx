import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Check, Loader2, Mail, RefreshCw } from 'lucide-react';
import {
  type AvailabilityResult,
  type Operation,
  type ProvisioningStep,
  type Signup,
  type TenantReadiness,
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
  logout,
  newIdempotencyKey,
  retryOperation,
  selectContext,
  tenantReadiness,
  session,
  slugifyAccountName,
  startSignIn,
  submitSignup,
  tenants,
  updateSignup,
} from '@/api/onboarding';
import { clearLocalSession, installDigitContext } from '@/lib/session';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Stepper } from '@/components/ui/stepper';
import { AuthShell } from '@/components/signup/AuthPanel';

const STEPS = [
  { id: 'account', label: 'Account' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'review', label: 'Review' },
];

/** Base countries, with the IANA zone each one suggests. */
/**
 * `dialCode` is shown beside the mobile field so it is obvious the field takes
 * the national number and the prefix is added for you. That distinction is not
 * cosmetic: the value is submitted as `tenantMetadata.tenantAdmin.mobileNumber`
 * and egov-user validates it as a national number, so a founder who copied the
 * old `+254700000199` placeholder was being shown a shape the backend rejects.
 *
 * `nationalExample` is deliberately absent for most countries. The only
 * authoritative mobile formats in this repo are the three
 * `common-masters.MobileNumberValidation` records it ships (`+254`, `+91`,
 * `+251`), and an invented example is the same class of defect as the hardcoded
 * Kenyan one: a confident hint that happens to be wrong. Countries without one
 * get the dial code and a neutral hint instead.
 *
 * The durable home for this is that MDMS schema, which onboarding cannot read
 * because the tenant does not exist yet. Sharing it with tenant provisioning is
 * CCRS#2073 / CCRS#2076 territory.
 *
 * A caveat that matters, so the three examples are not read as safe:
 * `tenant-foundation` seeds no `common-masters.MobileNumberValidation` row for
 * a new tenant, so egov-user's per-tenant lookup misses and it falls back to
 * the HOST's default regex. The founder's country selection has no bearing on
 * what actually validates their number. On a Kenyan deployment a founder who
 * picks India is shown a correct Indian example and rejected by a Kenyan rule,
 * and per CCRS#2073 that rejection is terminal.
 *
 * So these examples only hold where the selected country matches the
 * deployment's own. Refusing to invent the other five avoided one version of
 * this defect; this note records the version that is left, which is a correct
 * example resting on a wrong premise about which rule applies. The seeding gap
 * is tracked on CCRS#2073.
 */
const COUNTRIES: {
  code: string;
  name: string;
  timeZone: string;
  dialCode: string;
  nationalExample?: string;
}[] = [
  { code: 'KE', name: 'Kenya', timeZone: 'Africa/Nairobi', dialCode: '+254', nationalExample: '712345678' },
  { code: 'IN', name: 'India', timeZone: 'Asia/Kolkata', dialCode: '+91', nationalExample: '9876543210' },
  { code: 'ET', name: 'Ethiopia', timeZone: 'Africa/Addis_Ababa', dialCode: '+251', nationalExample: '911234567' },
  { code: 'NG', name: 'Nigeria', timeZone: 'Africa/Lagos', dialCode: '+234' },
  { code: 'SN', name: 'Senegal', timeZone: 'Africa/Dakar', dialCode: '+221' },
  { code: 'MZ', name: 'Mozambique', timeZone: 'Africa/Maputo', dialCode: '+258' },
  { code: 'ZA', name: 'South Africa', timeZone: 'Africa/Johannesburg', dialCode: '+27' },
  { code: 'ID', name: 'Indonesia', timeZone: 'Asia/Jakarta', dialCode: '+62' },
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
/**
 * Short codes, as asked on #1999. The backend accepts any string for this
 * field today and does not yet project it into runtime configuration, so the
 * value is carried on the draft and nothing reads it back.
 */
const FINANCIAL_YEARS = [
  { code: 'JAN_DEC', label: 'January to December' },
  { code: 'APR_MAR', label: 'April to March' },
  { code: 'JUL_JUN', label: 'July to June' },
  { code: 'OCT_SEP', label: 'October to September' },
];

const TERMS_VERSION = '2026-09';

/**
 * 44px tall, to the reference's `authInputStyle`. The shadcn default is 36px,
 * which reads cramped beside a 28px step heading and sits under the comfortable
 * touch target on the phone layout.
 */
const CONTROL_HEIGHT = 'h-11';

const selectClass =
  `flex ${CONTROL_HEIGHT} w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm ` +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

/** Poll cadence the contract asks for: every 2-5 seconds. */
const POLL_MS = 3000;

/**
 * Founder-facing names for the backend's step codes. Lower-casing the codes
 * themselves read as internal machinery on the one screen where somebody is
 * watching every line, and turned the product name into "digit account".
 */
const STEP_LABELS: Record<ProvisioningStep, string> = {
  TENANT_FOUNDATION: 'Creating your account',
  ORGANIZATION: 'Setting up your organisation',
  TENANT_ADMIN_MEMBERSHIP: 'Adding you to your organisation',
  TENANT_ADMIN_ROLES: 'Granting your permissions',
  DIGIT_ACCOUNT: 'Creating your DIGIT login',
};

type Phase =
  | 'loading'
  | 'signedOut'
  | 'chooseTenant'
  | 'wizard'
  | 'provisioning'
  | 'entering'
  | 'resuming'
  | 'setupRequired'
  | 'stuck'
  | 'failed';

function errorText(error: unknown): string {
  if (error instanceof OnboardingError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

const isExpiredSession = (error: unknown) =>
  error instanceof OnboardingError && error.isUnauthenticated;


/** Uppercase caption plus helper text, the field chrome the reference uses. */
function Field({
  id,
  label,
  help,
  children,
  status,
}: {
  id: string;
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
  status?: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
      {status}
    </div>
  );
}

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
      <Check className="h-3 w-3" /> Available.
    </p>
  ) : (
    <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
      <AlertCircle className="h-3 w-3" /> Already taken.
    </p>
  );
}

/**
 * The branded shell every step sits in. Written once and wrapped around the
 * whole flow rather than repeated per phase, so the sign-in gate, the wizard,
 * the provisioning screen and the workspace picker all read as one product
 * instead of a form floating on an empty page.
 */
function SignupFlow() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [methods, setMethods] = useState<{ id: string; label: string }[]>([]);
  const [sessionUser, setSessionUser] = useState<{ email: string; name: string } | null>(null);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  // The tenant the operator picked and how far it has actually been built. Set
  // only when the pick is refused, so the gate can name what it is holding.
  const [gated, setGated] = useState<{ option: TenantOption; readiness: TenantReadiness } | null>(null);
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
  const [tenantAdminMobile, setTenantAdminMobile] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [codeState, setCodeState] = useState<AvailabilityResult | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);
  const [slugState, setSlugState] = useState<AvailabilityResult | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);

  // Fields the operator has edited by hand stop being derived from the name.
  const codeTouched = useRef(false);
  const slugTouched = useRef(false);
  const timeZoneTouched = useRef(false);
  /** Drives the dial-code prefix and the mobile hint on the Preferences step. */
  const selectedCountry = COUNTRIES.find((c) => c.code === countryCode);
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
    setTenantAdminMobile(String(record.tenantMetadata?.tenantAdmin?.mobileNumber || ''));
    setAcceptedTerms(Boolean(record.acceptedTermsVersion));
    if (record.accountCode) codeTouched.current = true;
    if (record.urlSlug) slugTouched.current = true;
    // A resumed draft's zone was already settled once; changing country
    // on the way back through should not quietly rewrite it.
    if (record.timeZone) timeZoneTouched.current = true;
  }, []);

  /** Session → tenants → onboarding or chooser. The contract's own order. */
  // No synchronous setState in here: it runs from an effect on mount, where
  // `loading` is already the initial phase. The two re-entry points below want
  // the spinner back, so they ask for it through `restart`.
  const bootstrap = useCallback(async () => {
    try {
      const current = await session();
      if (current.user) setSessionUser({ email: current.user.email, name: current.user.name });
      if (!current.authenticated) {
        const { methods: available } = await authMethods('signup');
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
      // Branch on status, because only a DRAFT may be edited. Dropping every
      // non-DRAFT into the wizard handed back a form whose every save the
      // backend refuses.
      switch (existing?.status) {
        // The dead end: the founder cannot edit it and cannot start another,
        // because `_create` hands back the same failed record.
        case 'FAILED':
          setPhase('stuck');
          return;
        // Submitted and already running. `_submit` is idempotent and returns
        // the existing operation for the signup before it applies the
        // DRAFT-state guard, so it is how the operation is recovered after a
        // reload rather than something that starts a second run. That matters
        // for more than step detail: PGR leaves the signup PROVISIONING when an
        // operation goes RETRYABLE_FAILED, and only a terminal failure moves it
        // to FAILED. Polling the signup alone would therefore sit on a retryable
        // failure forever and never offer the retry that already exists.
        case 'SUBMITTED':
        case 'PROVISIONING':
          try {
            setOperation(await submitSignup(existing.id, submitKey.current));
            setPhase('provisioning');
          } catch {
            // Could not reacquire it. Fall back to watching the signup, which
            // still resolves on ACTIVE or FAILED.
            setPhase('resuming');
          }
          return;
        // Provisioned. Normally unreachable, because the tenant branch above
        // catches it, but if tenant discovery briefly returns no option the
        // wizard must not come back: nothing here is saveable any more.
        case 'ACTIVE':
          setPhase('resuming');
          return;
        default:
          setPhase('wizard');
      }
    } catch (caught) {
      setError(errorText(caught));
      setPhase('failed');
    }
  }, [seedFrom]);

  useEffect(() => {
    // Load on mount. Every setState inside `bootstrap` happens after an await,
    // so there is no cascading render to avoid here; the rule cannot see past
    // the call and flags any effect that reaches a setter at all.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void bootstrap();
  }, [bootstrap]);

  /** Back to the top with the spinner showing, for retry and for resume. */
  const restart = useCallback(() => {
    setPhase('loading');
    setError(null);
    return bootstrap();
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
    if (tenantAdminMobile.trim()) {
      next.tenantMetadata = { schemaVersion: 1, tenantAdmin: { mobileNumber: tenantAdminMobile.trim() } };
    }
    return next;
  }, [accountName, accountCode, urlSlug, countryCode, languages, timeZone, financialYearPolicy, acceptedTerms, tenantAdminMobile]);

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
      const { methods: available } = await authMethods('signup');
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
  }, [phase, operation, handleFailure]);

  // Resumed into a run that was already going. Only the signup is addressable
  // here, so this polls that rather than the operation, and resolves the same
  // way the live run does.
  useEffect(() => {
    if (phase !== 'resuming') return;
    let live = true;
    const timer = window.setInterval(async () => {
      try {
        const latest = await findSignup();
        if (!live || !latest) return;
        if (latest.status === 'FAILED') {
          seedFrom(latest);
          setPhase('stuck');
        } else if (latest.status === 'ACTIVE') {
          await restart();
        }
      } catch {
        // A blip mid-poll is not a failure; the next tick re-reads.
      }
    }, POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [phase, seedFrom, restart]);

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

  const enter = async (option: TenantOption) => {
    setSaving(true);
    setError(null);
    try {
      // Readiness is checked BEFORE anything is minted or mounted. A tenant
      // with no platform configuration can still hand out a correctly scoped
      // DIGIT token, so getting one proves nothing and entering on the strength
      // of it drops the operator into a console where every call is refused.
      // Only gate on a readiness the backend actually stated. An unknown value
      // must not hold a configured tenant out of its own workspace.
      const readiness = tenantReadiness(option);
      if (readiness && readiness !== 'READY') {
        setGated({ option, readiness });
        setPhase('setupRequired');
        setSaving(false);
        return;
      }
      const context = await selectContext(option.tenantId);
      // Hand the DIGIT token to the session the app actually restores from.
      // App.tsx reads one blob under `crs-auth-state`; writing digit-ui's
      // `Employee.*` keys instead left the operator looking at whichever
      // session was already there.
      installDigitContext(context, sessionUser);
      setPhase('entering');
      window.location.assign('/configurator/');
    } catch (caught) {
      setError(errorText(caught));
      setSaving(false);
    }
  };

  const accountReady =
    accountName.trim().length > 0 && codeValid && codeState?.available !== false;
  // The draft is created at the end of this step rather than the last one,
  // because the server needs countryCode and urlSlug to create at all.
  const preferencesReady =
    countryCode.length === 2 &&
    languages.length > 0 &&
    timeZone.length > 0 &&
    financialYearPolicy.length > 0 &&
    slugValid &&
    slugState?.available !== false &&
    tenantAdminMobile.trim().length > 0;

  const banner = error ? (
    <Alert variant="destructive" className="mb-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Could not continue</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (phase === 'signedOut') {
    // Deliberately the same card as the original first step: stepper, heading,
    // small print, the sign-in line. Only the middle changed, because Keycloak
    // collects the email now and there is nothing left for us to ask for.
    const [primary, ...rest] = methods;
    return (
      <>
        <Stepper steps={STEPS} current="account" />
        {banner}
        <section className="space-y-4">
          <div>
            <h2 className="text-[28px] font-semibold leading-[1.15]">Verify your email to begin</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm who you are first. Once your email is verified, you can name your account and
              continue the setup.
            </p>
          </div>

          {primary ? (
            <Button className="h-11 w-full" onClick={() => startSignIn(primary.id, 'signup')}>
              <Mail className="mr-2 h-4 w-4" /> {primary.label}
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              No sign-in method is enabled on this environment.
            </p>
          )}

          {/* Anything beyond the first sits under it as a quiet alternative
              rather than a second wall of buttons.

              One per row. They were laid out inline with no separator, which
              read as a single run-on link the moment a deployment enabled a
              third method: "Continue with GitHubEmail me a sign-in link". It
              was not only ugly, the two targets touched, so aiming for one
              reliably hit the other. */}
          {rest.length > 0 && (
            <>
              {/* The reference separates the primary path from the rest with a
                  rule and an OR, then gives each alternative a full-width
                  outline button. Same shape here, with one difference that is
                  deliberate: which buttons exist is whatever `auth-methods`
                  reports, so a deployment that enables only password sees only
                  password and nothing renders an option it cannot honour. */}
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">OR</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3">
                {rest.map((method) => (
                  <Button
                    key={method.id}
                    variant="outline"
                    className="w-full"
                    onClick={() => startSignIn(method.id, 'signup')}
                  >
                    {method.label}
                  </Button>
                ))}
              </div>
            </>
          )}

          <p className="text-sm text-muted-foreground">
            By continuing, you agree to the Terms of Service and Privacy Notice.
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="text-primary underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </section>
      </>
    );
  }

  if (phase === 'chooseTenant') {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Choose a workspace</h1>
        {banner}
        <div className="mt-6 space-y-2">
          {tenantOptions.map((option) => (
            <Button
              key={option.tenantId}
              variant="outline"
              className="w-full justify-between"
              disabled={saving}
              onClick={() => enter(option)}
            >
              <span>{option.name}</span>
              <span className="text-xs text-muted-foreground">{option.tenantId}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'resuming') {
    // The fallback when the operation could not be reacquired, and the holding
    // state for a provisioned signup whose tenant has not surfaced yet. No step
    // list either way: without the operation there is no progress to read, and
    // drawing one would be decoration.
    const provisioned = signup?.status === 'ACTIVE';
    return (
      <div>
        <h1 className="text-[28px] font-semibold leading-[1.15]">
          {provisioned ? 'Opening your workspace' : `Setting up ${accountName || 'your account'}`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {provisioned
            ? 'Your account is ready. Waiting for it to become available to sign in to.'
            : 'This was already under way when you left. It usually takes a minute or two.'}
        </p>
        {banner}
        <div className="mt-6 flex items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Checking…
        </div>
      </div>
    );
  }

  if (phase === 'setupRequired' && gated) {
    // Deliberately an honest gate, not a loading screen: nothing is running in
    // the background, so a spinner or "still being set up" would be a promise
    // the backend is not keeping (CCRS#2073 G9). Management modules are never
    // mounted from here, so none of the calls that return AccessDeniedException
    // are fired at all.
    // READY never reaches this screen, so it is excluded rather than carried
    // here as an empty entry nobody can read.
    const copy: Record<Exclude<TenantReadiness, 'READY'>, { title: string; body: string }> = {
      IDENTITY_READY: {
        title: 'Tenant created — workspace setup required',
        body: 'Your organisation and administrator account are ready. Workspace configuration has not been installed yet.',
      },
      PROVISIONING: {
        title: 'Workspace setup is running',
        body: 'Your organisation and administrator account are ready. The workspace configuration is still being installed.',
      },
      FAILED: {
        title: 'Workspace setup did not finish',
        body: 'Your organisation and administrator account are ready, but the workspace configuration could not be installed.',
      },
    };
    const { title, body } = copy[gated.readiness as Exclude<TenantReadiness, 'READY'>];
    return (
      <div>
        <h1 className="text-[28px] font-semibold leading-[1.15]">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-6 rounded border px-4 py-3 text-sm">
          <div className="font-medium">{gated.option.name}</div>
          <div className="text-xs text-muted-foreground">{gated.option.tenantId}</div>
        </div>
        {banner}
        <div className="mt-6 flex flex-wrap gap-2">
          {tenantOptions.length > 1 && (
            <Button
              variant="outline"
              onClick={() => {
                setGated(null);
                setPhase('chooseTenant');
              }}
            >
              Choose a different workspace
            </Button>
          )}
          <Button
            variant="outline"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await logout();
              } catch {
                // The local half below is what strands the operator if it is
                // skipped, so a failed remote revoke must not stop it.
              }
              // Both halves, then a full-page navigation so App re-initialises
              // from the emptied storage instead of keeping the session it
              // restored at load.
              clearLocalSession();
              window.location.assign('/configurator/signup');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  if (phase === 'entering') {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening your workspace…
      </div>
    );
  }

  if (phase === 'provisioning' && operation) {
    const done = new Set(operation.completedSteps);
    const failed = operation.status === 'RETRYABLE_FAILED' || operation.status === 'TERMINAL_FAILED';
    return (
      <div>
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
                  {STEP_LABELS[name]}
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

  if (phase === 'stuck') {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Setup could not be completed</h1>
        <Alert variant="destructive" className="mt-6">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>This signup is closed</AlertTitle>
          <AlertDescription>
            Setting up {signup?.accountName || 'your account'} did not finish, and it cannot be
            restarted from here. Please contact support and quote{' '}
            <span className="font-mono">{signup?.id}</span>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div>
        {banner}
        <Button
          onClick={() => void restart()}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      </div>
    );
  }

  const email = sessionUser?.email;

  return (
    <>
      <Stepper steps={STEPS} current={step} />
      {banner}

      {step === 'account' ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-[28px] font-semibold leading-[1.15]">Set up your account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create the account details that will identify your account in DIGIT Complaint
              Management.
            </p>
          </div>

          {email && (
            <div className="flex items-center justify-between rounded-md border bg-card px-3 py-2 text-sm">
              <span>{email}</span>
              <span className="flex items-center gap-1 text-emerald-600">
                <Check className="h-4 w-4" /> Verified
              </span>
            </div>
          )}

          <Field
            id="accountName"
            label="Account name"
            help="The name of your account. It could be a government organisation, agency, department, institution, or programme."
          >
            <Input
              id="accountName"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          </Field>

          <Field
            id="accountCode"
            label="Account code"
            help="Used as a short identifier for your account across configuration, URLs, and system references."
            status={
              <AvailabilityNote
                state={codeState}
                checking={codeChecking}
                invalidReason={
                  accountCode && !codeValid
                    ? '2 to 32 characters, using A-Z, 0-9 and hyphens.'
                    : undefined
                }
              />
            }
          >
            <Input
              id="accountCode"
              value={accountCode}
              onChange={(e) => {
                codeTouched.current = true;
                setAccountCode(e.target.value.toUpperCase());
              }}
            />
          </Field>

          <Button className="w-full" disabled={!accountReady} onClick={() => setStep('preferences')}>
            Continue
          </Button>
        </section>
      ) : step === 'preferences' ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-[28px] font-semibold leading-[1.15]">Personalise your account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set the defaults your account will use across the product.
            </p>
          </div>

          <Field
            id="countryCode"
            label="Base country of operations"
            help="Used to suggest locale, timezone, and account code defaults."
          >
            <select
              id="countryCode"
              className={selectClass}
              value={countryCode}
              onChange={(e) => {
                const next = e.target.value;
                setCountryCode(next);
                // Suggest, never overwrite a zone chosen by hand. "Chosen by
                // hand" has to be tracked, not inferred from the field being
                // non-empty: the first country pick fills it, so that test was
                // true from then on and every later country change silently
                // kept the old zone. Same ref pattern as the code and slug.
                const suggested = COUNTRIES.find((c) => c.code === next)?.timeZone;
                if (suggested && !timeZoneTouched.current) setTimeZone(suggested);
              }}
            >
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Languages
            </span>
            {/* Pills, not checkboxes: a short multi-select reads better as
                toggles and matches the reference. */}
            <div className="mt-2 flex flex-wrap gap-2">
              {LANGUAGES.map((language) => {
                const on = languages.includes(language.code);
                return (
                  <button
                    key={language.code}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setLanguages((prev) =>
                        on ? prev.filter((code) => code !== language.code) : [...prev, language.code]
                      )
                    }
                    className={
                      'rounded-full border px-3 py-1 text-sm transition-colors ' +
                      (on
                        ? 'border-primary text-primary'
                        : 'border-input text-muted-foreground hover:text-foreground')
                    }
                  >
                    {language.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Field id="timeZone" label="Timezone">
            <select
              id="timeZone"
              className={selectClass}
              value={timeZone}
              onChange={(e) => {
                // From here on the country no longer overrides it.
                timeZoneTouched.current = true;
                setTimeZone(e.target.value);
              }}
            >
              <option value="">Select a time zone</option>
              {TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </Field>

          <Field id="financialYearPolicy" label="Financial year">
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
          </Field>

          <Field
            id="urlSlug"
            label="Account URL"
            // No preview of a subdomain: workspace URLs are deferred and there
            // is no DNS or routing contract behind that shape yet, so showing
            // one would be promising an address nobody has agreed to serve.
            help="This short name will be used to identify your account."
            status={
              <AvailabilityNote
                state={slugState}
                checking={slugChecking}
                invalidReason={
                  urlSlug && !slugValid
                    ? '2 to 63 characters, lowercase letters, digits and hyphens, with at least two letters.'
                    : undefined
                }
              />
            }
          >
            <Input
              id="urlSlug"
              value={urlSlug}
              onChange={(e) => {
                slugTouched.current = true;
                setUrlSlug(e.target.value.toLowerCase());
              }}
            />
          </Field>

          <Field
            id="tenantAdminMobile"
            label="Your mobile number"
            help={
              selectedCountry
                ? `Used to create your account inside the new workspace. Enter the number without the ${selectedCountry.dialCode} prefix.`
                : 'Used to create your account inside the new workspace.'
            }
          >
            <div className="flex items-center gap-2">
              {selectedCountry ? (
                <span className="shrink-0 rounded border bg-muted px-3 py-2 text-sm text-muted-foreground">
                  {selectedCountry.dialCode}
                </span>
              ) : null}
              <Input
                id="tenantAdminMobile"
                className="flex-1"
                value={tenantAdminMobile}
                onChange={(e) => setTenantAdminMobile(e.target.value)}
                placeholder={selectedCountry?.nationalExample ?? 'National number'}
              />
            </div>
          </Field>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('account')}>
              Back
            </Button>
            <Button className="flex-1" disabled={!preferencesReady || saving} onClick={() => advance('review')}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Continue
            </Button>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <div>
            <h2 className="text-[28px] font-semibold leading-[1.15]">Review and create your account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These will be the main entry points for your account once your workspace has been set
              up.
            </p>
          </div>

          <dl className="overflow-hidden rounded-md border">
            {[
              ['Account name', accountName],
              ['Account code', accountCode],
              ['Base country', COUNTRIES.find((c) => c.code === countryCode)?.name || countryCode],
              ['Languages', languages.map((c) => LANGUAGES.find((l) => l.code === c)?.label || c).join(', ')],
              ['Timezone', timeZone],
              ['Financial year', FINANCIAL_YEARS.find((f) => f.code === financialYearPolicy)?.label || financialYearPolicy],
              // With the prefix: the previous step taught "national part only,
              // prefix added for you", so showing it back bare gives the
              // founder nothing to check against the number they meant.
              [
                'Mobile number',
                selectedCountry ? `${selectedCountry.dialCode} ${tenantAdminMobile}` : tenantAdminMobile,
              ],
            ].map(([label, value], i) => (
              <div
                key={label}
                className={
                  'flex justify-between gap-4 px-4 py-3 text-sm ' + (i % 2 ? 'bg-muted/40' : '')
                }
              >
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
            <span className="text-muted-foreground">I agree to the terms of service.</span>
          </label>

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep('preferences')}>
              Back
            </Button>
            <Button className="flex-1" disabled={!acceptedTerms || saving} onClick={submit}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Create account
            </Button>
          </div>
        </section>
      )}
    </>
  );
}

export default function SignupPage() {
  return (
    <AuthShell>
      <SignupFlow />
    </AuthShell>
  );
}

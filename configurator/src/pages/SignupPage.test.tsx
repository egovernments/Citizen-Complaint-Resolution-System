import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupPage from './SignupPage';

// The gate links to /login, so the page needs a Router around it.
const render = (ui: React.ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);

/**
 * The network-facing half of the contract is mocked; the pure helpers
 * (derivations, validation) stay real so the screens are exercised against the
 * same rules the server enforces.
 */
vi.mock('@/api/onboarding', async () => {
  const actual = await vi.importActual<typeof import('@/api/onboarding')>('@/api/onboarding');
  return {
    ...actual,
    session: vi.fn(),
    authMethods: vi.fn(),
    tenants: vi.fn(),
    findSignup: vi.fn(),
    createSignup: vi.fn(),
    updateSignup: vi.fn(),
    checkIdentifier: vi.fn(),
    submitSignup: vi.fn(),
    findOperation: vi.fn(),
    selectContext: vi.fn(),
    startSignIn: vi.fn(),
    logout: vi.fn(),
  };
});

import * as api from '@/api/onboarding';

const signedIn = { authenticated: true, user: { id: 'u', email: 'f@x.test', name: 'F', preferredUsername: 'f' } };

beforeEach(() => {
  vi.mocked(api.checkIdentifier).mockResolvedValue({ type: 'URL_SLUG', value: 'x', available: true });
  vi.mocked(api.findSignup).mockResolvedValue(null);
});

afterEach(() => vi.clearAllMocks());

describe('sign-in gate', () => {
  it('renders only the methods the backend reports as enabled', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'password', label: 'Email and password', type: 'password' }],
    });

    render(<SignupPage />);

    expect(await screen.findByRole('button', { name: /email and password/i })).toBeInTheDocument();
    // Nothing is hardcoded, so a provider that is off simply does not appear.
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  });

  it('keeps every alternative method separately clickable', async () => {
    // With two methods `rest` held one item and nothing was visibly wrong.
    // A third made them touch: they rendered inline with no separator, so
    // "Continue with GitHub" and "Email me a sign-in link" ran together as one
    // string and aiming for one hit the other.
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [
        { id: 'password', label: 'Email and password', type: 'password' },
        { id: 'github', label: 'Continue with GitHub', type: 'oauth' },
        { id: 'magic-link', label: 'Email me a sign-in link', type: 'magic_link' },
      ],
    });

    render(<SignupPage />);

    const magic = await screen.findByRole('button', { name: 'Email me a sign-in link' });
    const github = screen.getByRole('button', { name: 'Continue with GitHub' });

    // Worth being explicit: the defect was visual, and the DOM alone cannot see
    // it. Both buttons resolved by accessible name before this fix too, which
    // is exactly why it survived to production. So assert the layout that
    // separates them, since that is the actual fix.
    const row = magic.parentElement as HTMLElement;
    expect(row).toBe(github.parentElement);
    expect(row.className).toMatch(/flex-col/);
    expect(row.className).toMatch(/gap-/);

    fireEvent.click(magic);
    expect(api.startSignIn).toHaveBeenCalledWith('magic-link');
  });

  it('hands sign-in to the backend rather than collecting a credential', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'password', label: 'Email and password', type: 'password' }],
    });

    render(<SignupPage />);
    fireEvent.click(await screen.findByRole('button', { name: /email and password/i }));

    expect(api.startSignIn).toHaveBeenCalledWith('password');
    // The whole point: no password field ever exists in this flow.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

/** Account step is local now; the draft is created at the end of Preferences. */
const completeAccountStep = async (name = 'Bomet County Government') => {
  fireEvent.change(await screen.findByLabelText(/account name/i), { target: { value: name } });
  await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /continue/i }));
  await screen.findByLabelText(/base country/i);
};

const fillPreferences = async () => {
  fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
  fireEvent.change(screen.getByLabelText(/timezone/i), { target: { value: 'Africa/Nairobi' } });
  fireEvent.change(screen.getByLabelText(/financial year/i), { target: { value: 'JUL_JUN' } });
  fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '+254700000199' } });
};

describe('wizard', () => {
  beforeEach(() => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
  });

  it('derives the account code from the name', async () => {
    render(<SignupPage />);
    fireEvent.change(await screen.findByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    await waitFor(() => expect(screen.getByLabelText(/account code/i)).toHaveValue('BCG'));
  });

  it('re-prefixes the code once a country is chosen', async () => {
    render(<SignupPage />);
    await completeAccountStep();
    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.getByLabelText(/account code/i)).toHaveValue('KE-BCG'));
  });

  it('derives the slug without promising an address for it', async () => {
    render(<SignupPage />);
    await completeAccountStep();
    expect(screen.getByLabelText(/account url/i)).toHaveValue('bomet-county-government');
    // Workspace URLs are deferred and no DNS or routing contract stands behind
    // that subdomain shape, so the slug is collected and nothing is promised.
    expect(screen.queryByText(/cms\.digit\.org/)).not.toBeInTheDocument();
  });

  it('stops deriving once the operator edits the code themselves', async () => {
    render(<SignupPage />);
    fireEvent.change(await screen.findByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    const code = screen.getByLabelText(/account code/i);
    fireEvent.change(code, { target: { value: 'KE-CUSTOM' } });
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Something Else' } });
    await waitFor(() => expect(code).toHaveValue('KE-CUSTOM'));
  });

  it('explains an invalid slug instead of silently refusing to continue', async () => {
    render(<SignupPage />);
    await completeAccountStep();
    fireEvent.change(screen.getByLabelText(/account url/i), { target: { value: '12-34' } });
    expect(await screen.findByText(/at least two letters/i)).toBeInTheDocument();
  });

  it('creates the draft once Preferences is complete, not before', async () => {
    vi.mocked(api.createSignup).mockResolvedValue({ id: 'signup-1', status: 'DRAFT' } as never);
    render(<SignupPage />);

    await completeAccountStep();
    // The server needs countryCode and urlSlug to create at all, so nothing is
    // sent until this step is done.
    expect(api.createSignup).not.toHaveBeenCalled();

    await fillPreferences();
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(api.createSignup).toHaveBeenCalledTimes(1));
    const [draft, key] = vi.mocked(api.createSignup).mock.calls[0];
    expect(draft.accountName).toBe('Bomet County Government');
    expect(draft.countryCode).toBe('KE');
    expect(draft.urlSlug).toBe('bomet-county-government');
    expect(key).toBeTruthy();
  });

  it('leaves terms out of the payload until the operator agrees', async () => {
    // A blank value is rejected where an absent field is accepted.
    vi.mocked(api.createSignup).mockResolvedValue({ id: 'signup-1', status: 'DRAFT' } as never);
    render(<SignupPage />);
    await completeAccountStep();
    await fillPreferences();
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(api.createSignup).toHaveBeenCalledTimes(1));
    const [draft] = vi.mocked(api.createSignup).mock.calls[0];
    expect('acceptedTermsVersion' in draft).toBe(false);
  });

  it('resumes an existing draft rather than starting a second', async () => {
    vi.mocked(api.findSignup).mockResolvedValue({
      id: 'signup-1',
      status: 'DRAFT',
      accountName: 'Bomet County',
      accountCode: 'KE-BC',
      urlSlug: 'bomet-county',
      countryCode: 'KE',
      languages: ['en'],
      timeZone: 'Africa/Nairobi',
      financialYearPolicy: 'JUL_JUN',
      tenantMetadata: { schemaVersion: 1, tenantAdmin: { mobileNumber: '+254700000199' } },
    } as never);

    render(<SignupPage />);
    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toHaveValue('Bomet County'));
    expect(api.createSignup).not.toHaveBeenCalled();
  });
});

describe('a signup that ended FAILED', () => {
  it('says so instead of showing a wizard whose saves the server will reject', async () => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    vi.mocked(api.findSignup).mockResolvedValue({
      id: '654c74d6',
      status: 'FAILED',
      accountName: 'Bomet County Government',
    } as never);
    // ACTIVE is a success, not a dead end, so it must not land here.

    render(<SignupPage />);

    // Only a DRAFT is editable, and `_create` hands the same failed record
    // back, so the wizard would be a trap.
    expect(await screen.findByText(/this signup is closed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument();
    expect(screen.getByText('654c74d6')).toBeInTheDocument();
  });
});

describe('a signup that already provisioned', () => {
  it('is not mistaken for a dead end', async () => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    vi.mocked(api.findSignup).mockResolvedValue({
      id: 'signup-1',
      status: 'ACTIVE',
      accountName: 'Bomet County Government',
    } as never);

    render(<SignupPage />);

    await waitFor(() => expect(screen.queryByText(/this signup is closed/i)).not.toBeInTheDocument());
  });
});

describe('expired session', () => {
  it('returns to sign-in rather than leaving a button that can only fail', async () => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'password', label: 'Email and password', type: 'password' }],
    });
    vi.mocked(api.createSignup).mockRejectedValue(
      new api.OnboardingError(401, 'ONBOARDING_IDENTITY_REQUIRED', 'A valid identity session is required')
    );

    render(<SignupPage />);
    await completeAccountStep();
    await fillPreferences();
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/sign-in expired/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /email and password/i })).toBeInTheDocument();
  });
});

describe('provisioning', () => {
  it('shows the worker steps and offers a retry only when the failure is retryable', async () => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    vi.mocked(api.findSignup).mockResolvedValue({
      id: 'signup-1',
      status: 'DRAFT',
      accountName: 'Bomet County',
      accountCode: 'KE-BC',
      urlSlug: 'bomet-county',
      countryCode: 'KE',
      languages: ['en'],
      timeZone: 'Africa/Nairobi',
      financialYearPolicy: 'JUL_JUN',
      tenantMetadata: { schemaVersion: 1, tenantAdmin: { mobileNumber: '+254700000199' } },
    } as never);
    vi.mocked(api.updateSignup).mockResolvedValue({ id: 'signup-1' } as never);
    vi.mocked(api.submitSignup).mockResolvedValue({
      id: 'op-1',
      signupId: 'signup-1',
      status: 'RETRYABLE_FAILED',
      currentStep: 'ORGANIZATION',
      completedSteps: ['TENANT_FOUNDATION'],
      errorCode: 'ONBOARDING_VALIDATION_ERROR',
      errorMessage: 'Could not create the organization.',
      attempt: 1,
      createdAt: 0,
      updatedAt: 0,
    } as never);

    render(<SignupPage />);

    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toHaveValue('Bomet County'));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/could not create the organization/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

/**
 * A tenant can hand out a correctly scoped DIGIT token long before it has any
 * platform configuration, so entering on the strength of a successful sign-in
 * drops the operator into a console where every call is refused (CCRS#2073 G9).
 */
describe('preferences follow the selected country (CCRS#2098)', () => {
  beforeEach(() => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
  });

  const reachPreferences = async () => {
    await completeAccountStep();
  };

  it('re-suggests the timezone when the country changes', async () => {
    // The old guard fired only while the field was empty, so the first pick
    // filled it and every later country change silently kept the old zone,
    // submitting India next to Africa/Nairobi.
    render(<SignupPage />);
    await reachPreferences();

    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Africa/Nairobi');

    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'IN' } });
    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Asia/Kolkata');
  });

  it('leaves a timezone the operator picked themselves alone', async () => {
    // The original intent, now tracked rather than inferred.
    render(<SignupPage />);
    await reachPreferences();

    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
    fireEvent.change(screen.getByLabelText(/timezone/i), { target: { value: 'Asia/Jakarta' } });
    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'IN' } });

    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Asia/Jakarta');
  });

  it('shows the dial code and example for the selected country, not Kenya', async () => {
    render(<SignupPage />);
    await reachPreferences();

    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'IN' } });
    expect(screen.getByText('+91')).toBeInTheDocument();
    expect(screen.queryByText('+254')).not.toBeInTheDocument();

    const mobile = screen.getByLabelText(/mobile number/i);
    // National format, which is what the backend validates. The old hint was
    // international, so copying its shape produced a validation failure.
    expect(mobile).toHaveAttribute('placeholder', '9876543210');
    expect(mobile.getAttribute('placeholder')).not.toMatch(/^\+/);
  });

  it('offers no invented example for a country we have no format for', async () => {
    // Only KE, IN and ET have authoritative MobileNumberValidation records in
    // this repo. A made-up example would be the same defect as the hardcoded
    // Kenyan one, so those countries get the dial code and a neutral hint.
    render(<SignupPage />);
    await reachPreferences();

    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'NG' } });
    expect(screen.getByText('+234')).toBeInTheDocument();
    expect(screen.getByLabelText(/mobile number/i)).toHaveAttribute('placeholder', 'National number');
  });
});

describe('workspace readiness gate', () => {
  const option = (readiness?: 'IDENTITY_READY' | 'PROVISIONING' | 'READY' | 'FAILED') => ({
    organizationAlias: 'kisumu-county',
    tenantId: 'kisumucounty',
    name: 'Kisumu County',
    roles: ['MDMS_ADMIN'],
    ...(readiness ? { readiness } : {}),
  });

  const withTenant = (readiness?: 'IDENTITY_READY' | 'PROVISIONING' | 'READY' | 'FAILED') => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({
      tenants: [option(readiness)],
      selectionRequired: true,
      onboardingRequired: false,
    });
  };

  const pickWorkspace = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /kisumu county/i }));
  };

  it('holds a workspace the backend has called identity-ready', async () => {
    withTenant('IDENTITY_READY');

    render(<SignupPage />);
    await pickWorkspace();

    expect(await screen.findByText(/workspace setup required/i)).toBeInTheDocument();
    // No token is minted and nothing is mounted, so the calls that come back
    // AccessDeniedException are never fired.
    expect(api.selectContext).not.toHaveBeenCalled();
  });

  it('holds it without consulting the caller\'s own signup record', async () => {
    // Readiness answers for the workspace. An invited admin has no signup at
    // all and must still be held out of a half-built tenant.
    withTenant('IDENTITY_READY');
    vi.mocked(api.findSignup).mockResolvedValue(null);

    render(<SignupPage />);
    await pickWorkspace();

    await screen.findByText(/workspace setup required/i);
    expect(api.findSignup).not.toHaveBeenCalled();
  });

  it('offers no way to continue setup while there is no setup to continue', async () => {
    withTenant('IDENTITY_READY');

    render(<SignupPage />);
    await pickWorkspace();
    await screen.findByText(/workspace setup required/i);

    expect(screen.queryByRole('button', { name: /continue setup/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('does not say setup is running when nothing is running', async () => {
    withTenant('IDENTITY_READY');

    render(<SignupPage />);
    await pickWorkspace();
    await screen.findByText(/workspace setup required/i);

    expect(screen.queryByText(/still being set up/i)).not.toBeInTheDocument();
    expect(screen.getByText(/has not been installed yet/i)).toBeInTheDocument();
  });

  it('clears the DIGIT half of the session on sign out, not just the identity half', async () => {
    withTenant('IDENTITY_READY');
    window.localStorage.setItem('crs-auth-state', JSON.stringify({ authToken: 'stale' }));

    render(<SignupPage />);
    await pickWorkspace();
    await screen.findByText(/workspace setup required/i);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    // A surviving token would restore on a walk back to / or /manage.
    await waitFor(() => expect(window.localStorage.getItem('crs-auth-state')).toBeNull());
  });

  it('lets a tenant through when the backend has stated no readiness at all', async () => {
    // /identity/v1/tenants returns every membership, so an absent value covers
    // Bomet and every other configured tenant. Gating on it locked them all out
    // of selectContext permanently.
    withTenant();
    vi.mocked(api.selectContext).mockResolvedValue({
      access_token: 't',
      token_type: 'bearer',
      expires_in: 3600,
      scope: '',
      UserRequest: { uuid: 'u', userName: 'kcbff', tenantId: 'kisumucounty', roles: [] },
    });

    render(<SignupPage />);
    await pickWorkspace();

    await waitFor(() => expect(api.selectContext).toHaveBeenCalledWith('kisumucounty'));
    expect(screen.queryByText(/workspace setup required/i)).not.toBeInTheDocument();
  });

  it('enters only when the backend says the workspace is ready', async () => {
    withTenant('READY');
    vi.mocked(api.selectContext).mockResolvedValue({
      access_token: 't',
      token_type: 'bearer',
      expires_in: 3600,
      scope: '',
      UserRequest: { uuid: 'u', userName: 'kcbff-a0075c51', name: 'Prateek Test', emailId: 'f@x.test', tenantId: 'kisumucounty', roles: [] },
    });

    render(<SignupPage />);
    await pickWorkspace();

    await waitFor(() => expect(api.selectContext).toHaveBeenCalledWith('kisumucounty'));
    expect(screen.queryByText(/workspace setup required/i)).not.toBeInTheDocument();
  });

  it('hands off the real identity rather than one built from the username', async () => {
    withTenant('READY');
    vi.mocked(api.selectContext).mockResolvedValue({
      access_token: 't',
      token_type: 'bearer',
      expires_in: 3600,
      scope: '',
      UserRequest: { uuid: 'u', userName: 'kcbff-a0075c51', name: 'Prateek Test', emailId: 'real@example.com', tenantId: 'kisumucounty', roles: [] },
    });

    render(<SignupPage />);
    await pickWorkspace();

    await waitFor(() => expect(window.localStorage.getItem('crs-auth-state')).toBeTruthy());
    const stored = JSON.parse(window.localStorage.getItem('crs-auth-state') as string);
    expect(stored.user.name).toBe('Prateek Test');
    expect(stored.user.email).toBe('real@example.com');
    // The managed username is a machine handle; an address built from it does
    // not exist and must never be invented.
    expect(stored.user.email).not.toContain('kcbff');
    expect(stored.user.email).not.toContain('@digit.org');
  });
});

describe('resuming a run that was already going', () => {
  const resumable = (status: 'SUBMITTED' | 'PROVISIONING') => ({
    id: 's1',
    status,
    accountName: 'Kisumu County',
    accountCode: 'KE-KC',
    organizationAlias: 'kisumu-county',
    requestedTenantId: 'kisumucounty',
    urlSlug: 'kisumu-county',
    countryCode: 'KE',
    languages: ['en'],
    timeZone: 'Africa/Nairobi',
    financialYearPolicy: 'JUL_JUN',
    acceptedTermsVersion: '2026-09',
    tenantMetadata: { schemaVersion: 1 as const, tenantAdmin: { mobileNumber: '712345678' } },
    version: 4,
    createdAt: 0,
    updatedAt: 0,
  });

  beforeEach(() => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
  });

  const runningOperation = {
    id: 'op1',
    signupId: 's1',
    status: 'RUNNING' as const,
    currentStep: 'ORGANIZATION' as const,
    completedSteps: ['TENANT_FOUNDATION'] as const,
    errorCode: null,
    errorMessage: null,
    attempt: 1,
  };

  it.each(['SUBMITTED', 'PROVISIONING'] as const)(
    'does not hand back an editable wizard for a %s signup',
    async (status) => {
      // Only a DRAFT may be edited, so the wizard here is a form whose every
      // save the backend refuses.
      vi.mocked(api.findSignup).mockResolvedValue(resumable(status));
      vi.mocked(api.submitSignup).mockResolvedValue(runningOperation as never);

      render(<SignupPage />);

      expect(await screen.findByText(/setting up kisumu county/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument();
    },
  );

  it('reacquires the running operation rather than only watching the signup', async () => {
    // `_submit` is idempotent and hands back the existing operation before the
    // DRAFT guard, so it recovers progress instead of starting a second run.
    vi.mocked(api.findSignup).mockResolvedValue(resumable('PROVISIONING'));
    vi.mocked(api.submitSignup).mockResolvedValue(runningOperation as never);

    render(<SignupPage />);

    await waitFor(() => expect(api.submitSignup).toHaveBeenCalledWith('s1', expect.any(String)));
    // Real progress, read from the operation rather than invented.
    expect(await screen.findByText(/creating your account/i)).toBeInTheDocument();
  });

  it('surfaces the retry on a resumed retryable failure', async () => {
    // PGR leaves the signup PROVISIONING when an operation goes
    // RETRYABLE_FAILED; only a terminal failure moves it to FAILED. Watching
    // the signup alone would sit here forever and never offer the retry.
    vi.mocked(api.findSignup).mockResolvedValue(resumable('PROVISIONING'));
    vi.mocked(api.submitSignup).mockResolvedValue({
      ...runningOperation,
      status: 'RETRYABLE_FAILED',
      errorCode: 'DIGIT_UNAVAILABLE',
      errorMessage: 'DIGIT is not answering',
    } as never);

    render(<SignupPage />);

    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText(/DIGIT is not answering/)).toBeInTheDocument();
  });

  it('invents no step detail when the operation cannot be recovered', async () => {
    vi.mocked(api.findSignup).mockResolvedValue(resumable('PROVISIONING'));
    vi.mocked(api.submitSignup).mockRejectedValue(new api.OnboardingError(500, null, 'nope'));

    render(<SignupPage />);
    await screen.findByText(/setting up kisumu county/i);

    expect(screen.queryByText(/creating your account/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/granting your permissions/i)).not.toBeInTheDocument();
  });

  it('does not reopen the wizard for an ACTIVE signup whose tenant has not surfaced', async () => {
    vi.mocked(api.findSignup).mockResolvedValue({ ...resumable('PROVISIONING'), status: 'ACTIVE' as const });

    render(<SignupPage />);

    expect(await screen.findByText(/opening your workspace/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument();
  });
});

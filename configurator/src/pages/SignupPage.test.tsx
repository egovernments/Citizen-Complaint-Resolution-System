import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupPage from './SignupPage';

// The gate links to /login, so the page needs a Router around it.
const render = (ui: React.ReactElement, path = '/') =>
  rtlRender(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

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
    consumeAuthResult: vi.fn(),
    tenants: vi.fn(),
    findSignup: vi.fn(),
    createSignup: vi.fn(),
    updateSignup: vi.fn(),
    checkIdentifier: vi.fn(),
    submitSignup: vi.fn(),
    findOperation: vi.fn(),
    selectContext: vi.fn(),
    startSignIn: vi.fn(),
    requestMagicLinkSignup: vi.fn(),
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

  it('does not resume a session an unconfirmed sign-out may have left, until the user chooses a method', async () => {
    localStorage.setItem('crs-sign-out-incomplete', '1');
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'google', label: 'Continue with Google', type: 'oidc' }],
    });

    render(<SignupPage />);

    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));
    expect(api.session).not.toHaveBeenCalled();
    expect(api.tenants).not.toHaveBeenCalled();
    expect(localStorage.getItem('crs-sign-out-incomplete')).toBeNull();
    expect(api.startSignIn).toHaveBeenCalledWith('google', 'signup');
  });

  it('shows the GitHub mark on the GitHub signup action', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'github', label: 'Continue with GitHub', type: 'oauth' }],
    });

    render(<SignupPage />);

    const github = await screen.findByRole('button', { name: /continue with github/i });
    const mark = github.querySelector('svg[data-icon="inline-start"][data-provider="github"]');
    expect(mark?.querySelector('path')).toHaveAttribute('fill', '#181717');
  });

  it('collects the signup identity in Configurator and shows check-email without opening Keycloak', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'magic-link', label: 'Email me a sign-in link', type: 'magic_link' }],
    });
    vi.mocked(api.requestMagicLinkSignup).mockResolvedValue({
      message: 'Check your email for a link to continue creating your account.',
    });

    render(<SignupPage />);
    fireEvent.change(await screen.findByLabelText(/first name/i), { target: { value: 'Amina' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Diallo' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'amina@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }));

    await waitFor(() => expect(api.requestMagicLinkSignup).toHaveBeenCalledWith({
      firstName: 'Amina',
      lastName: 'Diallo',
      email: 'amina@example.org',
    }));
    expect(await screen.findByRole('heading', { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByText(/amina@example.org/i)).toBeInTheDocument();
    expect(api.startSignIn).not.toHaveBeenCalled();
  });

  it('hands sign-in to the backend rather than collecting a credential', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'password', label: 'Email and password', type: 'password' }],
    });

    render(<SignupPage />);
    fireEvent.click(await screen.findByRole('button', { name: /email and password/i }));

    expect(api.startSignIn).toHaveBeenCalledWith('password', 'signup');
    // The whole point: no password field ever exists in this flow.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('renders a callback failure on the signup page that initiated it', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'magic_link', label: 'Email me a sign-in link', type: 'magic_link' }],
    });
    vi.mocked(api.consumeAuthResult).mockResolvedValue({
      status: 'failed',
      code: 'AUTH_CANCELLED',
      message: 'Sign-up was cancelled. No changes were made to your account.',
      actions: ['TRY_AGAIN'],
    });

    render(<SignupPage />, '/signup?authResult=signup-result');

    expect(await screen.findByText(/sign-up was cancelled/i)).toBeInTheDocument();
    expect(api.consumeAuthResult).toHaveBeenCalledWith('signup-result');
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
    await waitFor(() => expect(screen.getByLabelText(/account code/i)).toHaveValue('BOMET-COUNTY-GOVERNMENT'));
  });

  it('re-prefixes the code once a country is chosen', async () => {
    render(<SignupPage />);
    await completeAccountStep();
    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    await waitFor(() => expect(screen.getByLabelText(/account code/i)).toHaveValue('KE-BOMET-COUNTY-GOVERNMENT'));
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

  it('explains when a free slug projects to an occupied tenant id', async () => {
    vi.mocked(api.checkIdentifier).mockImplementation(async (type, value) => type === 'URL_SLUG'
      ? { type, value, available: false, conflictingType: 'TENANT_ID', derivedTenantId: 'kd' }
      : { type, value, available: true });

    render(<SignupPage />);
    await completeAccountStep();
    fireEvent.change(screen.getByLabelText(/account url/i), { target: { value: 'kd4' } });

    expect(await screen.findByText(/maps to tenant ID “kd”.*already in use/i)).toBeInTheDocument();
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

  const resumedDraft = (accountCode: string) => ({
    id: 'signup-1',
    status: 'DRAFT',
    accountName: 'Bomet County',
    accountCode,
    urlSlug: 'bomet-county',
    countryCode: 'KE',
    languages: ['en'],
    timeZone: 'Africa/Nairobi',
    financialYearPolicy: 'JUL_JUN',
    tenantMetadata: { schemaVersion: 1, tenantAdmin: { mobileNumber: '+254700000199' } },
  });

  it('keeps deriving a resumed code that was never edited by hand', async () => {
    vi.mocked(api.findSignup).mockResolvedValue(resumedDraft('KE-BOMET-COUNTY') as never);
    render(<SignupPage />);
    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toHaveValue('Bomet County'));

    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Bomet County Government' } });

    await waitFor(() => expect(screen.getByLabelText(/account code/i)).toHaveValue('KE-BOMET-COUNTY-GOVERNMENT'));
  });

  it('never overwrites a resumed code the operator typed', async () => {
    vi.mocked(api.findSignup).mockResolvedValue(resumedDraft('KE-BOMET') as never);
    render(<SignupPage />);
    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toHaveValue('Bomet County'));

    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Bomet County Government' } });

    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toHaveValue('Bomet County Government'));
    expect(screen.getByLabelText(/account code/i)).toHaveValue('KE-BOMET');
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
  /** Walks the wizard to "Create account" and submits, the run coming back as `operation`. */
  async function submitWith(operation: Record<string, unknown>) {
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
    const run = { id: 'op-1', signupId: 'signup-1', errorCode: null, errorMessage: null, attempt: 1, createdAt: 0, updatedAt: 0, ...operation };
    vi.mocked(api.submitSignup).mockResolvedValue(run as never);
    vi.mocked(api.findOperation).mockResolvedValue(run as never);

    render(<SignupPage />);

    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toHaveValue('Bomet County'));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
  }

  const spinning = (label: RegExp) => !!screen.getByText(label).closest('li')?.querySelector('.animate-spin');

  it('shows the worker steps and offers a retry only when the failure is retryable', async () => {
    await submitWith({
      status: 'RETRYABLE_FAILED',
      currentStep: 'ORGANIZATION',
      completedSteps: ['TENANT_FOUNDATION'],
      errorCode: 'ONBOARDING_VALIDATION_ERROR',
      errorMessage: 'Could not create the organization.',
    });

    expect(await screen.findByText(/could not create the organization/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it("follows PGR's steps, so the step the run is on is the one that spins", async () => {
    await submitWith({ status: 'RUNNING', currentStep: 'PLATFORM_BASELINE', completedSteps: ['TENANT_FOUNDATION'] });

    expect(await screen.findByText('Setting up the basics')).toBeInTheDocument();
    expect(spinning(/setting up the basics/i)).toBe(true);
    expect(spinning(/creating your workspace/i)).toBe(false);
    expect(screen.getByText('Connecting your sign-in')).toBeInTheDocument();
  });

  it('spins on the first step not done after a resubmit, not on the stale currentStep', async () => {
    // OnboardingRepository.resubmit clears completed_steps and leaves current_step alone.
    await submitWith({ status: 'PENDING', currentStep: 'ORGANIZATION', completedSteps: [] });

    expect(await screen.findByText('Creating your workspace')).toBeInTheDocument();
    expect(spinning(/creating your workspace/i)).toBe(true);
    expect(spinning(/setting up your organisation/i)).toBe(false);
  });

  it('spins nothing once the run has succeeded, even on a step code it does not know', async () => {
    await submitWith({
      status: 'SUCCEEDED',
      currentStep: null,
      completedSteps: ['TENANT_FOUNDATION', 'PLATFORM_BASELINE', 'FOUNDER_EMPLOYEE', 'ORGANIZATION', 'MEMBERSHIP', 'BINDING'],
      lifecyclePublishedAt: null,
    });

    expect(await screen.findByText('Creating your employee record')).toBeInTheDocument();
    expect(document.querySelector('li .animate-spin')).toBeNull();
  });

  it('still shows progress on a step code it does not know', async () => {
    await submitWith({ status: 'RUNNING', currentStep: 'SOME_NEW_STEP', completedSteps: ['TENANT_FOUNDATION', 'PLATFORM_BASELINE'] });

    expect(await screen.findByText('Creating your employee record')).toBeInTheDocument();
    expect(spinning(/creating your employee record/i)).toBe(true);
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
    fireEvent.change(screen.getByLabelText(/timezone/i), { target: { value: 'Africa/Maputo' } });
    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'IN' } });

    expect(screen.getByLabelText(/timezone/i)).toHaveValue('Africa/Maputo');
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

  it('routes an invitation before creating or searching a signup', async () => {
    vi.mocked(api.session).mockResolvedValue({ ...signedIn, pendingInvitations: [{ tenantId: 'invited', invitationVersion: 2, name: 'Invited workspace', invitedAt: 1, expiresAt: Date.now() + 60000 }] });
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    render(<SignupPage />);
    expect(await screen.findByRole('button', { name: /accept invitation/i })).toBeInTheDocument();
    expect(api.findSignup).not.toHaveBeenCalled();
  });

  it('shows memberships before pending invitations even when onboardingRequired is true', async () => {
    vi.mocked(api.session).mockResolvedValue({ ...signedIn, pendingInvitations: [{ tenantId: 'invited', invitationVersion: 2, name: 'Invited workspace', invitedAt: 1, expiresAt: Date.now() + 60000 }] });
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [option()], selectionRequired: true, onboardingRequired: true });
    render(<SignupPage />);
    expect(await screen.findByRole('button', { name: /kisumu county/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept invitation/i })).not.toBeInTheDocument();
    expect(api.findSignup).not.toHaveBeenCalled();
  });

  it('does not allow accepting an expired invitation', async () => {
    vi.mocked(api.session).mockResolvedValue({ ...signedIn, pendingInvitations: [{ tenantId: 'invited', invitationVersion: 2, name: 'Invited workspace', invitedAt: 1, expiresAt: 2 }] });
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    render(<SignupPage />);
    expect(await screen.findByRole('button', { name: /accept invitation/i })).toBeDisabled();
  });

  it('does not consult the founder signup when entering an existing membership', async () => {
    withTenant(); render(<SignupPage />);
    await screen.findByRole('button', { name: /kisumu county/i });
    expect(api.findSignup).not.toHaveBeenCalled();
  });

  it('shows selection errors without claiming setup is running', async () => {
    withTenant(); vi.mocked(api.selectContext).mockRejectedValueOnce(new Error('Account locked'));
    render(<SignupPage />); await pickWorkspace();
    expect(await screen.findByText('Account locked')).toBeInTheDocument();
    expect(screen.queryByText(/workspace setup is running/i)).not.toBeInTheDocument();
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
    expect(await screen.findByText(/creating your workspace/i)).toBeInTheDocument();
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

    expect(screen.queryByText(/creating your workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/connecting your sign-in/i)).not.toBeInTheDocument();
  });

  it('does not reopen the wizard for an ACTIVE signup whose tenant has not surfaced', async () => {
    vi.mocked(api.findSignup).mockResolvedValue({ ...resumable('PROVISIONING'), status: 'ACTIVE' as const });

    render(<SignupPage />);

    expect(await screen.findByText(/opening your workspace/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument();
  });
});

/**
 * PGR marks the run SUCCEEDED, then publishes the outcome to the identity side
 * on a later tick. Until then the tenant list is empty and selecting the tenant
 * is refused, so success waits for `lifecyclePublishedAt` (CCRS#2303).
 */
describe('a success that is not yet published', () => {
  const provisioning = {
    id: 's1',
    status: 'PROVISIONING' as const,
    accountName: 'Kisumu County',
    urlSlug: 'kisumu-county',
    countryCode: 'KE',
    languages: ['en'],
    version: 4,
    createdAt: 0,
    updatedAt: 0,
  };
  const succeeded = {
    id: 'op1',
    signupId: 's1',
    status: 'SUCCEEDED' as const,
    currentStep: null,
    completedSteps: ['TENANT_FOUNDATION', 'PLATFORM_BASELINE', 'FOUNDER_HRMS', 'ORGANIZATION', 'MEMBERSHIP', 'BINDING'],
    errorCode: null,
    errorMessage: null,
    attempt: 1,
    lifecyclePublishedAt: null,
    createdAt: 0,
    updatedAt: 0,
  };
  const kisumu = { organizationAlias: 'kisumu-county', tenantId: 'kisumucounty', name: 'Kisumu County', roles: [] };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    vi.mocked(api.findSignup).mockResolvedValue(provisioning as never);
    vi.mocked(api.submitSignup).mockResolvedValue(succeeded as never);
  });
  afterEach(() => vi.useRealTimers());

  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('keeps polling instead of reading a tenant list that is not there yet', async () => {
    // A fresh object per read, as the network gives; the poll re-arms on change.
    vi.mocked(api.findOperation).mockImplementation(async () => ({ ...succeeded }) as never);

    render(<SignupPage />);
    expect(await screen.findByText(/finishing setup/i)).toBeInTheDocument();
    await tick(3000);
    await tick(3000);

    expect(api.findOperation).toHaveBeenCalledTimes(2);
    // Only bootstrap's own read; nothing treated SUCCEEDED as ready.
    expect(api.tenants).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/choose a workspace/i)).not.toBeInTheDocument();
  });

  it('opens the workspace once the outcome is published', async () => {
    vi.mocked(api.findOperation).mockResolvedValue({ ...succeeded, lifecyclePublishedAt: 1 } as never);

    render(<SignupPage />);
    await screen.findByText(/finishing setup/i);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [kisumu], selectionRequired: true, onboardingRequired: false });
    await tick(3000);

    expect(await screen.findByText(/choose a workspace/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /kisumu county/i })).toBeInTheDocument();
  });

  it('says it is almost ready after a long wait, and slows down without giving up', async () => {
    // A fresh object per read, as the network gives; the poll re-arms on change.
    vi.mocked(api.findOperation).mockImplementation(async () => ({ ...succeeded }) as never);

    render(<SignupPage />);
    await screen.findByText(/finishing setup/i);
    await tick(120_000);

    expect(await screen.findByText(/almost ready/i)).toBeInTheDocument();
    const calls = vi.mocked(api.findOperation).mock.calls.length;
    await tick(15_000);
    expect(api.findOperation).toHaveBeenCalledTimes(calls + 1);
    expect(screen.queryByText(/choose a workspace/i)).not.toBeInTheDocument();
  });
});

/**
 * The checklist reads the operation the worker checkpoints, so the poll must
 * outlive answers that change nothing, come back empty or never return, and a
 * single failed check is a blip rather than an error.
 */
describe('polling while the worker runs', () => {
  const provisioning = {
    id: 's1',
    status: 'PROVISIONING' as const,
    accountName: 'Kisumu County',
    urlSlug: 'kisumu-county',
    countryCode: 'KE',
    languages: ['en'],
    version: 4,
    createdAt: 0,
    updatedAt: 0,
  };
  const running = {
    id: 'op1',
    signupId: 's1',
    status: 'RUNNING' as const,
    currentStep: 'ORGANIZATION',
    completedSteps: ['TENANT_FOUNDATION'],
    errorCode: null,
    errorMessage: null,
    attempt: 1,
    lifecyclePublishedAt: null,
    createdAt: 0,
    updatedAt: 0,
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    vi.mocked(api.findSignup).mockResolvedValue(provisioning as never);
    vi.mocked(api.submitSignup).mockResolvedValue(running as never);
  });
  afterEach(() => vi.useRealTimers());

  const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const start = async () => {
    render(<SignupPage />);
    expect(await screen.findByText(/setting up kisumu county/i)).toBeInTheDocument();
  };

  it('keeps polling when an answer changes nothing or comes back empty', async () => {
    // The same object every time: a poll re-armed only on change would stop after the first.
    vi.mocked(api.findOperation).mockResolvedValueOnce(null).mockResolvedValue(running as never);
    await start();
    await tick(3000);
    await tick(3000);
    await tick(3000);
    expect(api.findOperation).toHaveBeenCalledTimes(3);
  });

  it('abandons a check that never answers and asks again', async () => {
    vi.mocked(api.findOperation).mockImplementationOnce(
      (_id: string, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))) as never,
    ).mockResolvedValue(running as never);
    await start();
    await tick(3000);
    expect(api.findOperation).toHaveBeenCalledTimes(1);
    await tick(10_000);
    await tick(3000);
    expect(api.findOperation).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/aborted/i)).not.toBeInTheDocument();
  });

  it('shows an error only after three failed checks in a row, and clears it once one succeeds', async () => {
    vi.mocked(api.findOperation)
      .mockRejectedValueOnce(new Error('Status check failed'))
      .mockRejectedValueOnce(new Error('Status check failed'))
      .mockRejectedValueOnce(new Error('Status check failed'))
      .mockResolvedValue(running as never);
    await start();
    await tick(3000);
    await tick(3000);
    expect(screen.queryByText(/status check failed/i)).not.toBeInTheDocument();
    await tick(3000);
    expect(await screen.findByText(/status check failed/i)).toBeInTheDocument();
    await tick(3000);
    await waitFor(() => expect(screen.queryByText(/status check failed/i)).not.toBeInTheDocument());
    expect(api.findOperation).toHaveBeenCalledTimes(4);
  });
});

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

  it('derives the account URL and previews it', async () => {
    render(<SignupPage />);
    await completeAccountStep();
    expect(screen.getByLabelText(/account url/i)).toHaveValue('bomet-county-government');
    expect(screen.getByText(/bomet-county-government\.cms\.digit\.org/)).toBeInTheDocument();
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
describe('workspace readiness gate', () => {
  const option = { organizationAlias: 'kisumu-county', tenantId: 'kisumucounty', name: 'Kisumu County', roles: ['MDMS_ADMIN'] };

  const activeSignup = {
    id: 's1',
    status: 'ACTIVE' as const,
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
  };

  beforeEach(() => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [option], selectionRequired: true, onboardingRequired: false });
  });

  const pickWorkspace = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /kisumu county/i }));
  };

  it('holds a tenant that has only had its identity floor installed', async () => {
    vi.mocked(api.findSignup).mockResolvedValue(activeSignup);

    render(<SignupPage />);
    await pickWorkspace();

    expect(await screen.findByText(/workspace setup required/i)).toBeInTheDocument();
    // No token is minted and nothing is mounted, so the calls that come back
    // AccessDeniedException are never fired.
    expect(api.selectContext).not.toHaveBeenCalled();
  });

  it('offers no way to continue setup while there is no setup to continue', async () => {
    vi.mocked(api.findSignup).mockResolvedValue(activeSignup);

    render(<SignupPage />);
    await pickWorkspace();
    await screen.findByText(/workspace setup required/i);

    expect(screen.queryByRole('button', { name: /continue setup/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('does not say setup is running when nothing is running', async () => {
    vi.mocked(api.findSignup).mockResolvedValue(activeSignup);

    render(<SignupPage />);
    await pickWorkspace();
    await screen.findByText(/workspace setup required/i);

    expect(screen.queryByText(/still being set up/i)).not.toBeInTheDocument();
    expect(screen.getByText(/has not been installed yet/i)).toBeInTheDocument();
  });

  it('lets a tenant this path did not create through untouched', async () => {
    // Somebody else's provisioning: we know nothing about it, so we do not gate it.
    vi.mocked(api.findSignup).mockResolvedValue(null);
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
});

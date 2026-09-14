import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SignupPage from './SignupPage';

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
      methods: [{ id: 'password', label: 'Password', type: 'password' }],
    });

    render(<SignupPage />);

    expect(await screen.findByRole('button', { name: /continue with password/i })).toBeInTheDocument();
    // Nothing is hardcoded, so a provider that is off simply does not appear.
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  });

  it('hands sign-in to the backend rather than collecting a credential', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'password', label: 'Password', type: 'password' }],
    });

    render(<SignupPage />);
    fireEvent.click(await screen.findByRole('button', { name: /continue with password/i }));

    expect(api.startSignIn).toHaveBeenCalledWith('password');
    // The whole point: no password field ever exists in this flow.
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });
});

describe('wizard', () => {
  beforeEach(() => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
  });

  it('derives the code and slug from the account name', async () => {
    render(<SignupPage />);

    const name = await screen.findByLabelText(/account name/i);
    fireEvent.change(name, { target: { value: 'Bomet County Government' } });

    await waitFor(() => {
      expect(screen.getByLabelText(/account code/i)).toHaveValue('BCG');
      expect(screen.getByLabelText(/account url/i)).toHaveValue('bomet-county-government');
    });
  });

  it('stops deriving once the operator edits the code themselves', async () => {
    render(<SignupPage />);

    fireEvent.change(await screen.findByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    const code = screen.getByLabelText(/account code/i);
    fireEvent.change(code, { target: { value: 'KE-CUSTOM' } });
    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Something Else Entirely' } });

    await waitFor(() => expect(code).toHaveValue('KE-CUSTOM'));
  });

  it('explains an invalid slug instead of silently refusing to continue', async () => {
    render(<SignupPage />);

    fireEvent.change(await screen.findByLabelText(/account name/i), { target: { value: 'Bomet' } });
    fireEvent.change(screen.getByLabelText(/account url/i), { target: { value: '12-34' } });

    // The server needs at least two letters; say so rather than just disabling.
    expect(await screen.findByText(/at least two letters/i)).toBeInTheDocument();
  });

  it('blocks Continue while an identifier is taken', async () => {
    vi.mocked(api.checkIdentifier).mockResolvedValue({ type: 'URL_SLUG', value: 'x', available: false });
    render(<SignupPage />);

    fireEvent.change(await screen.findByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled()
    );
  });

  it('creates the draft on the server when the first step is completed', async () => {
    vi.mocked(api.createSignup).mockResolvedValue({ id: 'signup-1' } as never);
    render(<SignupPage />);

    fireEvent.change(await screen.findByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(api.createSignup).toHaveBeenCalledTimes(1));
    const [draft, key] = vi.mocked(api.createSignup).mock.calls[0];
    expect(draft.accountName).toBe('Bomet County Government');
    // Required by the contract, and reused if the same action is retried.
    expect(key).toBeTruthy();
  });

  it('leaves fields the operator has not reached out of the payload', async () => {
    // The validator rejects a blank value but accepts an absent field, so
    // sending "" for a later step's field fails the create outright.
    vi.mocked(api.createSignup).mockResolvedValue({ id: 'signup-1' } as never);
    render(<SignupPage />);

    fireEvent.change(await screen.findByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => expect(api.createSignup).toHaveBeenCalledTimes(1));
    const [draft] = vi.mocked(api.createSignup).mock.calls[0];
    expect(draft.countryCode).toBe('KE');
    expect('financialYearPolicy' in draft).toBe(false);
    expect('acceptedTermsVersion' in draft).toBe(false);
    expect('tenantMetadata' in draft).toBe(false);
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
      financialYearPolicy: 'JULY_JUNE',
      tenantMetadata: { schemaVersion: 1, founder: { mobileNumber: '+254700000199' } },
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

    render(<SignupPage />);

    // Only a DRAFT is editable, and `_create` hands the same failed record
    // back, so the wizard would be a trap.
    expect(await screen.findByText(/this signup is closed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/account name/i)).not.toBeInTheDocument();
    expect(screen.getByText('654c74d6')).toBeInTheDocument();
  });
});

describe('expired session', () => {
  it('returns to sign-in rather than leaving a button that can only fail', async () => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({ tenants: [], selectionRequired: false, onboardingRequired: true });
    vi.mocked(api.authMethods).mockResolvedValue({
      methods: [{ id: 'password', label: 'Password', type: 'password' }],
    });
    vi.mocked(api.createSignup).mockRejectedValue(
      new api.OnboardingError(401, 'ONBOARDING_IDENTITY_REQUIRED', 'A valid identity session is required')
    );

    render(<SignupPage />);
    fireEvent.change(await screen.findByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    fireEvent.change(screen.getByLabelText(/base country/i), { target: { value: 'KE' } });
    await waitFor(() => expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText(/sign-in expired/i)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /continue with password/i })).toBeInTheDocument();
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
      financialYearPolicy: 'JULY_JUNE',
      tenantMetadata: { schemaVersion: 1, founder: { mobileNumber: '+254700000199' } },
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

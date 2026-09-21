import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from './LoginPage';

vi.mock('@/api/onboarding', async () => {
  const actual = await vi.importActual<typeof import('@/api/onboarding')>('@/api/onboarding');
  return {
    ...actual,
    authMethods: vi.fn(),
    consumeAuthResult: vi.fn(),
    logout: vi.fn(),
    requestPasswordSetup: vi.fn(),
    selectContext: vi.fn(),
    session: vi.fn(),
    startSignIn: vi.fn(),
    tenants: vi.fn(),
  };
});

vi.mock('@/lib/session', () => ({
  SESSION_EXPIRED_KEY: 'crs-session-expired',
  clearLocalSession: vi.fn(),
  installDigitContext: vi.fn(),
}));

import * as api from '@/api/onboarding';
import * as localSession from '@/lib/session';

const signedIn = {
  authenticated: true,
  user: { id: 'user-1', email: 'person@example.com', name: 'Demo Person', preferredUsername: 'person' },
};

function renderPage(path = '/login') {
  return render(<MemoryRouter initialEntries={[path]}><LoginPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(api.session).mockResolvedValue({ authenticated: false });
  vi.mocked(api.authMethods).mockResolvedValue({
    methods: [
      { id: 'password', label: 'Email and password', type: 'password' },
      { id: 'google', label: 'Continue with Google', type: 'oauth' },
      { id: 'github', label: 'Continue with GitHub', type: 'oauth' },
    ],
  });
  vi.mocked(api.logout).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('configurator sign in', () => {
  it('renders the backend-provided sign-in methods and delegates credentials to Keycloak', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: /email and password/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
    const github = screen.getByRole('button', { name: /continue with github/i });
    expect(api.authMethods).toHaveBeenCalledWith('signin');
    expect(document.querySelector('input[type="password"]')).toBeNull();

    fireEvent.click(github);
    expect(api.startSignIn).toHaveBeenCalledWith('github', 'signin');
  });

  it('offers a non-enumerating password setup request', async () => {
    vi.mocked(api.requestPasswordSetup).mockResolvedValue({
      message: 'If an eligible account exists, a password setup email has been sent.',
    });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /set up or reset your password/i }));
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'oauth.only@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send password setup link/i }));

    await waitFor(() => expect(api.requestPasswordSetup).toHaveBeenCalledWith('oauth.only@example.com'));
    expect(await screen.findByText(/if an eligible account exists/i)).toBeInTheDocument();
    expect(screen.getByText('Check your email')).toBeInTheDocument();
  });

  it('shows a broker conflict on the login page with an account-recovery action', async () => {
    vi.mocked(api.consumeAuthResult).mockResolvedValue({
      status: 'failed',
      code: 'ACCOUNT_LINK_REQUIRED',
      message: 'An account already uses this email. Verify the existing account to link this sign-in method.',
      actions: ['TRY_EXISTING_METHOD', 'SETUP_PASSWORD'],
    });
    renderPage('/login?authResult=result-1');

    expect(await screen.findByText(/account already uses this email/i)).toBeInTheDocument();
    expect(api.consumeAuthResult).toHaveBeenCalledWith('result-1');
    expect(screen.getByRole('button', { name: /send password setup link/i })).toBeInTheDocument();
  });

  it('selects a tenant only after identity sign-in and installs the shared DIGIT context', async () => {
    vi.mocked(api.session).mockResolvedValue(signedIn);
    vi.mocked(api.tenants).mockResolvedValue({
      tenants: [{
        tenantId: 'ke.bomet',
        name: 'Bomet County',
        organizationAlias: 'bomet',
        roles: ['EMPLOYEE'],
      }],
      selectionRequired: false,
      onboardingRequired: false,
    });
    const context = {
      access_token: 'digit-token',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'read',
      UserRequest: {
        id: 1,
        uuid: 'digit-user-1',
        userName: 'person',
        name: 'Demo Person',
        tenantId: 'ke.bomet',
        roles: [{ code: 'EMPLOYEE', name: 'Employee', tenantId: 'ke.bomet' }],
      },
    };
    vi.mocked(api.selectContext).mockResolvedValue(context);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /bomet county/i }));

    await waitFor(() => expect(api.selectContext).toHaveBeenCalledWith('ke.bomet'));
    expect(localSession.installDigitContext).toHaveBeenCalledWith(context, signedIn.user);
  });
});

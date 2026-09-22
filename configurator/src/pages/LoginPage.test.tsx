import { StrictMode } from 'react';
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

function renderPage(path = '/login', strict = false) {
  const page = <MemoryRouter initialEntries={[path]}><LoginPage /></MemoryRouter>;
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
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
  it('opens one hosted Keycloak login instead of duplicating its methods', async () => {
    renderPage();

    const login = await screen.findByRole('button', { name: /^log in$/i });
    expect(api.authMethods).toHaveBeenCalledWith('signin');
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /continue with github/i })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();

    fireEvent.click(login);
    expect(api.startSignIn).toHaveBeenCalledWith('password', 'signin');
  });

  it('opens password help when Keycloak returns to its registered login page', async () => {
    renderPage('/login?passwordHelp=1');

    expect(await screen.findByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send password setup link/i })).toBeInTheDocument();
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

  it('consumes a recovery result once under StrictMode and shows its action', async () => {
    vi.mocked(api.requestPasswordSetup).mockResolvedValue({
      message: 'If an eligible account exists, a password setup email has been sent.',
    });
    vi.mocked(api.consumeAuthResult).mockResolvedValue({
      status: 'failed',
      code: 'PASSWORD_SETUP_FAILED',
      message: 'Password setup was not completed. Request another link when you are ready.',
      actions: ['TRY_EXISTING_METHOD', 'SETUP_PASSWORD'],
    });
    renderPage('/login?authResult=result-1', true);

    expect(await screen.findByText(/password setup was not completed/i)).toBeInTheDocument();
    expect(api.consumeAuthResult).toHaveBeenCalledTimes(1);
    expect(api.consumeAuthResult).toHaveBeenCalledWith('result-1');
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'oauth.only@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send password setup link/i }));

    await waitFor(() => expect(api.requestPasswordSetup).toHaveBeenCalledWith('oauth.only@example.com'));
    expect(await screen.findByText(/if an eligible account exists/i)).toBeInTheDocument();
    expect(screen.queryByText(/password setup was not completed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send password setup link/i })).not.toBeInTheDocument();
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

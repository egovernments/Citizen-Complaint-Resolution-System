import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RootLanding from './RootLanding';

vi.mock('@/api/onboarding', async () => {
  const actual = await vi.importActual<typeof import('@/api/onboarding')>('@/api/onboarding');
  return { ...actual, session: vi.fn() };
});

import * as api from '@/api/onboarding';

/** Renders the dispatcher with stand-ins for the two places it can send you. */
const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<RootLanding />} />
        <Route path="/signup" element={<div>SIGNUP</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>,
  );

afterEach(() => vi.clearAllMocks());

describe('root landing after an identity sign-in', () => {
  it('sends a live identity session to the signup wizard, not the operator login', async () => {
    vi.mocked(api.session).mockResolvedValue({
      authenticated: true,
      user: { id: 'u', email: 'f@x.test', name: 'F', preferredUsername: 'f' },
    });
    renderAt();
    await waitFor(() => expect(screen.getByText('SIGNUP')).toBeInTheDocument());
  });

  it('sends a visitor with no identity session to the operator login', async () => {
    vi.mocked(api.session).mockResolvedValue({ authenticated: false });
    renderAt();
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument());
  });

  it('falls back to the operator login when the identity BFF is absent or unreachable', async () => {
    // A deployment without the BFF answers 404; `session` only swallows 401.
    vi.mocked(api.session).mockRejectedValue(new api.OnboardingError(404, null, 'Not Found'));
    renderAt();
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument());
  });
});

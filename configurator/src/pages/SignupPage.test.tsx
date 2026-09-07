import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import SignupPage from './SignupPage';

const renderPage = () => render(<SignupPage />, { wrapper: MemoryRouter });

/** Walk the Account step up to the verified sub-state. */
const completeAccountStep = async () => {
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Proto' } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Tester' } });
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'proto@example.com' } });
  fireEvent.click(screen.getByLabelText(/agree to the terms/i));
  fireEvent.click(screen.getByRole('button', { name: /continue with email/i }));

  fireEvent.click(await screen.findByRole('button', { name: /simulate email verification/i }));
  await screen.findByText('Verified');
};

describe('SignupPage', () => {
  it('says plainly that nothing is created while the backend is mocked', () => {
    renderPage();
    expect(screen.getByText('Preview mode')).toBeInTheDocument();
  });

  it('never asks for a password (identity is a magic link)', () => {
    renderPage();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('will not send a link until the details and consent are given', () => {
    renderPage();
    const submit = screen.getByRole('button', { name: /continue with email/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Proto' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Tester' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'proto@example.com' } });
    // Consent still missing.
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/agree to the terms/i));
    expect(submit).toBeEnabled();
  });

  it('derives the account code from the name and checks it', async () => {
    renderPage();
    await completeAccountStep();

    fireEvent.change(screen.getByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });

    const code = screen.getByLabelText(/account code/i) as HTMLInputElement;
    await waitFor(() => expect(code.value).toBe('BCG'));
    expect(await screen.findByText('Available.', {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('blocks Continue while the chosen code is taken', async () => {
    renderPage();
    await completeAccountStep();

    fireEvent.change(screen.getByLabelText(/account name/i), { target: { value: 'Placeholder' } });
    fireEvent.change(screen.getByLabelText(/account code/i), { target: { value: 'KE-NRB' } });

    expect(await screen.findByText(/already in use/i, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeDisabled();
  });

  it('lets a different email be used after the link is sent', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Proto' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Tester' } });
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'proto@example.com' } });
    fireEvent.click(screen.getByLabelText(/agree to the terms/i));
    fireEvent.click(screen.getByRole('button', { name: /continue with email/i }));

    fireEvent.click(await screen.findByRole('button', { name: /use a different email/i }));
    expect(screen.getByRole('button', { name: /continue with email/i })).toBeInTheDocument();
  });

  it('prefixes the code with the country and suggests its timezone', async () => {
    renderPage();
    await completeAccountStep();
    fireEvent.change(screen.getByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    await screen.findByText('Available.', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    fireEvent.change(await screen.findByLabelText(/base country/i), { target: { value: 'KE' } });

    // Timezone is suggested, not left for the operator to hunt for.
    await waitFor(() =>
      expect((screen.getByLabelText(/^timezone$/i) as HTMLSelectElement).value).toBe('Africa/Nairobi'),
    );

    // And the code picked up the country prefix, as in the prototype.
    fireEvent.change(screen.getByLabelText(/account url/i), { target: { value: 'bomet-county-government' } });
    await screen.findByText('Available.', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText('KE-BCG')).toBeInTheDocument();
  });

  it('tells the operator provisioning is asynchronous', async () => {
    renderPage();
    await completeAccountStep();
    fireEvent.change(screen.getByLabelText(/account name/i), {
      target: { value: 'Bomet County Government' },
    });
    await screen.findByText('Available.', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    fireEvent.change(await screen.findByLabelText(/base country/i), { target: { value: 'KE' } });
    await screen.findByText('Available.', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    fireEvent.click(await screen.findByRole('button', { name: /create account/i }));

    expect(await screen.findByText('Account requested', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText(/10 to 15 minutes/i)).toBeInTheDocument();
  });
});

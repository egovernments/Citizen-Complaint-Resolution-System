import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HelpModal from './HelpModal';
import { ONBOARDING_GUIDE } from '@/onboarding/docs/docsLinks';

describe('Help & Shortcuts', () => {
  it('walks through the five onboarding steps in order (#2574)', () => {
    render(<HelpModal onClose={vi.fn()} />);
    const steps = within(screen.getByRole('list')).getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toEqual([
      expect.stringMatching(/^1\. Branding: Set up your account logo, name and appearance/),
      expect.stringMatching(/^2\. Geography: Define the geographic areas your account covers/),
      expect.stringMatching(/^3\. Departments: The departments complaints get routed to/),
      expect.stringMatching(/^4\. Employees: Add the staff who will actually resolve complaints/),
      expect.stringMatching(/^5\. Complaints Template: Choose the template that defines what citizens can report/),
    ]);
    expect(screen.queryByText(/Phase \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.xlsx/)).not.toBeInTheDocument();
  });

  it('links the documentation to the onboarding guide, and offers no dead link', () => {
    render(<HelpModal onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'View Documentation' })).toHaveAttribute('href', ONBOARDING_GUIDE);
    expect(screen.queryByRole('link', { name: 'Contact Support' })).not.toBeInTheDocument();
  });
});

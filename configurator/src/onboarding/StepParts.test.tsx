import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MapPin } from 'lucide-react';
import { OptionCard } from './StepParts';

describe('OptionCard', () => {
  it('shows why an option is unavailable instead of its action', () => {
    render(
      <OptionCard icon={MapPin} title="Fetch boundaries" action="Search boundaries" disabledReason="Not set up here.">
        Pull boundaries.
      </OptionCard>,
    );
    expect(screen.getByTestId('option-unavailable')).toHaveTextContent('Not set up here.');
    expect(screen.queryByRole('button', { name: /Search boundaries/ })).toBeNull();
  });

  it('offers the action otherwise', () => {
    render(
      <OptionCard icon={MapPin} title="Fetch boundaries" action="Search boundaries">
        Pull boundaries.
      </OptionCard>,
    );
    expect(screen.getByRole('button', { name: /Search boundaries/ })).toBeInTheDocument();
  });
});

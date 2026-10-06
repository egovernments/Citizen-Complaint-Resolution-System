import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import sets from '@/utils/__fixtures__/officialSets.json';
import type { OfficialSet } from '@/utils/officialBoundaries';
import { PreconfiguredCard } from './PreconfiguredCard';

const MZ = (sets as unknown as Record<string, OfficialSet>).MZ;

describe('PreconfiguredCard', () => {
  it('shows the detected boundaries, a read-only country and the confidence', () => {
    const onUse = vi.fn();
    render(<PreconfiguredCard state={{ status: 'ready', country: { country: 'MZ', from: 'tenant' }, set: MZ }} onUse={onUse} />);
    expect(screen.getByText('Boundaries detected')).toBeTruthy();
    expect(screen.getByTestId('preconfigured-country').textContent).toBe('Mozambique');
    expect(screen.getByText('Province → District → Administrative Post → Locality')).toBeTruthy();
    expect(screen.getByTestId('confidence-tag').textContent).toBe('Medium');
    expect(screen.getByText('Source: OCHA COD-AB · Jan 2025')).toBeTruthy();
    // The country is the tenant's: nothing on the card can change it.
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /use these boundaries/i }));
    expect(onUse).toHaveBeenCalledOnce();
  });

  it('explains the confidence, and this set\'s, from the (i)', () => {
    render(<PreconfiguredCard state={{ status: 'ready', country: { country: 'MZ', from: 'tenant' }, set: MZ }} onUse={vi.fn()} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'What confidence means' }));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('independently drawn boundary set');
    expect(tip.textContent).toContain('Some levels only partly match a second source');
    expect(tip.textContent).toContain('Provinces confirmed.');
    expect(tip.textContent).toContain('Upload from Excel');
  });

  it('says why it is unavailable instead of offering a country picker', () => {
    const { rerender } = render(<PreconfiguredCard state={{ status: 'unknown-country' }} onUse={vi.fn()} />);
    expect(screen.getByTestId('option-unavailable').textContent).toContain('no country recorded from signup');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<PreconfiguredCard state={{ status: 'none', country: { country: 'TZ', from: 'tenant' } }} onUse={vi.fn()} />);
    expect(screen.getByTestId('option-unavailable').textContent).toContain('Tanzania');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import sets from '@/utils/__fixtures__/officialSets.json';
import type { OfficialSet } from '@/utils/officialBoundaries';
import { PreconfiguredCard } from './PreconfiguredCard';

const MZ = (sets as unknown as Record<string, OfficialSet>).MZ;

describe('PreconfiguredCard', () => {
  it('shows the detected boundaries, a read-only country and the confidence', () => {
    const onUse = vi.fn();
    render(<PreconfiguredCard state={{ status: 'ready', country: 'MZ', set: MZ }} onUse={onUse} onRetry={vi.fn()} />);
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
    render(<PreconfiguredCard state={{ status: 'ready', country: 'MZ', set: MZ }} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.queryByRole('tooltip')).toBeNull();
    const info = screen.getByRole('button', { name: 'What confidence means' });
    fireEvent.click(info);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('independently drawn boundary set');
    expect(tip.textContent).toContain('Some levels only partly match a second source');
    expect(tip.textContent).toContain('Provinces confirmed.');
    expect(tip.textContent).toContain('Upload from Excel');
  });

  it('stays open through a tap (mouseenter, focus, click) and closes on Escape or leaving', () => {
    render(<PreconfiguredCard state={{ status: 'ready', country: 'MZ', set: MZ }} onUse={vi.fn()} onRetry={vi.fn()} />);
    const info = screen.getByRole('button', { name: 'What confidence means' });
    fireEvent.mouseEnter(info);
    fireEvent.focus(info);
    fireEvent.click(info);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(info, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(info);
    fireEvent.blur(info);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not name the internal boundary service when it is missing', () => {
    render(<PreconfiguredCard state={{ status: 'unavailable' }} onUse={vi.fn()} onRetry={vi.fn()} />);
    const text = screen.getByTestId('option-unavailable').textContent ?? '';
    expect(text).toBe("Preconfigured boundaries aren't available on this deployment. Fetch or upload them instead.");
  });

  it('says why it is unavailable instead of offering a country picker', () => {
    const { rerender } = render(<PreconfiguredCard state={{ status: 'unknown-country' }} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByTestId('option-unavailable').textContent).toContain('This workspace has no country recorded from signup');
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<PreconfiguredCard state={{ status: 'none', country: 'TZ' }} onUse={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByTestId('option-unavailable').textContent).toContain('Tanzania');
  });

  it('offers a retry when a listed country\'s set could not be loaded', () => {
    const onRetry = vi.fn();
    render(<PreconfiguredCard state={{ status: 'error', country: 'KE' }} onUse={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByTestId('preconfigured-error').textContent).toContain('official boundaries for Kenya');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

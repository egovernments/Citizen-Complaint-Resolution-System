import { describe, it, expect } from 'vitest';
import { menuPathCode } from './menuPathCode';

describe('menuPathCode', () => {
  it('returns the last dotted segment verbatim (drops the onboarding prefix)', () => {
    expect(menuPathCode('complaints.categories.GarbageNotCollected')).toBe(
      'GarbageNotCollected',
    );
  });

  it('returns a flat menuPath unchanged', () => {
    expect(menuPathCode('SANITATION')).toBe('SANITATION');
  });

  it('takes the final segment of a deeper path', () => {
    expect(menuPathCode('complaints.categories.Roads.PotHole')).toBe('PotHole');
  });

  it('returns an empty string for empty input', () => {
    expect(menuPathCode('')).toBe('');
  });
});

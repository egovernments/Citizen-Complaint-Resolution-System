import { describe, it, expect } from 'vitest';
import { humanizeMenuPath } from './humanizeMenuPath';

describe('humanizeMenuPath', () => {
  it('drops the dotted prefix and splits PascalCase', () => {
    expect(humanizeMenuPath('complaints.categories.GarbageNotCollected')).toBe(
      'Garbage Not Collected',
    );
  });

  it('title-cases ALL-CAPS codes', () => {
    expect(humanizeMenuPath('SANITATION')).toBe('Sanitation');
  });

  it('splits snake_case and kebab-case', () => {
    expect(humanizeMenuPath('WATER_SUPPLY')).toBe('Water Supply');
    expect(humanizeMenuPath('complaints.categories.water-leakage')).toBe('Water Leakage');
  });

  it('leaves a simple word intact (title-cased)', () => {
    expect(humanizeMenuPath('Roads')).toBe('Roads');
  });

  it('returns an empty string for empty input', () => {
    expect(humanizeMenuPath('')).toBe('');
  });
});

import { describe, it, expect } from 'vitest';
import { parentChoices } from './parentChoices';

// ours#861 A3: a sub-type's parent is picked from the existing categories, never typed.
describe('parentChoices', () => {
  const rows = [
    { code: 'WATER', name: 'Water' },
    { code: 'ROADS', name: 'ROADS' },
    { code: 'complaints.categories.NoStreetlight', name: 'No Streetlight' },
    { code: 'WaterLeak', name: 'Leak', parentCode: 'WATER', department: 'DEPT_1', slaHours: 24 },
    { code: 'Pothole', parentCode: 'ROADS', slaHours: 48 },
    { code: 'OLD', name: 'Old', active: false },
  ];

  it('offers the active interior nodes only, labelled and sorted', () => {
    expect(parentChoices(rows)).toEqual([
      { value: 'complaints.categories.NoStreetlight', label: 'No Streetlight (complaints.categories.NoStreetlight)' },
      { value: 'ROADS', label: 'ROADS' },
      { value: 'WATER', label: 'Water (WATER)' },
    ]);
  });

  it('keeps an existing parent that is not a known category, marked, instead of blanking it', () => {
    expect(parentChoices(rows, 'TYPO')[0]).toEqual({ value: 'TYPO', label: 'TYPO (not a category)' });
    expect(parentChoices(rows, 'WATER').filter((c) => c.value === 'WATER')).toHaveLength(1);
  });

  it('is empty (not an error) before the nodes load', () => {
    expect(parentChoices(undefined)).toEqual([]);
  });
});

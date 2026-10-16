import { describe, it, expect } from 'vitest';
import { toGenderChoices } from './useGenderChoices';

describe('gender choices from the GenderType master (egovernments/CCRS#2397)', () => {
  it('offers exactly the genders the master returns', () => {
    expect(toGenderChoices([{ id: 'MALE', code: 'MALE' }, { id: 'FEMALE', code: 'FEMALE' }])).toEqual([
      { value: 'MALE', label: 'Male' },
      { value: 'FEMALE', label: 'Female' },
    ]);
  });

  it('labels multi-word codes and falls back to the record id', () => {
    expect(toGenderChoices([{ id: 'NOT_STATED' }])).toEqual([{ value: 'NOT_STATED', label: 'Not stated' }]);
  });

  it('offers nothing while the master is loading or empty', () => {
    expect(toGenderChoices(undefined)).toEqual([]);
    expect(toGenderChoices([])).toEqual([]);
  });
});

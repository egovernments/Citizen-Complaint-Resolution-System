import { describe, it, expect } from 'vitest';
import { GENDER_CHOICES } from './genderChoices';

describe('gender choices (egovernments/CCRS#2397)', () => {
  it('offers only Male and Female', () => {
    expect(GENDER_CHOICES).toEqual([
      { value: 'MALE', label: 'Male' },
      { value: 'FEMALE', label: 'Female' },
    ]);
  });
});

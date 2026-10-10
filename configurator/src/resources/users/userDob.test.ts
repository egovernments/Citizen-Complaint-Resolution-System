import { describe, expect, it } from 'vitest';
import { dobToInput, inputToDob } from './userDob';

describe('userDob', () => {
  it('reads every dob shape the user search returns', () => {
    expect(dobToInput('31/01/1990')).toBe('1990-01-31');
    expect(dobToInput('1/2/1990')).toBe('1990-02-01');
    expect(dobToInput('1990-01-31')).toBe('1990-01-31');
    expect(dobToInput(Date.UTC(1990, 0, 31))).toBe('1990-01-31');
    expect(dobToInput(String(Date.UTC(1990, 0, 31)))).toBe('1990-01-31');
    expect(dobToInput(null)).toBe('');
    expect(dobToInput('soon')).toBe('');
  });

  it("writes egov-user's dd/MM/yyyy, null when cleared", () => {
    expect(inputToDob('1990-01-31')).toBe('31/01/1990');
    expect(inputToDob('')).toBeNull();
  });
});

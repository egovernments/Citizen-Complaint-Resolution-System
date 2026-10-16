import { describe, it, expect } from 'vitest';
import { slaDaysFormat, slaDaysParse, slaDaysText } from './slaDays';

// cfgreview F18 (#1564): the SLA is entered and shown in days; MDMS keeps hours.
describe('SLA in days', () => {
  it('shows hours as days and stores days as whole hours', () => {
    expect(slaDaysFormat(336)).toBe(14);
    expect(slaDaysFormat(36)).toBe(1.5);
    expect(slaDaysFormat(undefined)).toBe('');
    expect(slaDaysParse('14')).toBe(336);
    expect(slaDaysParse(1.5)).toBe(36);
    expect(slaDaysParse('')).toBeNull();
  });
  it('reads as words in the list and the record page', () => {
    expect(slaDaysText(336)).toBe('14 days');
    expect(slaDaysText(24)).toBe('1 day');
    expect(slaDaysText(null)).toBe('--');
  });
});

import { describe, expect, it } from 'vitest';
import { chosenHours, formatHours, initialChoice } from './resolution';
import type { DraftType } from './complaintsApi';

const type = (over: Partial<DraftType> = {}): DraftType => ({ name: 'Water', department: 'WATER', subtypes: [], ...over });

describe('formatHours', () => {
  it('says weeks, days or hours', () => {
    expect([24, 72, 168, 336, 120, 36, 1].map(formatHours)).toEqual(['1 day', '3 days', '1 week', '2 weeks', '5 days', '36 hours', '1 hour']);
  });
});

describe('initialChoice', () => {
  it('opens on the default, a quick pick, a custom number, or each subcategory’s own', () => {
    expect(initialChoice(undefined)).toEqual({ choice: 'default', custom: '' });
    expect(initialChoice(type())).toEqual({ choice: 'default', custom: '' });
    expect(initialChoice(type({ slaHours: 168 }))).toEqual({ choice: '168', custom: '' });
    expect(initialChoice(type({ slaHours: 36 }))).toEqual({ choice: 'custom', custom: '36' });
    expect(initialChoice(type({ slaHours: 24, subtypes: [{ name: 'Leak', slaHours: 4 }] }))).toEqual({ choice: 'mixed', custom: '' });
  });
});

describe('chosenHours', () => {
  const mixed = type({ slaHours: 24, subtypes: [{ name: 'Leak', slaHours: 4 }] });

  it('keeps the subcategories’ own times only when asked to', () => {
    expect(chosenHours('mixed', '', mixed)).toEqual({ slaHours: 24, keepOwn: true });
    expect(chosenHours('168', '', mixed)).toEqual({ slaHours: 168, keepOwn: false });
    expect(chosenHours('default', '', mixed)).toEqual({ slaHours: undefined, keepOwn: false });
  });

  it('takes a custom whole number of hours and refuses anything else', () => {
    expect(chosenHours('custom', ' 36 ', undefined)).toEqual({ slaHours: 36, keepOwn: false });
    for (const bad of ['', '0', '-2', '1.5', 'abc']) expect(chosenHours('custom', bad, undefined)).toHaveProperty('error');
  });
});

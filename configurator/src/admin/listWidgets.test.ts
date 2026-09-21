import { describe, it, expect } from 'vitest';
import { badgeValues, namedBadgeValues, tokenSummary, TOKEN_PREVIEW_LIMIT } from './listWidgets';

// The row that made the Events list ~857px tall: the generic list did not treat
// a `["array","null"]` property as complex, so it printed this as JSON.
const PLACEHOLDERS = [
  { name: 'id', label: 'Complaint number' },
  { name: 'complaint_type', label: 'Complaint type' },
  { name: 'date', label: 'Date' },
  { name: 'citizen_name', label: 'Citizen' },
  { name: 'emp_name', label: 'Employee', blankWhen: 'unassigned' },
];

describe('badgeValues', () => {
  it('keeps a string array as-is', () => {
    expect(badgeValues(['SMS', 'EMAIL'])).toEqual(['SMS', 'EMAIL']);
  });

  it('is empty for the shapes an unvalidated MDMS row can actually hold', () => {
    expect(badgeValues(null)).toEqual([]);
    expect(badgeValues(undefined)).toEqual([]);
    expect(badgeValues('SMS')).toEqual([]);
    expect(badgeValues([])).toEqual([]);
    expect(badgeValues(['', '  '])).toEqual([]);
    expect(badgeValues([{ nested: 1 }])).toEqual([]);
  });
});

describe('namedBadgeValues', () => {
  it('projects [{name}] onto the names', () => {
    expect(namedBadgeValues([{ name: 'citizen', required: true }, { name: 'assignee' }]))
      .toEqual(['citizen', 'assignee']);
  });

  it('drops entries with no name rather than printing undefined', () => {
    expect(namedBadgeValues([{ label: 'no name' }, { name: '' }, { name: 'ok' }])).toEqual(['ok']);
  });
});

describe('tokenSummary', () => {
  it('counts the vocabulary and previews the first few, brace-wrapped', () => {
    const s = tokenSummary(PLACEHOLDERS);
    expect(s.count).toBe(5);
    expect(s.preview).toEqual(['{id}', '{complaint_type}', '{date}']);
    expect(s.preview).toHaveLength(TOKEN_PREVIEW_LIMIT);
    expect(s.truncated).toBe(true);
  });

  it('keeps the WHOLE list available for the cell tooltip', () => {
    // The compact cell is only acceptable because nothing is lost: the full
    // vocabulary is one hover (and one click into Show) away.
    expect(tokenSummary(PLACEHOLDERS).full)
      .toBe('{id} {complaint_type} {date} {citizen_name} {emp_name}');
  });

  it('does not claim truncation when everything fits', () => {
    const s = tokenSummary([{ name: 'id' }, { name: 'date' }]);
    expect(s.preview).toEqual(['{id}', '{date}']);
    expect(s.truncated).toBe(false);
  });

  it('is an empty summary for a row with no placeholders at all', () => {
    for (const value of [null, undefined, [], 'nonsense']) {
      const s = tokenSummary(value);
      expect(s.count).toBe(0);
      expect(s.preview).toEqual([]);
      expect(s.truncated).toBe(false);
      expect(s.full).toBe('');
    }
  });
});

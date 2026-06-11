import { describe, it, expect } from 'vitest';
import {
  LEVEL_SLA_RANGE_ERROR,
  LEVEL_SLA_REQUIRED_ERROR,
  formatLevelSummary,
  isLevelValuesEmpty,
  levelInputsToValues,
  levelLabel,
  levelValuesToInputs,
  normalizeLevelValues,
  parseLevelInput,
  validateLevelInputs,
} from './levelSlaValues';

describe('parseLevelInput (0 < n <= 8760)', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['48', 48],
    ['12.5', 12.5],
    ['8760', 8760], // inclusive upper bound
    ['8761', undefined],
    ['0', undefined],
    ['-1', undefined],
    ['abc', undefined],
    ['Infinity', undefined],
  ])('parseLevelInput(%j) → %j', (raw, expected) => {
    expect(parseLevelInput(raw)).toBe(expected);
  });
});

describe('validateLevelInputs', () => {
  it('allows blanks (holes) in allowHoles mode', () => {
    expect(validateLevelInputs(['', '48'], true)).toEqual([null, null]);
  });

  it('rejects blanks in policy mode', () => {
    expect(validateLevelInputs(['', '48'], false)).toEqual([LEVEL_SLA_REQUIRED_ERROR, null]);
  });

  it('flags out-of-range rows with the spec inline error in both modes', () => {
    expect(validateLevelInputs(['0'], true)).toEqual([LEVEL_SLA_RANGE_ERROR]);
    expect(validateLevelInputs(['9000'], false)).toEqual([LEVEL_SLA_RANGE_ERROR]);
  });
});

describe('input <-> value round-trip', () => {
  it('converts a draft to values with blank → null', () => {
    expect(levelInputsToValues(['', '48', '120'])).toEqual([null, 48, 120]);
  });

  it('seeds inputs from stored values with null → blank', () => {
    expect(levelValuesToInputs([null, 48])).toEqual(['', '48']);
    expect(levelValuesToInputs(undefined)).toEqual([]);
  });
});

describe('normalizeLevelValues', () => {
  it('trims trailing holes', () => {
    expect(normalizeLevelValues([48, null, null])).toEqual([48]);
  });

  it('preserves interior holes', () => {
    expect(normalizeLevelValues([null, 48])).toEqual([null, 48]);
  });

  it('collapses all-hole and empty arrays to undefined (omit the field)', () => {
    expect(normalizeLevelValues([null, null])).toBeUndefined();
    expect(normalizeLevelValues([])).toBeUndefined();
    expect(normalizeLevelValues(undefined)).toBeUndefined();
  });
});

describe('isLevelValuesEmpty (matches the "≥1 entry > 0" chip counting)', () => {
  it.each([
    [undefined, true],
    [[], true],
    [[null], true],
    [[0], true],
    [[null, 48], false],
    [[48], false],
  ])('isLevelValuesEmpty(%j) → %j', (values, expected) => {
    expect(isLevelValuesEmpty(values)).toBe(expected);
  });
});

describe('formatLevelSummary', () => {
  it('renders the compact matrix-cell form with holes as —', () => {
    expect(formatLevelSummary([120, null, 24])).toBe('L0 120 · L1 — · L2 24');
    expect(formatLevelSummary([120, 48, 24])).toBe('L0 120 · L1 48 · L2 24');
  });

  it('renders unset/all-hole arrays as a bare —', () => {
    expect(formatLevelSummary(undefined)).toBe('—');
    expect(formatLevelSummary([null, null])).toBe('—');
  });
});

describe('levelLabel', () => {
  it('marks L0 as the first assignment', () => {
    expect(levelLabel(0)).toBe('L0 (first assignment)');
    expect(levelLabel(2)).toBe('L2');
  });
});

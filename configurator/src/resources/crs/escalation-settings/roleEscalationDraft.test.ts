import { describe, it, expect } from 'vitest';
import {
  MAX_PER_SCAN_ERROR,
  WATCHED_STATES,
  buildActingMap,
  buildLadderMap,
  buildRoleEscalation,
  isUuidFormat,
  parseMaxPerScan,
  seedActingRows,
  seedLadderRows,
  validateActingRows,
  validateLadderRows,
} from './roleEscalationDraft';

describe('seedActingRows', () => {
  it('always yields the two watched states as fixed rows, blank when unmapped', () => {
    expect(seedActingRows(undefined)).toEqual([
      { state: 'PENDINGFORASSIGNMENT', role: '', fixed: true },
      { state: 'PENDINGATLME', role: '', fixed: true },
    ]);
  });

  it('fills watched roles from the map and appends other states as free rows', () => {
    const rows = seedActingRows({
      PENDINGATLME: 'PGR_LME',
      PENDINGATCEO: 'CEO',
      PENDINGFORASSIGNMENT: 'GRO',
    });
    expect(rows).toEqual([
      { state: 'PENDINGFORASSIGNMENT', role: 'GRO', fixed: true },
      { state: 'PENDINGATLME', role: 'PGR_LME', fixed: true },
      { state: 'PENDINGATCEO', role: 'CEO', fixed: false },
    ]);
  });
});

describe('seedLadderRows', () => {
  it('maps entries to rows and handles undefined', () => {
    expect(seedLadderRows(undefined)).toEqual([]);
    expect(seedLadderRows({ GRO: 'PGR_SUPERVISOR' })).toEqual([
      { role: 'GRO', supervisorRole: 'PGR_SUPERVISOR' },
    ]);
  });
});

describe('validateActingRows', () => {
  it('never flags fixed rows, even blank ones', () => {
    expect(validateActingRows(seedActingRows(undefined), true)).toEqual([null, null]);
  });

  it('flags half-filled free rows only after a save attempt', () => {
    const rows = [
      { state: 'PENDINGATCEO', role: '', fixed: false },
      { state: '', role: 'CEO', fixed: false },
    ];
    expect(validateActingRows(rows, false)).toEqual([null, null]);
    expect(validateActingRows(rows, true)).toEqual([
      'enter a role, or remove this row',
      'enter a complaint status',
    ]);
  });

  it('flags a free row duplicating a watched state, live', () => {
    const rows = [
      ...seedActingRows({ PENDINGATLME: 'PGR_LME' }),
      { state: 'PENDINGATLME', role: 'OTHER', fixed: false },
    ];
    const errors = validateActingRows(rows, false);
    expect(errors[0]).toBeNull();
    expect(errors[1]).toBeNull(); // fixed rows never error
    expect(errors[2]).toMatch(/duplicate/);
  });

  it('accepts empty free rows (dropped at build)', () => {
    expect(validateActingRows([{ state: '', role: '', fixed: false }], true)).toEqual([null]);
  });
});

describe('validateLadderRows', () => {
  it('flags half-filled rows after a save attempt and duplicates live', () => {
    const half = [{ role: 'GRO', supervisorRole: '' }];
    expect(validateLadderRows(half, false)).toEqual([null]);
    expect(validateLadderRows(half, true)).toEqual([
      'enter the role it escalates to, or remove this row',
    ]);
    const dups = [
      { role: 'GRO', supervisorRole: 'A' },
      { role: 'GRO', supervisorRole: 'B' },
    ];
    expect(validateLadderRows(dups, false).every((e) => e !== null)).toBe(true);
  });
});

describe('buildActingMap / buildLadderMap', () => {
  it('trims values and drops blank or half-filled rows', () => {
    expect(
      buildActingMap([
        { state: ' PENDINGATLME ', role: ' PGR_LME ', fixed: true },
        { state: 'PENDINGFORASSIGNMENT', role: '', fixed: true },
        { state: '', role: '', fixed: false },
      ]),
    ).toEqual({ PENDINGATLME: 'PGR_LME' });
    expect(
      buildLadderMap([
        { role: ' GRO ', supervisorRole: ' PGR_SUPERVISOR ' },
        { role: 'X', supervisorRole: '' },
      ]),
    ).toEqual({ GRO: 'PGR_SUPERVISOR' });
  });
});

describe('parseMaxPerScan (1–100 integer, blank = unset)', () => {
  it.each([
    ['', {}],
    ['  ', {}],
    ['1', { value: 1 }],
    ['100', { value: 100 }],
    ['0', { error: MAX_PER_SCAN_ERROR }],
    ['101', { error: MAX_PER_SCAN_ERROR }],
    ['5.5', { error: MAX_PER_SCAN_ERROR }],
    ['abc', { error: MAX_PER_SCAN_ERROR }],
  ])('parseMaxPerScan(%j) → %j', (raw, expected) => {
    expect(parseMaxPerScan(raw)).toEqual(expected);
  });
});

describe('buildRoleEscalation (backward-compat omission rule)', () => {
  it('returns undefined for an untouched draft on a tenant without the feature', () => {
    expect(
      buildRoleEscalation({ enabled: false, actingMap: {}, ladderMap: {}, hadExisting: false }),
    ).toBeUndefined();
  });

  it('persists an explicit enabled:false once the record carries the object', () => {
    expect(
      buildRoleEscalation({ enabled: false, actingMap: {}, ladderMap: {}, hadExisting: true }),
    ).toEqual({ enabled: false });
  });

  it('omits empty maps and an unset cap from the built object', () => {
    expect(
      buildRoleEscalation({
        enabled: true,
        actingMap: { PENDINGFORASSIGNMENT: 'GRO' },
        ladderMap: {},
        hadExisting: false,
      }),
    ).toEqual({ enabled: true, actingRoleByState: { PENDINGFORASSIGNMENT: 'GRO' } });
  });

  it('builds the full object when everything is set', () => {
    expect(
      buildRoleEscalation({
        enabled: true,
        actingMap: { PENDINGFORASSIGNMENT: 'GRO', PENDINGATLME: 'PGR_LME' },
        ladderMap: { GRO: 'PGR_SUPERVISOR' },
        maxPerScan: 10,
        hadExisting: true,
      }),
    ).toEqual({
      enabled: true,
      actingRoleByState: { PENDINGFORASSIGNMENT: 'GRO', PENDINGATLME: 'PGR_LME' },
      supervisorRoleByRole: { GRO: 'PGR_SUPERVISOR' },
      maxPerScan: 10,
    });
  });
});

describe('isUuidFormat', () => {
  it.each([
    ['c54bba11-1b9a-4d27-9b86-d8e95c1d4583', true],
    ['C54BBA11-1B9A-4D27-9B86-D8E95C1D4583', true],
    [' c54bba11-1b9a-4d27-9b86-d8e95c1d4583 ', true], // trimmed
    ['c54bba11', false],
    ['not-a-uuid', false],
    ['', false],
  ])('isUuidFormat(%j) → %j', (raw, expected) => {
    expect(isUuidFormat(raw)).toBe(expected);
  });
});

describe('WATCHED_STATES', () => {
  it('matches the two states the escalation scan watches', () => {
    expect(WATCHED_STATES).toEqual(['PENDINGFORASSIGNMENT', 'PENDINGATLME']);
  });
});

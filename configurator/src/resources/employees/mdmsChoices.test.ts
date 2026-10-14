import { describe, it, expect } from 'vitest';
import { choicesFromMdms, employeeStatusShown } from './mdmsChoices';
import { getGenericMdmsResources } from '../../../packages/data-provider/src/providers/resourceRegistry';

const FALLBACK = [{ value: 'MALE', label: 'Male' }];

// ours#850: the Employee form offers exactly the MDMS lists the admin maintains.
describe('choicesFromMdms', () => {
  it('offers the active MDMS codes, labelled by name or the title-cased code', () => {
    expect(choicesFromMdms([
      { code: 'EMPLOYED', active: true },
      { code: 'DAILYWAGES', name: 'Daily wages' },
      { code: 'RETIRED', active: false },
      { code: 'ON_LEAVE', active: true },
    ], FALLBACK)).toEqual([
      { value: 'EMPLOYED', label: 'Employed' },
      { value: 'DAILYWAGES', label: 'Daily wages' },
      { value: 'ON_LEAVE', label: 'On Leave' },
    ]);
  });

  it('falls back to the built-in list when the master is empty, unread or all inactive', () => {
    expect(choicesFromMdms(undefined, FALLBACK)).toBe(FALLBACK);
    expect(choicesFromMdms([], FALLBACK)).toBe(FALLBACK);
    expect(choicesFromMdms([{ code: 'X', active: false }], FALLBACK)).toBe(FALLBACK);
  });

  it('drops duplicate and blank codes', () => {
    expect(choicesFromMdms([{ code: 'A' }, { code: 'A' }, { code: ' ' }, { id: 'B' }], FALLBACK).map((c) => c.value))
      .toEqual(['A', 'B']);
  });

  it('reads the registry resources that already name the three masters', () => {
    const generic = getGenericMdmsResources();
    expect(generic['gender-types']?.schema).toBe('common-masters.GenderType');
    expect(generic['employee-status']?.schema).toBe('egov-hrms.EmployeeStatus');
    expect(generic['employee-type']?.schema).toBe('egov-hrms.EmployeeType');
  });

  it('always offers the values the form acts on, even when the master omits them (nightly 2026-10-14)', () => {
    const fb = [{ value: 'EMPLOYED', label: 'Employed' }, { value: 'INACTIVE', label: 'Inactive' }];
    expect(choicesFromMdms([{ code: 'EMPLOYED' }, { code: 'RETIRED' }], fb, ['INACTIVE']).map((c) => c.value)).toEqual(['EMPLOYED', 'RETIRED', 'INACTIVE']);
    expect(choicesFromMdms([{ code: 'INACTIVE', name: 'Deactivated' }], fb, ['INACTIVE'])).toEqual([{ value: 'INACTIVE', label: 'Deactivated' }]);
  });

  it('a deactivated employee shows Inactive, whatever employeeStatus HRMS kept', () => {
    expect(employeeStatusShown({ isActive: false, employeeStatus: 'EMPLOYED' })).toBe('INACTIVE');
    expect(employeeStatusShown({ isActive: false, employeeStatus: 'RETIRED' })).toBe('RETIRED');
    expect(employeeStatusShown({ isActive: true, employeeStatus: 'EMPLOYED' })).toBe('EMPLOYED');
  });
});

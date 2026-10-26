import { describe, expect, it } from 'vitest';
import { allowedEmployeeRoles, isSystemRecordCode, pickerChoices } from './systemRecords';

describe('system records', () => {
  it('names the founder department, designation and the WORKSPACE hierarchy', () => {
    expect(['ONBOARDING_ADMIN', 'ONBOARDING_FOUNDER', 'WORKSPACE'].every(isSystemRecordCode)).toBe(true);
    expect(isSystemRecordCode('ROADS')).toBe(false);
    expect(isSystemRecordCode(undefined)).toBe(false);
  });

  it('drops them from a picker unless one is already the value', () => {
    const items = [{ code: 'ROADS' }, { code: 'ONBOARDING_ADMIN' }];
    expect(pickerChoices(items, (item) => item.code)).toEqual([{ code: 'ROADS' }]);
    expect(pickerChoices(items, (item) => item.code, ['ONBOARDING_ADMIN'])).toEqual(items);
  });
});

describe('allowedEmployeeRoles', () => {
  it('keeps the complaint roles and EMPLOYEE, in a set order, and drops admin and platform roles', () => {
    const roles = ['SUPERUSER', 'GRO', 'MDMS_ADMIN', 'EMPLOYEE', 'ACCOUNT_ADMIN', 'PGR_LME', 'CITIZEN', 'DGRO'].map((code) => ({ code }));
    expect(allowedEmployeeRoles(roles).map((role) => role.code)).toEqual(['EMPLOYEE', 'GRO', 'DGRO', 'PGR_LME']);
  });
});

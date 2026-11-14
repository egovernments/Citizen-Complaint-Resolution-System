import { describe, expect, it } from 'vitest';
import { ApiClientError } from '@/api/client';
import { OnboardingError } from '@/api/onboarding';
import { MessageError } from '../i18n';
import { describeImportFailure, describeSheetProblem, rowReason } from './bulkResults';

const row = { employeeCode: 'E003', mobileNumber: '711000002' };

describe('describeSheetProblem (#2800)', () => {
  it('names the blank required cell', () => {
    const problem = (field: string) => describeSheetProblem({ row: 4, field, message: 'x', code: 'REQUIRED_FIELD' });
    expect(['name', 'mobileNumber', 'department', 'designation'].map(problem)).toEqual([
      'Name is required',
      'Mobile number is required',
      'Department is required',
      'Designation is required',
    ]);
    expect(rowReason(4, problem('mobileNumber'))).toBe('Row 4: Mobile number is required');
  });

  it('says what a bad date of birth was', () => {
    expect(describeSheetProblem({ row: 5, field: 'dob', value: '14/05/1990', message: 'x', code: 'INVALID_FORMAT' })).toBe(
      'Date of birth “14/05/1990” isn’t valid. Use YYYY-MM-DD for someone at least 18, or leave it blank.',
    );
  });
});

describe('describeImportFailure (#2799)', () => {
  it('puts the mobile pre-check in words, with the number', () => {
    expect(describeImportFailure(new Error('Mobile "711000002" already exists on tenant acme'), row)).toEqual({
      reason: 'Mobile number 711000002 is already used by another employee. Use a different number.',
    });
  });

  it('puts the username pre-check in words: the username is the code', () => {
    expect(describeImportFailure(new Error('Username "E003" already exists on tenant acme'), row).reason).toBe(
      'Employee code E003 is already used by another account. Use a different code.',
    );
  });

  it('puts known HRMS refusals in words and keeps the code for the small print', () => {
    const hrms = (code: string, message: string) => new ApiClientError([{ code, message }], 400);
    expect(describeImportFailure(hrms('ERR_HRMS_USER_EXIST_MOB', 'Mobile number already exists'), row)).toEqual({
      reason: 'Mobile number 711000002 is already used by another employee. Use a different number.',
      code: 'ERR_HRMS_USER_EXIST_MOB',
    });
    expect(describeImportFailure(hrms('ERR_HRMS_EMPLOYEE_EXIST', 'Employee exists'), row).reason).toContain('E003 is already used');
    // Unknown codes keep the server's own message, with the code beside it.
    expect(describeImportFailure(hrms('ERR_SOMETHING', 'Something broke'), row)).toEqual({ reason: 'Something broke', code: 'ERR_SOMETHING' });
  });

  it('says an employee added without an invitation is on the list, and how to finish', () => {
    const unfinished = Object.assign(new MessageError('members.invite_unfinished', 'Employee %{code} exists in HRMS; invitation is unfinished.', { code: 'E003' }), {
      employee: {},
      reason: new OnboardingError(409, 'BINDING_CONFLICT', 'conflict'),
    });
    expect(describeImportFailure(unfinished, row)).toEqual({
      reason:
        'This email already belongs to a different employee in this workspace. They’re on your list now: use Edit or Send invite on their row to finish.',
      code: 'BINDING_CONFLICT',
    });
  });

  it('translates a step error by its key', () => {
    const ended = new MessageError('members.signin_ended', 'Your sign-in has ended, so nobody was added. Sign out, sign in again, and add them again.');
    expect(describeImportFailure(ended, row).reason).toBe('Your sign-in has ended, so nobody was added. Sign out, sign in again, and add them again.');
  });
});

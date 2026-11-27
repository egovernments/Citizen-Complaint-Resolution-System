import { ApiClientError } from '@/api/client';
import { OnboardingError } from '@/api/onboarding';
import type { ValidationError } from '@/api/types';
import { isInviteUnfinished } from '@/identity/memberActions';
import { englishT, MessageError, type OnboardingT } from '../i18n';
import { describeInviteError } from './inviteStatus';

/**
 * The employee bulk upload's results in words: why the parser left a sheet row
 * out (#2800), and why creating a row failed (#2799). Every reason is tied to
 * its row number, so the sheet can be fixed and uploaded again.
 */

/** "Row 4: Mobile number is required". */
export function rowReason(row: number, reason: string, t: OnboardingT = englishT): string {
  return t('bulk_employees.row_reason', 'Row %{row}: %{reason}', { row, reason });
}

/** Why the parser kept a row out of the upload. */
export function describeSheetProblem(problem: ValidationError, t: OnboardingT = englishT): string {
  if (problem.code === 'REQUIRED_FIELD') {
    if (problem.field === 'name') return t('bulk_employees.name_required', 'Name is required');
    if (problem.field === 'mobileNumber') return t('bulk_employees.mobile_required', 'Mobile number is required');
    if (problem.field === 'department') return t('bulk_employees.department_required', 'Department is required');
    if (problem.field === 'designation') return t('bulk_employees.designation_required', 'Designation is required');
  }
  if (problem.field === 'dob') {
    return t('bulk_employees.dob_invalid', 'Date of birth “%{value}” isn’t valid. Use YYYY-MM-DD for someone at least 18, or leave it blank.', {
      value: problem.value ?? '',
    });
  }
  return problem.message;
}

/** A row the import couldn't add: the reason in words, and the server's code, if it sent one, for the small print. */
export interface ImportFailure {
  reason: string;
  code?: string;
}

/**
 * Why creating one row's employee failed. `row` gives the mobile number and code
 * the server's messages refer to.
 */
export function describeImportFailure(
  err: unknown,
  row: { employeeCode: string; mobileNumber: string },
  t: OnboardingT = englishT,
): ImportFailure {
  const mobileTaken = () =>
    t('bulk_employees.mobile_in_use', 'Mobile number %{mobile} is already used by another employee. Use a different number.', {
      mobile: row.mobileNumber,
    });
  const codeTaken = () =>
    t('bulk_employees.code_in_use', 'Employee code %{code} is already used by another account. Use a different code.', {
      code: row.employeeCode,
    });

  // HRMS has them; only the invitation is missing. Said the way adding one by hand says it.
  if (isInviteUnfinished(err)) {
    const code = err.reason instanceof OnboardingError ? err.reason.code ?? undefined : undefined;
    return {
      reason: t('employees.invite_from_row', '%{reason} They’re on your list now: use Edit or Send invite on their row to finish.', {
        reason: describeInviteError(err.reason, t),
      }),
      code,
    };
  }
  if (err instanceof MessageError) return { reason: t(err.key, err.english, err.params).trim() };
  if (err instanceof ApiClientError) {
    const code = err.errors[0]?.code;
    if (code === 'ERR_HRMS_USER_EXIST_MOB') return { reason: mobileTaken(), code };
    if (code === 'ERR_HRMS_USER_EXIST_USERNAME' || code === 'ERR_HRMS_EMPLOYEE_EXIST') return { reason: codeTaken(), code };
    return { reason: err.firstError, code };
  }
  const message = err instanceof Error ? err.message : '';
  // hrmsService.createEmployeeRecord's own checks, before anything is sent.
  if (/^Mobile ".*" already exists on tenant/.test(message)) return { reason: mobileTaken() };
  if (/^Username ".*" already exists on tenant/.test(message)) return { reason: codeTaken() };
  return { reason: message || t('bulk_employees.row_not_added', 'This row couldn’t be added. Try again.') };
}

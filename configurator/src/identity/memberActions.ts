import { linkMember, removeMember } from './api';
import { session } from '@/api/onboarding';
import { MessageError } from '@/onboarding/i18n';

export interface MemberEmployee {
  tenantId: string;
  code: string;
  uuid?: string;
  isActive?: boolean;
  user: { uuid?: string; emailId?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export function requiredEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new MessageError('members.email_required', 'A valid email is required to invite an employee.');
  return email;
}
export function employeeUuid(employee: MemberEmployee): string {
  const uuid = employee.user.uuid || employee.uuid;
  if (!uuid) throw new MessageError('members.no_account_id', 'HRMS did not return the employee account identifier. Reload and retry.');
  return uuid;
}

const PASSWORD_SETS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '@#$%'];
function randomIndex(size: number): number {
  // Rejection sampling: no modulo bias.
  const limit = Math.floor(0x100000000 / size) * size;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % size;
}
/**
 * A throwaway password for the DIGIT account HRMS creates (#2713). Nobody sees or keeps it: the
 * member sets their own from the invitation. Sent because HRMS's own generator ignores
 * egov-user's policy (a digit, a lower- and an upper-case letter, one of @#$%, 8-15 characters),
 * so a few rows in a hundred failed. One from each set, then 11 from any, shuffled.
 */
export function throwawayPassword(): string {
  const all = PASSWORD_SETS.join('');
  const chars = [...PASSWORD_SETS, ...Array<string>(11).fill(all)].map(set => set[randomIndex(set.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** HRMS has the employee, but linking their sign-in failed. `employee` is the saved record, so the invite can be sent from it. */
export type InviteUnfinished = MessageError & { employee: MemberEmployee; reason: unknown };
export const isInviteUnfinished = (err: unknown): err is InviteUnfinished =>
  err instanceof MessageError && err.key === 'members.invite_unfinished';

/** Search by immutable code on every attempt, including after a lost create response. */
export async function createAndLink<T extends MemberEmployee>(input: T, search: () => Promise<T[]>, create: (employee: T) => Promise<T>): Promise<T> {
  const email = requiredEmail(input.user.emailId);
  const existing = (await search()).find(row => row.code === input.code && row.tenantId === input.tenantId);
  if (existing && (existing.isActive === false || requiredEmail(existing.user.emailId) !== email)) {
    throw new MessageError('members.code_taken', 'This employee code already belongs to a different or inactive employee.');
  }
  // The DIGIT token outlives the identity session, so HRMS would take the employee and the link
  // would then fail, leaving an employee nobody can invite until the admin signs in again (#2456).
  if (!existing && !(await session()).authenticated) {
    throw new MessageError('members.signin_ended', 'Your sign-in has ended, so nobody was added. Sign out, sign in again, and add them again.');
  }
  // Never a password the admin typed; a throwaway one so HRMS doesn't generate one (#2713).
  const user: MemberEmployee['user'] = { ...input.user, emailId: email, password: throwawayPassword() };
  const employee = existing ?? await create({ ...input, user });
  try {
    await linkMember(input.tenantId, employeeUuid(employee), email);
  } catch (error) {
    const unfinished = new MessageError(
      'members.invite_unfinished',
      'Employee %{code} exists in HRMS; invitation is unfinished. Retry with the same code and email. %{reason}',
      { code: input.code, reason: error instanceof Error ? error.message : '' },
    );
    throw Object.assign(unfinished, { employee, reason: error });
  }
  return employee;
}

/** Always re-read before deactivation; retrying a failed removal skips the completed HRMS write. */
export async function deactivateAndRemove<T extends MemberEmployee>(read: () => Promise<T>, update: (employee: T) => Promise<unknown>, actorUuid?: string): Promise<T> {
  const employee = await read();
  const uuid = employeeUuid(employee);
  if (actorUuid === uuid) throw new MessageError('members.self_removal', 'You cannot remove your own membership.');
  if (employee.isActive !== false) {
    const user = { ...employee.user };
    delete user.password;
    await update({
      ...employee, user, isActive: false, reActivateEmployee: false,
      deactivationDetails: [
        ...(Array.isArray(employee.deactivationDetails) ? employee.deactivationDetails : []),
        { reasonForDeactivation: 'OTHERS', effectiveFrom: Date.now() },
      ],
    });
  }
  try {
    await removeMember(employee.tenantId, uuid);
  } catch (error) {
    throw new MessageError(
      'members.removal_unfinished',
      'Employee is inactive in HRMS; membership removal is unfinished. Retry removal. %{reason}',
      { reason: error instanceof Error ? error.message : '' },
    );
  }
  return employee;
}

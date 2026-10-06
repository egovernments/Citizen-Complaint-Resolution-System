import { OnboardingError } from '@/api/onboarding';
import type { Employee } from '@/api/types';
import { linkMember, members, resendActivation, type Member } from '@/identity/api';
import { employeeUuid, requiredEmail, type MemberEmployee } from '@/identity/memberActions';
import { englishT, type OnboardingT } from '../i18n';
import { INVITE_ERRORS } from './inviteErrors';

/**
 * Whether each employee can sign in, from the identity BFF's member list. HRMS
 * holds the employee and the BFF holds their sign-in link to a person's
 * account, joined on the employee's DIGIT uuid.
 */
export type InviteStatus =
  /** Has workspace access. A new account gets this at once, along with the email to set a password. */
  | { kind: 'active' }
  /** Someone who already had an account was invited, at `email`, and hasn't accepted yet. */
  | { kind: 'invited'; expiresAt?: number; email?: string }
  | { kind: 'expired' }
  /** Their access was removed, but HRMS still has them as an employee. */
  | { kind: 'removed' }
  /** No invitation went out, for example after an add whose invite step failed. */
  | { kind: 'none' };

/** Members by DIGIT uuid. A person invited again after a removal has two rows; the live one wins. */
export async function loadMembers(tenantId: string): Promise<Map<string, Member>> {
  const [live, removed] = await Promise.all([members(tenantId), members(tenantId, 'removed')]);
  return new Map([...removed, ...live].map((member) => [member.digitUuid, member]));
}

export function inviteStatus(member: Member | undefined): InviteStatus {
  if (!member) return { kind: 'none' };
  if (member.state === 'active') return { kind: 'active' };
  if (member.state === 'pending') return { kind: 'invited', expiresAt: member.expiresAt, email: member.email };
  // The list shows an expired invitation as removed at its expiry time.
  return member.expiresAt !== undefined && member.removedAt === member.expiresAt ? { kind: 'expired' } : { kind: 'removed' };
}

export function memberUuid(employee: Employee): string {
  return employeeUuid(employee as unknown as MemberEmployee);
}

/** Resend to an active or invited member: the password setup email, or the one to confirm their address. */
export async function resendInvite(employee: Employee, member: Member) {
  const email = member.email ?? requiredEmail(employee.user.emailId);
  const { activationEmail } = await resendActivation(employee.tenantId, member.digitUuid, email);
  return { email, activationEmail };
}

/** A first invitation, or a new one after an expiry or removal, to the email on the HRMS record. */
export async function sendInvite(employee: Employee, again: boolean) {
  const email = requiredEmail(employee.user.emailId);
  const { binding } = await linkMember(employee.tenantId, memberUuid(employee), email, again);
  return { email, invited: binding.state === 'pending' };
}


/** A failed resend or invite in words; ACTIVATION_NOT_NEEDED is handled before this as an outcome, not an error. */
export function describeInviteError(err: unknown, t: OnboardingT = englishT): string {
  const code = err instanceof OnboardingError ? err.code : null;
  // Keyed by the BFF's code, as the workspace errors are.
  if (code && INVITE_ERRORS[code]) return t(`invite_errors.${code}`, INVITE_ERRORS[code]);
  return err instanceof Error && err.message ? err.message : t('employees.email_failed', 'The email couldn’t be sent. Try again.');
}

export function activationNotNeeded(err: unknown): boolean {
  return err instanceof OnboardingError && err.code === 'ACTIVATION_NOT_NEEDED';
}

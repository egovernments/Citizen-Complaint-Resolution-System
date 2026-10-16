import { API_ORIGIN } from '@/api/onboarding';

/**
 * A county admin resets a staff member's password (identity-bff POST /identity/v1/admin/users/_password, generate
 * mode). identity-bff authorizes the caller from the DIGIT token (Bearer) and the target's tenant subtree; the reply
 * carries a one-time password that is shown once - the staff member must change it at the next sign-in - and the
 * staff member's sessions end.
 */
export interface ResetResult { password: string; sessionsEnded?: number }
export class ResetPasswordError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

const MESSAGES: Record<string, string> = {
  NOT_IN_SUBTREE: 'You cannot reset this person\'s password: they are outside the tenants you administer.',
  SELF_RESET_NOT_ALLOWED: 'You cannot reset your own password here. Use your account page.',
  NOT_MANAGEABLE: 'This account cannot be managed from here.',
  USER_NOT_FOUND: 'This employee has no sign-in account yet.',
  INVALID_REQUEST: 'The reset request was not valid. Please reload and try again.',
};
export const resetErrorMessage = (code: string): string =>
  MESSAGES[code] ?? 'The password could not be reset. Please try again.';

/** Roles that may see the action (identity-bff is the real check). */
export const RESET_ROLES = ['ACCOUNT_ADMIN', 'HRMS_ADMIN'];
export const canResetPasswords = (roles: string[] | undefined): boolean =>
  (roles ?? []).some((r) => RESET_ROLES.includes(String(r).toUpperCase()));

export async function resetStaffPassword(
  token: string, tenantId: string, uuid: string, fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<ResetResult> {
  const response = await fetchImpl(`${API_ORIGIN}/identity/v1/admin/users/_password`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tenantId, user: uuid, generate: true, logout: true }),
  });
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || typeof body?.password !== 'string') {
    const errors = (body?.Errors ?? body?.errors) as Array<{ code?: string }> | undefined;
    throw new ResetPasswordError(response.status, errors?.[0]?.code || (response.ok ? 'INVALID_RESPONSE' : `HTTP_${response.status}`));
  }
  return { password: body.password, sessionsEnded: typeof body.sessionsEnded === 'number' ? body.sessionsEnded : undefined };
}

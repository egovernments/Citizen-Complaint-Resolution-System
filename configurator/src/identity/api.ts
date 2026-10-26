import { API_ORIGIN, call, type Invitation } from '@/api/onboarding';

const base = `${API_ORIGIN}/identity/v1`;
export interface Member {
  subject: string;
  /** The current email for an active member; the invited address (if recorded) otherwise. */
  email?: string;
  name?: string;
  digitUuid: string;
  /** An expired invitation is listed as `removed`, with `removedAt` equal to `expiresAt`. */
  state: 'active' | 'pending' | 'removed';
  invitationVersion: number;
  boundAt?: number;
  expiresAt?: number;
  removedAt?: number;
  missing?: boolean;
}

/** Active and pending members by default; `state` lists one state, `removed` included. */
export async function members(tenantId: string, state?: Member['state']): Promise<Member[]> {
  const result: Member[] = [];
  // A page can be short and still not be the last: follow nextFirst.
  for (let first: number | undefined = 0; first !== undefined; ) {
    const query = new URLSearchParams({ tenantId, first: String(first), max: '100', ...(state && { state }) });
    const page: { members: Member[]; nextFirst?: number } = await call(`${base}/workspace-members?${query}`);
    result.push(...page.members);
    first = page.nextFirst;
  }
  return result;
}

export function linkMember(tenantId: string, digitUuid: string, email: string, reinvite = false) {
  return call<{ binding: { state: string }; activationEmailSent?: boolean }>(`${base}/workspace-members/_link`, {
    method: 'POST', body: JSON.stringify({ tenantId, digitUuid, email, ...(reinvite ? { reinvite } : {}) }),
  });
}

/** Send the sign-in setup (or email confirmation) again; the binding doesn't change. */
export function resendActivation(tenantId: string, digitUuid: string, email: string) {
  return call<{ activationEmail: 'password_setup' | 'verify_email' }>(`${base}/workspace-members/_link`, {
    method: 'POST', body: JSON.stringify({ tenantId, digitUuid, email, resend: true }),
  });
}

export function removeMember(tenantId: string, digitUuid: string) {
  return call(`${base}/workspace-members/_remove`, { method: 'POST', body: JSON.stringify({ tenantId, digitUuid }) });
}

export function updateMemberEmail(tenantId: string, digitUuid: string, email: string) {
  return call<{ status: 'verification_sent' }>(`${base}/workspace-members/_updateEmail`, {
    method: 'POST', body: JSON.stringify({ tenantId, digitUuid, email }),
  });
}

export function acceptInvitation(invitation: Pick<Invitation, 'tenantId' | 'invitationVersion'>) {
  return call(`${base}/workspace-invitations/_accept`, {
    method: 'POST', body: JSON.stringify({ tenantId: invitation.tenantId, invitationVersion: invitation.invitationVersion }),
  });
}

export function declineInvitation(invitation: Pick<Invitation, 'tenantId' | 'invitationVersion'>) {
  return call(`${base}/workspace-invitations/_decline`, {
    method: 'POST', body: JSON.stringify({ tenantId: invitation.tenantId, invitationVersion: invitation.invitationVersion }),
  });
}

export function unlinkProvider(alias: string) {
  return call(`${base}/account/providers/_unlink`, { method: 'POST', body: JSON.stringify({ alias }) });
}

export function accountAction(action: string, parameters: { credentialId?: string; provider?: string } = {}) {
  const returnTo = API_ORIGIN ? `${window.location.origin}/configurator/account` : '/configurator/account';
  window.location.assign(`${base}/authorize?${new URLSearchParams({ surface: 'configurator', action, returnTo, ...parameters })}`);
}

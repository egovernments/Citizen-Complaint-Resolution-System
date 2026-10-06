import { API_ORIGIN, call, type Invitation } from '@/api/onboarding';

const base = `${API_ORIGIN}/identity/v1`;
export interface Member {
  subject: string;
  email: string;
  name: string;
  digitUuid: string;
  state: 'active' | 'pending';
  invitationVersion: number;
  expiresAt?: number;
  missing?: boolean;
}

export async function members(tenantId: string): Promise<Member[]> {
  const result: Member[] = [];
  for (let first = 0; ; first += 100) {
    const page = await call<{ members: Member[] }>(`${base}/workspace-members?${new URLSearchParams({ tenantId, first: String(first), max: '100' })}`);
    result.push(...page.members);
    if (page.members.length < 100) return result;
  }
}

export function linkMember(tenantId: string, digitUuid: string, email: string, reinvite = false) {
  return call<{ binding: { state: string }; activationEmailSent?: boolean }>(`${base}/workspace-members/_link`, {
    method: 'POST', body: JSON.stringify({ tenantId, digitUuid, email, ...(reinvite ? { reinvite } : {}) }),
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

export function unlinkProvider(alias: string) {
  return call(`${base}/account/providers/_unlink`, { method: 'POST', body: JSON.stringify({ alias }) });
}

export function accountAction(action: string, parameters: { credentialId?: string; provider?: string } = {}) {
  const returnTo = API_ORIGIN ? `${window.location.origin}/configurator/account` : '/configurator/account';
  window.location.assign(`${base}/authorize?${new URLSearchParams({ surface: 'configurator', action, returnTo, ...parameters })}`);
}

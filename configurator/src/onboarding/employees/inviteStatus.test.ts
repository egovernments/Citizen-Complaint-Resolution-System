vi.mock('@/identity/api', () => ({
  members: vi.fn(),
  linkMember: vi.fn(),
  resendActivation: vi.fn(),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingError } from '@/api/onboarding';
import type { Employee } from '@/api/types';
import { linkMember, members, resendActivation, type Member } from '@/identity/api';
import { activationNotNeeded, describeInviteError, inviteStatus, loadMembers, resendInvite, sendInvite } from './inviteStatus';

const member = (over: Partial<Member>): Member => ({ subject: 's', digitUuid: 'u-1', state: 'active', invitationVersion: 1, ...over });
const employee = { tenantId: 'acme', code: 'EMP_0002', uuid: 'e-2', user: { uuid: 'u-1', name: 'Asha', emailId: 'Asha@Example.org' } } as unknown as Employee;

beforeEach(() => vi.clearAllMocks());

describe('inviteStatus', () => {
  it('reads each member state', () => {
    expect(inviteStatus(undefined)).toEqual({ kind: 'none' });
    expect(inviteStatus(member({ state: 'active' }))).toEqual({ kind: 'active' });
    expect(inviteStatus(member({ state: 'pending', expiresAt: 5 }))).toEqual({ kind: 'invited', expiresAt: 5 });
  });

  it('tells an expired invitation from a removal by the removal time', () => {
    expect(inviteStatus(member({ state: 'removed', expiresAt: 5, removedAt: 5 }))).toEqual({ kind: 'expired' });
    expect(inviteStatus(member({ state: 'removed', expiresAt: 5, removedAt: 9 }))).toEqual({ kind: 'removed' });
    expect(inviteStatus(member({ state: 'removed', removedAt: 9 }))).toEqual({ kind: 'removed' });
  });
});

describe('loadMembers', () => {
  it('indexes live and removed members by uuid, the live one winning', async () => {
    vi.mocked(members).mockImplementation(async (_tenant, state) =>
      state === 'removed'
        ? [member({ digitUuid: 'u-1', state: 'removed', subject: 'old' }), member({ digitUuid: 'u-2', state: 'removed' })]
        : [member({ digitUuid: 'u-1', state: 'pending', subject: 'new' })],
    );
    const index = await loadMembers('acme');
    expect(members).toHaveBeenCalledWith('acme');
    expect(members).toHaveBeenCalledWith('acme', 'removed');
    expect(index.get('u-1')).toMatchObject({ state: 'pending', subject: 'new' });
    expect(index.get('u-2')).toMatchObject({ state: 'removed' });
  });
});

describe('email actions', () => {
  it('resends to the member’s own email, or the HRMS one when the list has none', async () => {
    vi.mocked(resendActivation).mockResolvedValue({ activationEmail: 'verify_email' });
    expect(await resendInvite(employee, member({ email: 'listed@example.org' }))).toEqual({ email: 'listed@example.org', activationEmail: 'verify_email' });
    expect(resendActivation).toHaveBeenLastCalledWith('acme', 'u-1', 'listed@example.org');
    await resendInvite(employee, member({ state: 'pending' }));
    expect(resendActivation).toHaveBeenLastCalledWith('acme', 'u-1', 'asha@example.org');
  });

  it('invites to the HRMS email, as a re-invite only after an expiry or removal', async () => {
    vi.mocked(linkMember).mockResolvedValue({ binding: { state: 'pending' } });
    expect(await sendInvite(employee, false)).toEqual({ email: 'asha@example.org', invited: true });
    expect(linkMember).toHaveBeenLastCalledWith('acme', 'u-1', 'asha@example.org', false);
    await sendInvite(employee, true);
    expect(linkMember).toHaveBeenLastCalledWith('acme', 'u-1', 'asha@example.org', true);
  });

  it('binds a child-tenant employee at the workspace, not at their own tenant (D16, amended)', async () => {
    const cityEmployee = { ...employee, tenantId: 'acme.city' } as typeof employee;
    vi.mocked(linkMember).mockResolvedValue({ binding: { state: 'active' } });
    await sendInvite(cityEmployee, false, 'acme');
    expect(linkMember).toHaveBeenLastCalledWith('acme', 'u-1', 'asha@example.org', false);
    vi.mocked(resendActivation).mockResolvedValue({ activationEmail: 'password_setup' });
    await resendInvite(cityEmployee, member({ email: 'listed@example.org' }), 'acme');
    expect(resendActivation).toHaveBeenLastCalledWith('acme', 'u-1', 'listed@example.org');
  });

  it('words the BFF’s refusals and keeps other messages', () => {
    expect(describeInviteError(new OnboardingError(429, 'RESEND_TOO_SOON', 'x'))).toMatch(/less than a minute ago/);
    expect(describeInviteError(new OnboardingError(403, 'IDENTITY_DISABLED', 'x'))).toMatch(/disabled/);
    expect(describeInviteError(new OnboardingError(503, 'SOMETHING_NEW', 'Server said no'))).toBe('Server said no');
    expect(activationNotNeeded(new OnboardingError(409, 'ACTIVATION_NOT_NEEDED', 'x'))).toBe(true);
    expect(activationNotNeeded(new Error('ACTIVATION_NOT_NEEDED'))).toBe(false);
  });
});

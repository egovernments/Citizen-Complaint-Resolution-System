import { afterEach, expect, it, vi } from 'vitest';
import { __setFetchForTests, logout, session } from '@/api/onboarding';
import { acceptInvitation, declineInvitation, linkMember, members, removeMember, resendActivation, unlinkProvider, updateMemberEmail } from './api';
afterEach(() => __setFetchForTests(null));
it.each([
  ['link', () => linkMember('acme', 'u', 'e@example.org'), '/workspace-members/_link', { tenantId: 'acme', digitUuid: 'u', email: 'e@example.org' }],
  ['resend', () => resendActivation('acme', 'u', 'e@example.org'), '/workspace-members/_link', { tenantId: 'acme', digitUuid: 'u', email: 'e@example.org', resend: true }],
  ['remove', () => removeMember('acme', 'u'), '/workspace-members/_remove', { tenantId: 'acme', digitUuid: 'u' }],
  ['accept', () => acceptInvitation({ tenantId: 'acme', invitationVersion: 3 }), '/workspace-invitations/_accept', { tenantId: 'acme', invitationVersion: 3 }],
  ['decline', () => declineInvitation({ tenantId: 'acme', invitationVersion: 3 }), '/workspace-invitations/_decline', { tenantId: 'acme', invitationVersion: 3 }],
  ['email', () => updateMemberEmail('acme', 'u', 'new@example.org'), '/workspace-members/_updateEmail', { tenantId: 'acme', digitUuid: 'u', email: 'new@example.org' }],
  ['unlink', () => unlinkProvider('google'), '/account/providers/_unlink', { alias: 'google' }],
  ['logout', () => logout('others'), '/logout', { scope: 'others' }],
] as const)('%s sends the frozen contract with only the BFF cookie', async (_name, action, path, body) => {
  const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
  __setFetchForTests(fetcher);
  await action();
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining(path), expect.objectContaining({ credentials: 'include', method: 'POST', body: JSON.stringify(body) }));
  expect(fetcher.mock.calls[0]).not.toContain('authToken');
});
it('requests account metadata only when the account view asks', async () => {
  const fetcher = vi.fn(async () => new Response('{"authenticated":true}', { status: 200 })); __setFetchForTests(fetcher);
  await session(undefined, true);
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/session?include=account'), expect.anything());
});
it('pages the member list by nextFirst, which a short page can still carry', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ members: [{ digitUuid: 'a' }], nextFirst: 100 })))
    .mockResolvedValueOnce(new Response('{"members":[{"digitUuid":"b"}]}'));
  __setFetchForTests(fetcher);
  expect((await members('acme')).map(m => m.digitUuid)).toEqual(['a', 'b']);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][0]).toContain('first=100');
});
it('asks for one member state when given', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{"members":[]}'));
  __setFetchForTests(fetcher);
  await members('acme', 'removed');
  expect(String(fetcher.mock.calls[0][0])).toContain('state=removed');
});
it('preserves invitation stale and last-method errors for the UI', async () => {
  __setFetchForTests(async () => new Response('{"code":"INVITATION_STALE","error":"Invitation expired"}', { status: 409 }));
  await expect(acceptInvitation({ tenantId: 'acme', invitationVersion: 1 })).rejects.toMatchObject({ code: 'INVITATION_STALE', status: 409 });
  await expect(declineInvitation({ tenantId: 'acme', invitationVersion: 1 })).rejects.toMatchObject({ code: 'INVITATION_STALE', status: 409 });
});

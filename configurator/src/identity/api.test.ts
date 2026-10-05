import { afterEach, expect, it, vi } from 'vitest';
import { __setFetchForTests, logout, session } from '@/api/onboarding';
import { acceptInvitation, linkMember, members, removeMember, unlinkProvider, updateMemberEmail } from './api';
afterEach(() => __setFetchForTests(null));
it.each([
  ['link', () => linkMember('acme', 'u', 'e@example.org'), '/workspace-members/_link', { tenantId: 'acme', digitUuid: 'u', email: 'e@example.org' }],
  ['remove', () => removeMember('acme', 'u'), '/workspace-members/_remove', { tenantId: 'acme', digitUuid: 'u' }],
  ['accept', () => acceptInvitation({ tenantId: 'acme', invitationVersion: 3 }), '/workspace-invitations/_accept', { tenantId: 'acme', invitationVersion: 3 }],
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
it('paginates the member list', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ members: Array.from({ length: 100 }, (_, i) => ({ digitUuid: String(i) })) }))).mockResolvedValueOnce(new Response('{"members":[]}'));
  __setFetchForTests(fetcher);
  expect(await members('acme')).toHaveLength(100);
  expect(fetcher.mock.calls[1][0]).toContain('first=100');
});
it('preserves invitation stale and last-method errors for the UI', async () => {
  __setFetchForTests(async () => new Response('{"code":"INVITATION_STALE","error":"Invitation expired"}', { status: 409 }));
  await expect(acceptInvitation({ tenantId: 'acme', invitationVersion: 1 })).rejects.toMatchObject({ code: 'INVITATION_STALE', status: 409 });
});

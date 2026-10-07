import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndLink, deactivateAndRemove, type MemberEmployee } from './memberActions';
import { linkMember, removeMember } from './api';
vi.mock('./api', () => ({ linkMember: vi.fn(), removeMember: vi.fn() }));
const input: MemberEmployee = { tenantId: 'acme', code: 'E1', isActive: true, user: { emailId: ' PERSON@EXAMPLE.ORG ', password: 'must-not-send' } };
beforeEach(() => vi.resetAllMocks());

describe('member actions', () => {
  it('requires email before creating HRMS records', async () => {
    const create = vi.fn(); const search = vi.fn();
    await expect(createAndLink({ ...input, user: {} }, search, create)).rejects.toThrow('valid email');
    expect(create).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
  });
  it('creates without a password and links the returned user uuid', async () => {
    const create = vi.fn(async row => ({ ...row, user: { ...row.user, uuid: 'u1' } }));
    await createAndLink(input, async () => [], create);
    expect(create.mock.calls[0][0].user).not.toHaveProperty('password');
    expect(linkMember).toHaveBeenCalledWith('acme', 'u1', 'person@example.org');
  });
  it('retries linking after HRMS succeeds without creating another employee', async () => {
    const rows: MemberEmployee[] = [];
    const create = vi.fn(async row => { const saved = { ...row, uuid: 'u1' }; rows.push(saved); return saved; });
    vi.mocked(linkMember).mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValueOnce({ binding: { state: 'pending' } });
    await expect(createAndLink(input, async () => rows, create)).rejects.toThrow('invitation is unfinished');
    await createAndLink(input, async () => rows, create);
    expect(create).toHaveBeenCalledTimes(1); expect(linkMember).toHaveBeenCalledTimes(2);
  });
  it('recovers a lost HRMS create response by searching the immutable code', async () => {
    const create = vi.fn();
    await createAndLink(input, async () => [{ ...input, uuid: 'u1' }], create);
    expect(create).not.toHaveBeenCalled(); expect(linkMember).toHaveBeenCalledWith('acme', 'u1', 'person@example.org');
  });
  it('does not bind a colliding employee code with a different email', async () => {
    await expect(createAndLink(input, async () => [{ ...input, uuid: 'u1', user: { emailId: 'other@example.org' } }], vi.fn())).rejects.toThrow('different or inactive');
    expect(linkMember).not.toHaveBeenCalled();
  });
  it('does not remove a binding when HRMS deactivation fails', async () => {
    await expect(deactivateAndRemove(async () => ({ ...input, uuid: 'u1' }), async () => { throw new Error('HRMS down'); })).rejects.toThrow('HRMS down');
    expect(removeMember).not.toHaveBeenCalled();
  });
  it('retries only removal once HRMS is already inactive', async () => {
    let row = { ...input, uuid: 'u1' };
    const update = vi.fn(async value => { row = value; });
    vi.mocked(removeMember).mockRejectedValueOnce(new Error('BFF down')).mockResolvedValueOnce({});
    await expect(deactivateAndRemove(async () => row, update)).rejects.toThrow('membership removal is unfinished');
    await deactivateAndRemove(async () => row, update);
    expect(update).toHaveBeenCalledTimes(1); expect(removeMember).toHaveBeenCalledTimes(2);
  });
  it('refuses self removal before deactivating HRMS', async () => {
    const update = vi.fn();
    await expect(deactivateAndRemove(async () => ({ ...input, uuid: 'self' }), update, 'self')).rejects.toThrow('own membership');
    expect(update).not.toHaveBeenCalled();
  });
});

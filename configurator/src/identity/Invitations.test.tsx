import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Invitations } from './Invitations';
import { acceptInvitation, declineInvitation } from './api';
vi.mock('./api', () => ({ acceptInvitation: vi.fn(), declineInvitation: vi.fn() }));
const invitation = { tenantId: 'acme', name: 'Acme', invitationVersion: 2, invitedAt: 0, expiresAt: Date.now() + 60_000 };
beforeEach(() => vi.resetAllMocks());
it('accepts an invitation and refreshes', async () => {
  const onChanged = vi.fn(async () => {});
  render(<Invitations invitations={[invitation]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation to Acme' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(acceptInvitation).toHaveBeenCalledWith(invitation);
});
it('declines only after confirmation, then refreshes', async () => {
  const onChanged = vi.fn(async () => {});
  render(<Invitations invitations={[invitation]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Decline invitation to Acme' }));
  expect(declineInvitation).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(declineInvitation).toHaveBeenCalledWith(invitation);
  expect(screen.queryByRole('button', { name: 'Confirm decline' })).not.toBeInTheDocument();
});
it('keeps the decline confirmation and shows a stale invitation error', async () => {
  vi.mocked(declineInvitation).mockRejectedValueOnce(Object.assign(new Error('Invitation expired'), { code: 'INVITATION_STALE' }));
  const onChanged = vi.fn(async () => {});
  render(<Invitations invitations={[invitation]} onChanged={onChanged} />);
  fireEvent.click(screen.getByRole('button', { name: 'Decline invitation to Acme' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }));
  expect(await screen.findByText('Invitation expired')).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Confirm decline' })).toBeInTheDocument();
});
it('offers no decline on an expired invitation', () => {
  render(<Invitations invitations={[{ ...invitation, expiresAt: Date.now() - 1 }]} onChanged={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Decline invitation to Acme' })).toBeDisabled();
});

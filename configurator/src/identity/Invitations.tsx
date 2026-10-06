import { useState } from 'react';
import { type Invitation } from '@/api/onboarding';
import { acceptInvitation, declineInvitation } from './api';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function Invitations({ invitations, onChanged }: { invitations: Invitation[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDecline, setConfirmDecline] = useState<Invitation | null>(null);
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true); setError(null);
    try { await action(); setConfirmDecline(null); await onChanged(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : fallback); }
    finally { setBusy(false); }
  };
  return <section className="flex flex-col gap-4" aria-label="Workspace invitations">
    <h2 className="text-xl font-semibold">Workspace invitations</h2>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {invitations.map(invitation => {
      const expired = invitation.expiresAt <= Date.now();
      const confirming = confirmDecline?.tenantId === invitation.tenantId && confirmDecline.invitationVersion === invitation.invitationVersion;
      return <div key={`${invitation.tenantId}:${invitation.invitationVersion}`} className="flex flex-col gap-2">
        <p>{invitation.name}</p>
        <p className="text-sm text-muted-foreground">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
        <Button disabled={busy || expired} onClick={() => void run(() => acceptInvitation(invitation),
          'Could not accept invitation. Reload to check its current status.')}>Accept invitation to {invitation.name}</Button>
        <Button variant="outline" disabled={busy || expired} onClick={() => setConfirmDecline(invitation)}>Decline invitation to {invitation.name}</Button>
        {confirming && <Alert><AlertDescription>
          <p>Decline the invitation to {invitation.name}? Your administrator would need to invite you again.</p>
          <div className="mt-3 flex gap-2"><Button variant="destructive" disabled={busy} onClick={() => void run(() => declineInvitation(invitation),
            'Could not decline invitation. Reload to check its current status.')}>Confirm decline</Button>
          <Button variant="outline" disabled={busy} onClick={() => setConfirmDecline(null)}>Cancel</Button></div>
        </AlertDescription></Alert>}
      </div>;
    })}
  </section>;
}

import { useState } from 'react';
import { type Invitation } from '@/api/onboarding';
import { acceptInvitation } from './api';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function Invitations({ invitations, onAccepted }: { invitations: Invitation[]; onAccepted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <section className="flex flex-col gap-4" aria-label="Workspace invitations">
    <h2 className="text-xl font-semibold">Workspace invitations</h2>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {invitations.map(invitation => <div key={`${invitation.tenantId}:${invitation.invitationVersion}`} className="flex flex-col gap-2">
      <p>{invitation.name}</p>
      <p className="text-sm text-muted-foreground">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
      <Button disabled={busy || invitation.expiresAt <= Date.now()} onClick={async () => {
        setBusy(true); setError(null);
        try { await acceptInvitation(invitation); await onAccepted(); }
        catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not accept invitation. Reload to check its current status.'); }
        finally { setBusy(false); }
      }}>Accept invitation to {invitation.name}</Button>
    </div>)}
  </section>;
}

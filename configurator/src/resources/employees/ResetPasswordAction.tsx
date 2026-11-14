import { useState } from 'react';
import { KeyRound, Loader2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { apiClient } from '@/api/client';
import { resetStaffPassword, resetErrorMessage, ResetPasswordError } from '@/identity/resetPassword';

/** Employee Show: "Reset password" - a one-time password, shown once; the staff member changes it at next sign-in. */
export function ResetPasswordAction({ tenantId, uuid, name }: { tenantId: string; uuid: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const close = () => { setOpen(false); setPassword(null); setError(null); setCopied(false); };

  const reset = async () => {
    setBusy(true); setError(null);
    try {
      const r = await resetStaffPassword(apiClient.getAuth().token ?? '', tenantId, uuid);
      setPassword(r.password);
    } catch (e) {
      setError(resetErrorMessage(e instanceof ResetPasswordError ? e.code : 'UNKNOWN'));
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <KeyRound className="w-4 h-4" /> Reset password
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset password for {name}</DialogTitle>
            <DialogDescription>
              {password
                ? 'Give this one-time password to the staff member. It is shown only once; they must change it at their next sign-in.'
                : 'A one-time password replaces their current one, and they are signed out everywhere.'}
            </DialogDescription>
          </DialogHeader>
          {password && (
            <div className="flex items-center gap-2">
              <code data-testid="one-time-password" data-sensitive="password"
                className="flex-1 rounded border bg-muted px-3 py-2 font-mono text-base select-all">{password}</code>
              <Button type="button" variant="outline" size="sm" className="gap-1.5"
                onClick={() => { void navigator.clipboard?.writeText(password); setCopied(true); }}>
                <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          )}
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter>
            {password ? (
              <Button type="button" onClick={close}>Done</Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
                <Button type="button" onClick={reset} disabled={busy} className="gap-1.5">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Reset password
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

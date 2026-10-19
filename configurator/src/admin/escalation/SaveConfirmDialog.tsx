import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';

interface SaveConfirmDialogProps {
  open: boolean;
  tenantId: string;
  isStatePolicy: boolean;
  inheritedTenantCount: number;
  diffs: string[];
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SaveConfirmDialog({
  open,
  tenantId,
  isStatePolicy,
  inheritedTenantCount,
  diffs,
  saving,
  onClose,
  onConfirm,
}: SaveConfirmDialogProps) {
  const hasFunctionalChanges =
    diffs.length > 0 && !diffs.includes('No functional policy changes detected.');

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {isStatePolicy ? 'Confirm State Policy Update' : 'Create City Policy Override'}
          </DialogTitle>
          <DialogDescription className="text-left pt-2 text-sm text-foreground/80 space-y-1">
            {isStatePolicy ? (
              <>
                <p>
                  You are updating the state policy for{' '}
                  <strong className="text-foreground">{tenantId}</strong>.
                </p>
                {inheritedTenantCount > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {inheritedTenantCount} city tenants currently inherit this record.
                  </p>
                )}
              </>
            ) : (
              <>
                <p>
                  You are creating a city-specific escalation policy for{' '}
                  <strong className="text-foreground">{tenantId}</strong>.
                </p>
                <p className="text-amber-600 dark:text-amber-400 text-xs font-medium">
                  Once saved, this city will stop inheriting future updates from the state policy.
                </p>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="border border-border rounded-md p-3 bg-muted/30 text-xs space-y-1.5">
            <span className="font-semibold text-foreground block">Changes summary:</span>
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              {diffs.map((d, idx) => (
                <li key={idx}>{d}</li>
              ))}
            </ul>
          </div>

          {!hasFunctionalChanges ? (
            <Alert className="border-blue-500/50 bg-blue-50 dark:bg-blue-950/20 text-blue-800 dark:text-blue-200">
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <AlertDescription className="text-xs ml-2">
                No policy modifications detected. Saving is disabled until changes are made.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <AlertDescription className="text-xs ml-2">
                Existing overdue complaints may become eligible for escalation on the next
                automatic scan (~5 minutes).
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !hasFunctionalChanges}
            onClick={onConfirm}
            className="gap-1.5"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving…' : isStatePolicy ? 'Confirm and save' : 'Create city override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
import { AlertTriangle, Loader2 } from 'lucide-react';

interface SaveConfirmDialogProps {
  open: boolean;
  tenantId: string;
  inheritedTenantCount: number;
  diffs: string[];
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SaveConfirmDialog({
  open,
  tenantId,
  inheritedTenantCount,
  diffs,
  saving,
  onClose,
  onConfirm,
}: SaveConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Confirm Policy Update</DialogTitle>
          <DialogDescription className="text-left pt-2 text-sm text-foreground/80 space-y-1">
            <p>
              You are updating the state policy for{' '}
              <strong className="text-foreground">{tenantId}</strong>.
            </p>
            {inheritedTenantCount > 0 && (
              <p className="text-muted-foreground text-xs">
                {inheritedTenantCount} city tenants currently inherit this record.
              </p>
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

          <Alert className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="text-xs ml-2">
              Existing overdue complaints may become eligible for escalation on the next
              automatic scan (~5 minutes).
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={onConfirm} className="gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saving ? 'Saving…' : 'Confirm and save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import type { WorkspaceTrialNotice } from '@/api/onboarding';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Blocking notice for a workspace whose trial has ended. Every field is
 * operator-supplied and rendered as plain text.
 */
export function WorkspaceTrialDialog({ notice, open, onClose }: {
  notice: WorkspaceTrialNotice;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{notice.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{notice.message}</AlertDialogDescription>
        </AlertDialogHeader>
        {notice.linkUrl && (
          <a href={notice.linkUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline underline-offset-4">
            {notice.linkLabel}
          </a>
        )}
        <AlertDialogFooter>
          <AlertDialogAction>Close</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

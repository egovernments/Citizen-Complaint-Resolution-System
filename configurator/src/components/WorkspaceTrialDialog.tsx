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
 * operator-supplied and rendered as plain text; the link needs label and url.
 */
export function WorkspaceTrialDialog({ notice, open, onClose }: {
  notice: WorkspaceTrialNotice;
  open: boolean;
  onClose: () => void;
}) {
  const link = notice.linkLabel && notice.linkUrl ? { label: notice.linkLabel, url: notice.linkUrl } : null;
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{notice.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{notice.message}</AlertDialogDescription>
        </AlertDialogHeader>
        {link && (
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary underline underline-offset-4">
            {link.label}
          </a>
        )}
        <AlertDialogFooter>
          <AlertDialogAction>Close</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

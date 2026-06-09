import React, { useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { Button } from '../primitives/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../primitives/alert-dialog';
import type { MutationMode } from '../columns/types';

export interface InlineDeleteProps {
  itemName?: string;
  onConfirm: () => Promise<void> | void;
  mutationMode?: MutationMode;
}

export const InlineDelete: React.FC<InlineDeleteProps> = ({
  itemName = 'item',
  onConfirm,
  mutationMode = 'pessimistic',
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (mutationMode === 'undoable') {
      // For undoable mode, delete immediately without confirmation
      // The undo toast will handle reversal
      await onConfirm();
      return;
    }

    // For pessimistic/optimistic modes, open confirmation dialog
    setOpen(true);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setLoading(false);
    }
  };

  // For undoable mode, just render the button without dialog
  if (mutationMode === 'undoable') {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    );
  }

  // For pessimistic/optimistic modes, render button with confirmation dialog
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={handleDelete}
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this {itemName}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

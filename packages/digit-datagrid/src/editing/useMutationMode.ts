import { useUpdate, useDelete } from 'ra-core';
import type { UpdateParams, DeleteParams } from 'ra-core';
import { useRef, useCallback } from 'react';
import type { MutationMode } from '../columns/types';
import { toast } from '../hooks/use-toast';
import { ToastAction } from '../primitives/toast';
import * as React from 'react';

interface PendingMutation {
  resource: string;
  params: UpdateParams | DeleteParams;
  type: 'update' | 'delete';
  timeoutId: NodeJS.Timeout;
  toastId: string;
}

interface UseMutationModeOptions {
  mode?: MutationMode;
  undoTimeout?: number;
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
  transform?: (data: Record<string, unknown>) => Record<string, unknown>;
}

export function useMutationMode(options: UseMutationModeOptions = {}) {
  const {
    mode = 'undoable',
    undoTimeout = 5000,
    onSuccess,
    onError,
    transform,
  } = options;

  const [update] = useUpdate();
  const [deleteOne] = useDelete();

  const pendingMutationsRef = useRef<Map<string, PendingMutation>>(new Map());
  const mutationCounterRef = useRef(0);

  const undo = useCallback((mutationId: string) => {
    const pending = pendingMutationsRef.current.get(mutationId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      pendingMutationsRef.current.delete(mutationId);

      // Dismiss the toast
      const toastInstance = toast({ title: '' });
      toastInstance.dismiss();
    }
  }, []);

  const executeMutation = useCallback(
    async (
      resource: string,
      params: UpdateParams | DeleteParams,
      type: 'update' | 'delete'
    ) => {
      try {
        let result;
        if (type === 'update') {
          const updateParams = params as UpdateParams;
          const dataToSave = transform
            ? transform(updateParams.data as Record<string, unknown>)
            : updateParams.data;

          result = await update(resource, {
            ...updateParams,
            data: dataToSave,
          });
        } else {
          result = await deleteOne(resource, params as DeleteParams);
        }

        if (onSuccess) {
          onSuccess(result.data);
        }
      } catch (error) {
        if (onError) {
          onError(error as Error);
        }
        throw error;
      }
    },
    [update, deleteOne, transform, onSuccess, onError]
  );

  const mutate = useCallback(
    async (resource: string, params: UpdateParams) => {
      if (mode === 'pessimistic') {
        // Wait for the update to complete, then call callbacks
        await executeMutation(resource, params, 'update');
      } else if (mode === 'optimistic') {
        // Fire update in background, show error toast on failure
        executeMutation(resource, params, 'update').catch((error) => {
          toast({
            title: 'Update failed',
            description: error.message,
            variant: 'destructive',
          });
        });
      } else {
        // Undoable mode
        const mutationId = `mutation-${++mutationCounterRef.current}`;

        const toastInstance = toast({
          title: 'Record updated',
          description: `Change will be applied in ${undoTimeout / 1000} seconds`,
          action: React.createElement(
            ToastAction,
            {
              altText: 'Undo',
              onClick: () => undo(mutationId),
            },
            'Undo'
          ),
        });

        const timeoutId = setTimeout(() => {
          pendingMutationsRef.current.delete(mutationId);
          toastInstance.dismiss();
          executeMutation(resource, params, 'update');
        }, undoTimeout);

        pendingMutationsRef.current.set(mutationId, {
          resource,
          params,
          type: 'update',
          timeoutId,
          toastId: toastInstance.id,
        });
      }
    },
    [mode, undoTimeout, executeMutation, undo]
  );

  const deleteMutate = useCallback(
    async (resource: string, params: DeleteParams) => {
      if (mode === 'pessimistic') {
        // Wait for the delete to complete, then call callbacks
        await executeMutation(resource, params, 'delete');
      } else if (mode === 'optimistic') {
        // Fire delete in background, show error toast on failure
        executeMutation(resource, params, 'delete').catch((error) => {
          toast({
            title: 'Delete failed',
            description: error.message,
            variant: 'destructive',
          });
        });
      } else {
        // Undoable mode
        const mutationId = `mutation-${++mutationCounterRef.current}`;

        const toastInstance = toast({
          title: 'Record deleted',
          description: `Change will be applied in ${undoTimeout / 1000} seconds`,
          action: React.createElement(
            ToastAction,
            {
              altText: 'Undo',
              onClick: () => undo(mutationId),
            },
            'Undo'
          ),
        });

        const timeoutId = setTimeout(() => {
          pendingMutationsRef.current.delete(mutationId);
          toastInstance.dismiss();
          executeMutation(resource, params, 'delete');
        }, undoTimeout);

        pendingMutationsRef.current.set(mutationId, {
          resource,
          params,
          type: 'delete',
          timeoutId,
          toastId: toastInstance.id,
        });
      }
    },
    [mode, undoTimeout, executeMutation, undo]
  );

  return {
    mutate,
    deleteMutate,
    undoPending: pendingMutationsRef.current,
    undo,
  };
}

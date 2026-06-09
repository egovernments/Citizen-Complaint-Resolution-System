import React from 'react';
import type { RaRecord } from 'ra-core';
import { TableCell } from '../primitives/table';
import { InlineDelete } from './InlineDelete';
import type { MutationMode } from '../columns/types';

export interface RowActionsProps<T extends RaRecord = RaRecord> {
  record: T;
  onDelete?: (record: T) => Promise<void> | void;
  noDelete?: boolean;
  mutationMode?: MutationMode;
}

export const RowActions = <T extends RaRecord = RaRecord>({
  record,
  onDelete,
  noDelete = false,
  mutationMode = 'pessimistic',
}: RowActionsProps<T>) => {
  const handleDelete = async () => {
    if (onDelete) {
      await onDelete(record);
    }
  };

  return (
    <TableCell className="w-[50px] opacity-0 group-hover/row:opacity-100 transition-opacity">
      <div className="flex items-center gap-1">
        {!noDelete && onDelete && (
          <InlineDelete
            itemName="record"
            onConfirm={handleDelete}
            mutationMode={mutationMode}
          />
        )}
      </div>
    </TableCell>
  );
};

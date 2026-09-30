import React from 'react';
import {
  generateColumns as baseGenerateColumns,
  type SchemaDefinition,
  type RefMapEntry,
  type DigitColumn,
} from '@digit-ui/datagrid';
import { EntityLink } from '@/components/ui/EntityLink';
import { StatusChip } from '@/admin/fields';
import { DUPLICATE_ACTIVE_KEYS } from '@/providers/bridge';

// Re-export types and pure functions from the package
export {
  getRefMap,
  orderFields,
  groupShowFields,
  formatFieldLabel,
  generateFilterElements,
} from '@digit-ui/datagrid';

export type {
  SchemaDefinition,
  SchemaProperty,
  RefSchemaEntry,
  RefMapEntry,
  ShowFieldGroups,
} from '@digit-ui/datagrid';

/**
 * App-level wrapper for generateColumns that auto-injects EntityLink
 * as the renderRef callback, and overrides boolean column rendering
 * with a `StatusChip` so list pages show the value at a glance.
 *
 * Why the override: the package's default boolean rendering puts the
 * column into inline-edit mode, which renders just a bare `<Switch>`
 * toggle with no text label. On the Gender Types list page (and any
 * other generic master with an `active: boolean` field) operators
 * couldn't tell which rows were enabled without opening each one
 * (egovernments/CCRS#483 follow-up — Gurjeet flagged it on the
 * Gender Types list specifically). Replacing the inline toggle with
 * a "Yes"/"No" `StatusChip` makes the state legible. (A boolean
 * `active`/`isActive` is dropped instead: it duplicates the root isActive
 * that the master DigitDatagrid shows as Active/Inactive.) Inline-editing is dropped on the list page for boolean
 * cells; users edit through the row's dedicated Edit form, which
 * Chakshu's #46 fix already wired up correctly.
 */
function withStatusChipForBooleans(columns: DigitColumn[]): DigitColumn[] {
  const isBooleanColumn = (col: DigitColumn): boolean =>
    typeof col.editable === 'object' && col.editable?.type === 'boolean';
  return (
    columns
      // A boolean `active`/`isActive` duplicates the record's root isActive,
      // which the master DigitDatagrid already shows as the Status column. A
      // second status column could disagree with it, so drop it.
      .filter((col) => !(isBooleanColumn(col) && DUPLICATE_ACTIVE_KEYS.includes(col.source)))
      .map((col) => {
        if (!isBooleanColumn(col) || col.render) return col;
        return {
          ...col,
          // Drop inline-editable so the chip is shown instead of the bare
          // toggle. The Edit page remains the canonical way to flip the flag.
          editable: undefined,
          render: (record) =>
            React.createElement(StatusChip, {
              value: (record as Record<string, unknown>)[col.source],
              labels: { true: 'Yes', false: 'No' },
            }),
        };
      })
  );
}

export function generateColumns(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>
): DigitColumn[] {
  const base = baseGenerateColumns(schema, refMap, (resource, id) =>
    React.createElement(EntityLink, { resource, id })
  );
  return withStatusChipForBooleans(base);
}

import React from 'react';
import {
  generateColumns as baseGenerateColumns,
  type SchemaDefinition,
  type RefMapEntry,
  type DigitColumn,
} from '@digit-ui/datagrid';
import { EntityLink } from '@/components/ui/EntityLink';
import { StatusChip } from '@/admin/fields';

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
 * a `StatusChip` ("Active"/"Inactive" or "Yes"/"No") makes the state
 * legible. Inline-editing is dropped on the list page for boolean
 * cells; users edit through the row's dedicated Edit form, which
 * Chakshu's #46 fix already wired up correctly.
 */
function withStatusChipForBooleans(columns: DigitColumn[]): DigitColumn[] {
  return columns.map((col) => {
    const isBoolean =
      typeof col.editable === 'object' && col.editable?.type === 'boolean';
    if (!isBoolean || col.render) return col;
    // Pick a tighter label for the canonical "active" / "isActive" flag;
    // fall back to Yes/No for any other boolean field so the chip stays
    // readable for non-status flags.
    const isActiveField =
      col.source === 'active' || col.source === 'isActive';
    const labels = isActiveField
      ? { true: 'Active', false: 'Inactive' }
      : { true: 'Yes', false: 'No' };
    return {
      ...col,
      // Drop inline-editable so the chip is shown instead of the bare
      // toggle. The Edit page remains the canonical way to flip the flag.
      editable: undefined,
      render: (record) =>
        React.createElement(StatusChip, {
          value: (record as Record<string, unknown>)[col.source],
          labels,
        }),
    };
  });
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

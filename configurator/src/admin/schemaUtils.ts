import React from 'react';
import {
  generateColumns as baseGenerateColumns,
  type SchemaDefinition,
  type RefMapEntry,
  type DigitColumn,
} from '@digit-ui/datagrid';
import { EntityLink } from '@/components/ui/EntityLink';
import { StatusChip, ListWidgetCell } from '@/admin/fields';
import type { ListWidgetKind, SchemaDescriptor } from './schemaDescriptors';

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

/**
 * Apply a schema descriptor's `listWidget` choices to generated list columns.
 *
 * Two things happen per matched column, and the second matters as much as the
 * first: the cell gets the descriptor's renderer, AND `editable` is cleared.
 * The package's column builder makes every non-key field inline-editable, which
 * turns an `enum` column into a live <select> in every row — that is how the
 * Channels list came to offer the SMS-only `smscountry` gateway on the EMAIL and
 * WHATSAPP rows. Editing belongs in the row's own form, where the save guard
 * runs.
 *
 * Columns the descriptor says nothing about are returned untouched, so a
 * resource with no `listWidget` anywhere keeps exactly the list it has today.
 */
export function applyDescriptorListWidgets(
  columns: DigitColumn[],
  descriptor: SchemaDescriptor | undefined
): DigitColumn[] {
  if (!descriptor) return columns;
  const byPath = new Map<string, ListWidgetKind>();
  for (const field of descriptor.fields) {
    if (field.listWidget) byPath.set(field.path, field.listWidget);
  }
  if (byPath.size === 0) return columns;
  return columns.map((col) => {
    const kind = byPath.get(col.source);
    if (!kind) return col;
    return {
      ...col,
      editable: undefined,
      render: (record) =>
        React.createElement(ListWidgetCell, {
          kind,
          value: (record as Record<string, unknown>)[col.source],
        }),
    };
  });
}

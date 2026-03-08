import React from 'react';
import {
  generateColumns as baseGenerateColumns,
  type SchemaDefinition,
  type RefMapEntry,
  type DigitColumn,
} from '@digit-ui/datagrid';
import { EntityLink } from '@/components/ui/EntityLink';

// Re-export types and pure functions from the package
export {
  getRefMap,
  orderFields,
  groupShowFields,
  formatFieldLabel,
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
 * as the renderRef callback. The package version uses a callback pattern;
 * this wrapper preserves the original 2-arg API for backward compatibility.
 */
export function generateColumns(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>
): DigitColumn[] {
  return baseGenerateColumns(schema, refMap, (resource, id) =>
    React.createElement(EntityLink, { resource, id })
  );
}

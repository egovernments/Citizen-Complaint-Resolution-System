import React from 'react';
import type { DigitColumn } from './types';
import {
  SearchFilterInput,
  TextFilterInput,
  SelectFilterInput,
  NullableBooleanFilterInput,
  DateFilterInput,
  ReferenceFilterInput,
} from '../filters';

// --- Types ---

export interface SchemaProperty {
  type?: string;
  format?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  enum?: unknown[];
  description?: string;
}

export interface RefSchemaEntry {
  fieldPath: string;
  schemaCode: string;
}

export interface SchemaDefinition {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  'x-unique'?: string[];
  'x-ref-schema'?: RefSchemaEntry[];
}

export interface RefMapEntry {
  schemaCode: string;
  resource: string;
}

export interface ShowFieldGroups {
  key: string[];
  details: string[];
  optional: string[];
  complex: string[];
}

// --- Pure Functions ---

/**
 * Build a map of fieldPath → { schemaCode, resource } from x-ref-schema.
 * Uses `resourceLookup` to resolve schema codes to react-admin resource names.
 * Entries where the resource can't be found are omitted.
 */
export function getRefMap(
  schema: SchemaDefinition,
  resourceLookup: (schemaCode: string) => string | undefined
): Record<string, RefMapEntry> {
  const refs = schema['x-ref-schema'];
  if (!refs || !Array.isArray(refs)) return {};

  const map: Record<string, RefMapEntry> = {};
  for (const ref of refs) {
    const resource = resourceLookup(ref.schemaCode);
    if (resource) {
      map[ref.fieldPath] = { schemaCode: ref.schemaCode, resource };
    }
  }
  return map;
}

/**
 * Order fields from a schema definition:
 * 1. x-unique fields (primary keys)
 * 2. required fields (not in x-unique)
 * 3. optional fields (not required, not x-unique)
 */
export function orderFields(schema: SchemaDefinition): string[] {
  const props = schema.properties ?? {};
  const allFields = Object.keys(props);
  const unique = new Set(schema['x-unique'] ?? []);
  const required = new Set(schema.required ?? []);

  // Use x-unique array order (not properties insertion order)
  const uniqueFields = (schema['x-unique'] ?? []).filter((f) => f in props);
  // Use required array order for required fields
  const requiredFields = (schema.required ?? []).filter((f) => !unique.has(f) && f in props);
  const optionalFields = allFields.filter((f) => !required.has(f) && !unique.has(f));

  return [...uniqueFields, ...requiredFields, ...optionalFields];
}

function isComplexType(prop: SchemaProperty): boolean {
  return prop.type === 'array' || prop.type === 'object';
}

/**
 * Generate DigitColumn[] from a schema definition for List view.
 * - Orders by x-unique → required → optional
 * - Skips array/object fields
 * - Caps at 8 columns
 * - Optionally adds ref render via renderRef callback
 */
export function generateColumns(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>,
  renderRef?: (resource: string, id: string) => React.ReactNode
): DigitColumn[] {
  const props = schema.properties ?? {};
  const ordered = orderFields(schema);
  const unique = new Set(schema['x-unique'] ?? []);

  const columns: DigitColumn[] = [];

  for (const fieldName of ordered) {
    if (columns.length >= 8) break;

    const prop = props[fieldName];
    if (!prop || isComplexType(prop)) continue;

    const col: DigitColumn = {
      source: fieldName,
      label: formatFieldLabel(fieldName),
    };

    // Add ref renderer if callback provided
    const ref = refMap[fieldName];
    if (ref) {
      if (renderRef) {
        col.render = (record) => {
          const value = (record as Record<string, unknown>)[fieldName];
          if (value == null || value === '') return React.createElement('span', { className: 'text-muted-foreground' }, '--');
          return renderRef(ref.resource, String(value));
        };
      }
    }

    // Auto-set editable for non-key fields
    if (!unique.has(fieldName)) {
      if (ref) {
        // Reference fields: editable as dropdown
        col.editable = { type: 'reference', reference: ref.resource, displayField: 'name' };
      } else if (prop.type === 'boolean') {
        col.editable = { type: 'boolean' };
      } else if (prop.format === 'date' || prop.format === 'date-time') {
        col.editable = { type: 'date' };
      } else if (prop.enum && Array.isArray(prop.enum)) {
        col.editable = {
          type: 'select',
          options: prop.enum.map((v) => ({ value: String(v), label: String(v) })),
        };
      } else if (prop.type === 'number' || prop.type === 'integer') {
        col.editable = { type: 'number' };
      } else {
        col.editable = true;
      }
    }

    columns.push(col);
  }

  return columns;
}

/**
 * Group fields into sections for Show view:
 * - key: x-unique fields
 * - details: required fields (not in x-unique), non-complex
 * - optional: non-required, non-complex
 * - complex: array or object type fields
 */
export function groupShowFields(schema: SchemaDefinition): ShowFieldGroups {
  const props = schema.properties ?? {};
  const allFields = Object.keys(props);
  const unique = new Set(schema['x-unique'] ?? []);
  const required = new Set(schema.required ?? []);

  const groups: ShowFieldGroups = { key: [], details: [], optional: [], complex: [] };

  // Key fields: use x-unique array order (not properties insertion order)
  groups.key = (schema['x-unique'] ?? []).filter((f) => f in props && !isComplexType(props[f]));

  // Details: use required array order
  groups.details = (schema.required ?? []).filter(
    (f) => !unique.has(f) && f in props && !isComplexType(props[f])
  );

  // Optional and complex: use properties order
  for (const field of allFields) {
    const prop = props[field];
    if (!prop || unique.has(field) || required.has(field)) continue;

    if (isComplexType(prop)) {
      groups.complex.push(field);
    } else {
      groups.optional.push(field);
    }
  }

  // Complex fields from unique/required that are array/object
  for (const field of allFields) {
    const prop = props[field];
    if (!prop) continue;
    if ((unique.has(field) || required.has(field)) && isComplexType(prop)) {
      groups.complex.push(field);
    }
  }

  return groups;
}

/**
 * Convert a field name to a human-readable label.
 * camelCase → Title Case, snake_case → Title Case
 */
export function formatFieldLabel(fieldName: string): string {
  return fieldName
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (s) => s.toUpperCase());
}

/**
 * Auto-generate filter elements from a schema definition.
 * Rules:
 * - Always prepend SearchFilterInput source="q" alwaysOn
 * - x-unique fields: skip
 * - enum fields: SelectFilterInput (alwaysOn if required)
 * - boolean fields: NullableBooleanFilterInput (alwaysOn if required)
 * - x-ref-schema fields: ReferenceFilterInput (alwaysOn if required)
 * - date/date-time: DateFilterInput
 * - Required string fields: TextFilterInput (max 2)
 */
export function generateFilterElements(
  schema: SchemaDefinition,
  refMap: Record<string, RefMapEntry>
): React.ReactElement[] {
  const props = schema.properties ?? {};
  const unique = new Set(schema['x-unique'] ?? []);
  const required = new Set(schema.required ?? []);

  const elements: React.ReactElement[] = [
    React.createElement(SearchFilterInput, { key: 'q', source: 'q', alwaysOn: true }),
  ];

  let textCount = 0;

  for (const [fieldName, prop] of Object.entries(props)) {
    if (unique.has(fieldName)) continue;

    const isRequired = required.has(fieldName);
    const label = formatFieldLabel(fieldName);
    const ref = refMap[fieldName];

    if (prop.enum && Array.isArray(prop.enum)) {
      const choices = prop.enum.map((v: unknown) => ({
        id: String(v),
        name: String(v),
      }));
      elements.push(
        React.createElement(SelectFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
          choices,
          alwaysOn: isRequired,
        })
      );
    } else if (prop.type === 'boolean') {
      elements.push(
        React.createElement(NullableBooleanFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
          alwaysOn: isRequired,
        })
      );
    } else if (ref) {
      elements.push(
        React.createElement(ReferenceFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
          reference: ref.resource,
          alwaysOn: isRequired,
        })
      );
    } else if (prop.format === 'date' || prop.format === 'date-time') {
      elements.push(
        React.createElement(DateFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
        })
      );
    } else if (isRequired && prop.type === 'string' && textCount < 2) {
      textCount++;
      elements.push(
        React.createElement(TextFilterInput, {
          key: fieldName,
          source: fieldName,
          label,
        })
      );
    }
  }

  return elements;
}

import { useMemo } from 'react';
import { DigitCreate } from './DigitCreate';
import { DigitFormInput } from './DigitFormInput';
import { useResourceContext, useInput, required } from 'ra-core';
import { getResourceConfig, getResourceLabel } from '@/providers/bridge';
import { useSchemaDefinition } from '@/hooks/useSchemaDefinition';
import { orderFields, formatFieldLabel } from './schemaUtils';
import { Label } from '@/components/ui/label';
import type { SchemaDefinition, SchemaProperty } from './schemaUtils';

/** Derive HTML input type from JSON Schema property */
function inputType(prop: SchemaProperty): string {
  if (prop.type === 'number' || prop.type === 'integer') return 'number';
  if (prop.format === 'email') return 'email';
  return 'text';
}

/** Check if a property is a complex type (array/object) */
function isComplex(prop: SchemaProperty): boolean {
  return prop.type === 'array' || prop.type === 'object';
}

/** Build default record values from schema */
function buildDefaults(definition: SchemaDefinition): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const props = definition.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.type === 'boolean') {
      defaults[key] = key === 'active' ? true : false;
    }
  }
  return defaults;
}

/** Count required complex fields that won't appear in the form */
function getMissingComplexFields(definition: SchemaDefinition): string[] {
  const requiredSet = new Set(definition.required ?? []);
  const props = definition.properties ?? {};
  const missing: string[] = [];
  for (const [key, prop] of Object.entries(props)) {
    if (requiredSet.has(key) && isComplex(prop)) {
      missing.push(key);
    }
  }
  return missing;
}

/** Simple boolean checkbox input for react-admin forms */
function BooleanInput({ source, label }: { source: string; label: string }) {
  const { id, field } = useInput({ source, parse: (v: boolean) => v });
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={!!field.value}
        onChange={(e) => field.onChange(e.target.checked)}
        onBlur={field.onBlur}
        className="h-4 w-4 rounded border-gray-300"
      />
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </Label>
    </div>
  );
}

function MdmsCreateFields({ definition }: { definition: SchemaDefinition }) {
  const requiredSet = useMemo(() => new Set(definition.required ?? []), [definition]);
  const ordered = useMemo(() => orderFields(definition), [definition]);
  const missingComplex = useMemo(() => getMissingComplexFields(definition), [definition]);
  const props = definition.properties ?? {};

  return (
    <>
      {ordered.map((field) => {
        const prop = props[field];
        if (!prop || isComplex(prop)) return null;

        if (prop.type === 'boolean') {
          return <BooleanInput key={field} source={field} label={formatFieldLabel(field)} />;
        }

        return (
          <DigitFormInput
            key={field}
            source={field}
            label={formatFieldLabel(field)}
            type={inputType(prop)}
            validate={requiredSet.has(field) ? required() : undefined}
          />
        );
      })}
      {missingComplex.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Note: This schema also requires {missingComplex.map(f => formatFieldLabel(f)).join(', ')} (complex fields) which must be added via API.
        </p>
      )}
    </>
  );
}

export function MdmsResourceCreate() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);
  const { definition } = useSchemaDefinition(config?.schema);

  const defaults = useMemo(() => {
    if (!definition) return undefined;
    return buildDefaults(definition);
  }, [definition]);

  if (!definition) {
    return (
      <DigitCreate title={`Create ${label}`}>
        <p className="text-muted-foreground">Loading schema...</p>
      </DigitCreate>
    );
  }

  return (
    <DigitCreate title={`Create ${label}`} record={defaults}>
      <MdmsCreateFields definition={definition} />
    </DigitCreate>
  );
}

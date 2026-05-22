import { useMemo } from 'react';
import { DigitCreate } from './DigitCreate';
import { DigitFormInput } from './DigitFormInput';
import { WidgetForFieldSpec } from './widgets';
import { useResourceContext, useInput, required } from 'ra-core';
import { getResourceConfig, getResourceLabel } from '@/providers/bridge';
import { useSchemaDefinition } from '@/hooks/useSchemaDefinition';
import { orderFields, formatFieldLabel } from './schemaUtils';
import { Label } from '@/components/ui/label';
import { getDescriptor } from './schemaDescriptors';
import type { SchemaDescriptor } from './schemaDescriptors/types';
import type { SchemaDefinition, SchemaProperty } from './schemaUtils';

function inputType(prop: SchemaProperty): string {
  if (prop.type === 'number' || prop.type === 'integer') return 'number';
  if (prop.format === 'email') return 'email';
  return 'text';
}

function isComplex(prop: SchemaProperty): boolean {
  return prop.type === 'array' || prop.type === 'object';
}

function buildDefaults(definition: SchemaDefinition): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const props = definition.properties ?? {};
  for (const [key, prop] of Object.entries(props)) {
    if (prop.type === 'boolean') defaults[key] = key === 'active' ? true : false;
  }
  return defaults;
}

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

function MdmsCreateFields({
  definition,
  descriptor,
}: {
  definition: SchemaDefinition;
  descriptor?: SchemaDescriptor;
}) {
  const requiredSet = useMemo(() => new Set(definition.required ?? []), [definition]);
  const ordered = useMemo(() => orderFields(definition), [definition]);
  const props = definition.properties ?? {};

  // 1. Render descriptor-defined fields first (includes nested paths the JSON
  //    Schema skips as "complex objects").
  const descriptorPaths = new Set(descriptor?.fields.map((f) => f.path) ?? []);
  const groupedOrder = descriptor?.groups?.flatMap((g) => g.fields) ?? [];
  const descriptorFields = descriptor
    ? [...groupedOrder, ...(descriptor.fields.map((f) => f.path).filter((p) => !groupedOrder.includes(p)))]
    : [];

  return (
    <>
      {/* descriptor-defined widgets */}
      {descriptorFields.map((path) => {
        const spec = descriptor?.fields.find((f) => f.path === path);
        if (!spec || spec.hidden === 'create' || spec.hidden === 'always') return null;
        return <WidgetForFieldSpec key={path} spec={spec} source={path} />;
      })}

      {/* JSON-Schema-driven scalar fallbacks for anything the descriptor didn't cover */}
      {ordered.map((field) => {
        if (descriptorPaths.has(field)) return null;
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
    </>
  );
}

export function MdmsResourceCreate() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);
  const { definition } = useSchemaDefinition(config?.schema);
  const descriptor = getDescriptor(config?.schema);

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
      <MdmsCreateFields definition={definition} descriptor={descriptor} />
    </DigitCreate>
  );
}

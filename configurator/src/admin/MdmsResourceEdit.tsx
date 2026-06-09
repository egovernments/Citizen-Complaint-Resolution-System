import { DigitEdit } from './DigitEdit';
import { DigitFormInput } from './DigitFormInput';
import { BooleanInput } from './widgets/BooleanInput';
import { WidgetForFieldSpec } from './widgets';
import { useEditContext, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceLabel } from '@/providers/bridge';
import { getDescriptor } from './schemaDescriptors';
import { customEditors } from './themeEditor';

function MdmsEditFields() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const idField = config?.idField ?? 'id';
  const descriptor = getDescriptor(config?.schema);
  const { record } = useEditContext();

  if (!record) return null;

  // 1. Render descriptor-defined fields first (including nested paths).
  const descriptorPaths = new Set(descriptor?.fields.map((f) => f.path) ?? []);
  const groupedOrder = descriptor?.groups?.flatMap((g) => g.fields) ?? [];
  const descriptorFields = descriptor
    ? [...groupedOrder, ...(descriptor.fields.map((f) => f.path).filter((p) => !groupedOrder.includes(p)))]
    : [];

  // 2. Fall back to the existing generic loop for everything else.
  const topLevelKeys = Object.keys(record as Record<string, unknown>)
    .filter((k) => !k.startsWith('_') && k !== 'id')
    .filter((k) => !descriptorPaths.has(k));

  return (
    <>
      {descriptorFields.map((path) => {
        const spec = descriptor?.fields.find((f) => f.path === path);
        if (!spec || spec.hidden === 'edit' || spec.hidden === 'always') return null;
        return <WidgetForFieldSpec key={path} spec={spec} source={path} />;
      })}

      {topLevelKeys.map((key) => {
        const value = (record as Record<string, unknown>)[key];
        const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
        const isId = key === idField;

        // Skip complex objects the descriptor didn't handle — same behavior as before.
        if (value != null && typeof value === 'object') return null;

        // Boolean fields must render as a checkbox so the form value stays a
        // real bool. Falling back to a text input lets operators type 'false',
        // which the MDMS JSON Schema rejects with `expected type: Boolean,
        // found: String` (closes egovernments/CCRS#483).
        if (typeof value === 'boolean') {
          return <BooleanInput key={key} source={key} label={displayKey} />;
        }

        return (
          <DigitFormInput
            key={key}
            source={key}
            label={displayKey}
            disabled={isId}
            type={typeof value === 'number' ? 'number' : 'text'}
          />
        );
      })}
    </>
  );
}

export function MdmsResourceEdit() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const descriptor = getDescriptor(config?.schema);
  const label = getResourceLabel(resource);

  // Escape hatch: if the descriptor names a custom editor, mount that instead.
  if (descriptor?.customEditor) {
    const Editor = customEditors[descriptor.customEditor];
    if (Editor) return <Editor />;
    // Fall through to the generic form if the key is missing — dev warning.
    // eslint-disable-next-line no-console
    console.warn(`[descriptor] customEditor "${descriptor.customEditor}" not registered for schema ${config?.schema}; falling back to generic form.`);
  }

  return (
    <DigitEdit title={`Edit ${label}`}>
      <MdmsEditFields />
    </DigitEdit>
  );
}

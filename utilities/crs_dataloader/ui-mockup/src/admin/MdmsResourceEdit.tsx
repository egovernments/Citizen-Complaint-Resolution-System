import { DigitEdit } from './DigitEdit';
import { DigitFormInput } from './DigitFormInput';
import { useEditContext, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceLabel } from '@/providers/bridge';

function MdmsEditFields() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const idField = config?.idField ?? 'id';
  const { record } = useEditContext();

  if (!record) return null;

  const keys = Object.keys(record as Record<string, unknown>)
    .filter((k) => !k.startsWith('_') && k !== 'id');

  return (
    <>
      {keys.map((key) => {
        const value = (record as Record<string, unknown>)[key];
        const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
        const isId = key === idField;

        // Skip complex objects for now
        if (value != null && typeof value === 'object') return null;

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
  const label = getResourceLabel(resource);

  return (
    <DigitEdit title={`Edit ${label}`}>
      <MdmsEditFields />
    </DigitEdit>
  );
}

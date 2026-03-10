import { DigitEdit, DigitFormInput } from '@/admin';

export function BoundaryEdit() {
  return (
    <DigitEdit title="Edit Boundary">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="boundaryType" label="Boundary Type" disabled />
    </DigitEdit>
  );
}

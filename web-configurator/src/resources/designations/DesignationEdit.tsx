import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function DesignationEdit() {
  return (
    <DigitEdit title="Edit Designation">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={required()} />
      <DigitFormInput source="description" label="Description" />
    </DigitEdit>
  );
}

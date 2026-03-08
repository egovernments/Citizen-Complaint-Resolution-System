import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function DepartmentEdit() {
  return (
    <DigitEdit title="Edit Department">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={required()} />
      <DigitFormInput source="description" label="Description" />
    </DigitEdit>
  );
}

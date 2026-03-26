import { DigitEdit, DigitFormInput, v } from '@/admin';

export function DepartmentEdit() {
  return (
    <DigitEdit title="Edit Department">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormInput source="description" label="Description" />
    </DigitEdit>
  );
}

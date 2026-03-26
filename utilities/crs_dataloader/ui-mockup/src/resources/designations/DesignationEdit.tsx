import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';

export function DesignationEdit() {
  return (
    <DigitEdit title="Edit Designation">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormInput source="description" label="Description" />
      <DigitFormSelect
        source="department"
        label="Department"
        reference="departments"
        placeholder="Select department..."
      />
    </DigitEdit>
  );
}

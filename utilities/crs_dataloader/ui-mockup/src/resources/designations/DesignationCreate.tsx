import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';

export function DesignationCreate() {
  return (
    <DigitCreate title="Create Designation" record={{ active: true }}>
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormCodeInput source="code" label="Code" deriveFrom="name" validate={v.codeRequired} />
      <DigitFormInput source="description" label="Description" validate={v.required} />
      <DigitFormSelect
        source="department"
        label="Department"
        reference="departments"
        placeholder="Select department..."
      />
    </DigitCreate>
  );
}

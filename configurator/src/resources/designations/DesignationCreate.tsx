import { DigitCreate, DigitFormCodeInput, DigitFormInput, v } from '@/admin';
import { BooleanInput } from '@/admin/widgets';
import { DepartmentChipInput } from './DepartmentChipInput';

export function DesignationCreate() {
  return (
    <DigitCreate title="Create Designation" record={{ active: true, department: [] }}>
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormCodeInput source="code" label="Code" deriveFrom="name" validate={v.codeRequired} />
      <DigitFormInput source="description" label="Description" validate={v.required} />
      <DepartmentChipInput
        source="department"
        label="Departments"
        help="Pick one or more. Stored as an array per the MDMS schema."
      />
      <BooleanInput source="active" label="Active" />
    </DigitCreate>
  );
}

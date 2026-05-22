import { DigitEdit, DigitFormInput, v } from '@/admin';
import { BooleanInput } from '@/admin/widgets';
import { DeactivationGuard } from '@/admin/DeactivationGuard';
import { useShowController } from 'ra-core';
import { DepartmentChipInput } from './DepartmentChipInput';

export function DesignationEdit() {
  return (
    <DigitEdit title="Edit Designation">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormInput source="description" label="Description" validate={v.required} />
      <DepartmentChipInput
        source="department"
        label="Departments"
        help="This designation can belong to multiple departments."
      />
      <BooleanInput source="active" label="Active" />
      <DeactivationGuardForDesignation />
    </DigitEdit>
  );
}

function DeactivationGuardForDesignation() {
  const { record } = useShowController();
  const code = String(record?.code ?? record?.id ?? '');
  if (!code) return null;
  return (
    <DeactivationGuard
      probes={[
        {
          label: 'employees currently holding this designation',
          resource: 'employees',
          filter: { 'assignments.designation': code },
        },
      ]}
    />
  );
}

import { DigitEdit, DigitFormInput, v } from '@/admin';
import { BooleanInput } from '@/admin/widgets';
import { DeactivationGuard } from '@/admin/DeactivationGuard';
import { useShowController } from 'ra-core';

export function DepartmentEdit() {
  // Department schema only allows {code, name, active} — see
  // DepartmentCreate for the schema vs UI mismatch we used to ship.
  return (
    <DigitEdit title="Edit Department">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <BooleanInput source="active" label="Active" />
      <DeactivationGuardForDepartment />
    </DigitEdit>
  );
}

function DeactivationGuardForDepartment() {
  // Read the record via the edit context to get the department's own code,
  // then probe for dependent designations + currently-assigned employees.
  const { record } = useShowController();
  const code = String(record?.code ?? record?.id ?? '');
  if (!code) return null;
  return (
    <DeactivationGuard
      probes={[
        {
          label: 'designations referencing this department',
          resource: 'designations',
          filter: { department: code },
        },
        {
          label: 'employees currently assigned',
          resource: 'employees',
          filter: { 'assignments.department': code },
        },
      ]}
    />
  );
}

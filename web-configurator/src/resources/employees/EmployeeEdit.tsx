import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function EmployeeEdit() {
  return (
    <DigitEdit title="Edit Employee">
      <DigitFormInput source="code" label="Employee Code" disabled />
      <DigitFormInput source="user.name" label="Name" validate={required()} />
      <DigitFormInput source="user.mobileNumber" label="Mobile Number" validate={required()} />
      <DigitFormInput source="user.gender" label="Gender" />
      <DigitFormInput source="employeeStatus" label="Employee Status" />
    </DigitEdit>
  );
}

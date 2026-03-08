import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function UserEdit() {
  return (
    <DigitEdit title="Edit User">
      <DigitFormInput source="userName" label="Username" disabled />
      <DigitFormInput source="name" label="Name" validate={required()} />
      <DigitFormInput source="mobileNumber" label="Mobile Number" />
      <DigitFormInput source="emailId" label="Email" />
      <DigitFormInput source="gender" label="Gender" />
    </DigitEdit>
  );
}

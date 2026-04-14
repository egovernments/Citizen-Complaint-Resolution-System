import { DigitCreate, DigitFormInput, DigitFormSelect, v } from '@/admin';

const GENDER_CHOICES = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'TRANSGENDER', label: 'Transgender' },
];

const defaultRecord = {
  type: 'CITIZEN',
  active: true,
  password: 'eGov@123',
  gender: 'MALE',
  roles: [{ code: 'CITIZEN', name: 'Citizen' }],
};

export function UserCreate() {
  return (
    <DigitCreate title="Create User" record={defaultRecord}>
      <DigitFormInput source="userName" label="Username" validate={v.required} />
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormInput source="mobileNumber" label="Mobile Number" validate={v.mobile} />
      <DigitFormInput source="emailId" label="Email" validate={v.emailOptional} />
      <DigitFormSelect
        source="gender"
        label="Gender"
        choices={GENDER_CHOICES}
        placeholder="Select gender..."
      />
    </DigitCreate>
  );
}

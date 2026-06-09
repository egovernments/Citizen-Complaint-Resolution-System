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

// Citizens log in with their mobile number, so the user-service userName
// must equal the mobile. Stripping a leading 0 keeps storage canonical
// (matches what /citizen/_login sends).
const transform = (data: Record<string, unknown>) => {
  const mobile = String(data.mobileNumber ?? '').replace(/^0/, '');
  return { ...data, userName: mobile, mobileNumber: mobile };
};

export function UserCreate() {
  return (
    <DigitCreate title="Create User" record={defaultRecord} transform={transform}>
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormInput
        source="mobileNumber"
        label="Mobile Number"
        validate={v.mobileKERequired}
        help="9 digits starting with 7 or 1 (e.g. 712345678). Used as the citizen's login username."
      />
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

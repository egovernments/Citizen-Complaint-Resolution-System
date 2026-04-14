import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';

const GENDER_CHOICES = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'TRANSGENDER', label: 'Transgender' },
];

const TYPE_CHOICES = [
  { value: 'CITIZEN', label: 'Citizen' },
  { value: 'EMPLOYEE', label: 'Employee' },
  { value: 'SYSTEM', label: 'System' },
];

export function UserEdit() {
  return (
    <DigitEdit title="Edit User">
      <FieldSection title="Profile">
        <div className="space-y-4">
          <DigitFormInput source="userName" label="Username" disabled />
          <DigitFormInput source="name" label="Name" validate={v.name} />
          <DigitFormInput source="mobileNumber" label="Mobile Number" validate={v.mobile} />
          <DigitFormInput source="emailId" label="Email" validate={v.emailOptional} />
          <DigitFormSelect
            source="gender"
            label="Gender"
            choices={GENDER_CHOICES}
            placeholder="Select gender..."
          />
          <DigitFormSelect
            source="type"
            label="Type"
            choices={TYPE_CHOICES}
            placeholder="Select type..."
            disabled
          />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

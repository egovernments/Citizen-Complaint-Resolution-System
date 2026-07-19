import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { useMobileValidator } from '@/admin/hrms/useMobileValidator';

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
  // Mobile rule is deployment-specific — read it from the tenant's MDMS
  // `MobileNumberValidation` master (same source UserCreate uses), NOT the
  // hardcoded 10-digit `v.mobile` regex, which rejects valid non-10-digit
  // tenant numbers (e.g. mz's 9-digit `^8[0-9]{8}$`) and blocks Save.
  const { validator: mobileValidate, rules: mobileRules } = useMobileValidator();
  return (
    <DigitEdit title="Edit User">
      <FieldSection title="Profile">
        <div className="space-y-4">
          <DigitFormInput source="userName" label="Username" disabled />
          <DigitFormInput source="name" label="Name" validate={v.name} />
          <DigitFormInput
            source="mobileNumber"
            label="Mobile Number"
            validate={mobileValidate}
            help={mobileRules.errorMessage}
          />
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

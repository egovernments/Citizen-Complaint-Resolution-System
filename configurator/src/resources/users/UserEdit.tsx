import { useWatch } from 'react-hook-form';
import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { BooleanInput } from '@/admin/widgets/BooleanInput';
import { useMobileValidator } from '@/admin/hrms/useMobileValidator';
import { useApp } from '../../App';
import { RolesEditor } from '../employees/RolesEditor';
import { dobToInput, inputToDob } from './userDob';

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

const atLeastOneRole = (value: unknown) =>
  Array.isArray(value) && value.length > 0 ? undefined : 'At least one role is required';

function InactiveNotice() {
  const active = useWatch({ name: 'active' });
  if (active !== false) return null;
  return (
    <p className="text-sm text-destructive" role="status">
      An inactive user cannot log in. Save to deactivate.
    </p>
  );
}

export function UserEdit() {
  // Mobile rule is deployment-specific — read it from the tenant's MDMS
  // `MobileNumberValidation` master (same source UserCreate uses), NOT the
  // hardcoded 10-digit `v.mobile` regex, which rejects valid non-10-digit
  // tenant numbers (e.g. mz's 9-digit `^8[0-9]{8}$`) and blocks Save.
  const { validator: mobileValidate, rules: mobileRules } = useMobileValidator();
  const { state } = useApp();
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
          <DigitFormInput source="dob" label="Date of Birth" type="date" format={dobToInput} parse={inputToDob} />
          <DigitFormInput
            source="photo"
            label="Photo (file store id)"
            help="The file store id of the user's photo; leave empty for none."
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
      <FieldSection title="Access">
        <div className="space-y-4">
          <BooleanInput source="active" label="Active" help="Unchecked: the user can no longer log in." />
          <InactiveNotice />
          <RolesEditor source="roles" tenantId={state.tenant} validate={atLeastOneRole} />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

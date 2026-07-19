import { useTranslate } from 'ra-core';
import { DigitCreate, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useMobileValidator } from '@/admin/hrms/useMobileValidator';

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
  // Citizen mobile rule is deployment-specific — read it from the tenant's
  // MDMS `MobileNumberValidation` master (with globalConfigs CORE_MOBILE_CONFIGS
  // fallback), the same source EmployeeCreate/EmployeeEdit/ComplaintCreate use.
  // No hardcoded per-country regex here.
  const { validator: mobileValidate, rules: mobileRules } = useMobileValidator();
  const translate = useTranslate();
  const loginUsernameHelp = translate('app.fields.mobile_login_username_help', {
    _: "Used as the citizen's login username.",
  });

  return (
    <DigitCreate title="Create User" record={defaultRecord} transform={transform}>
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormInput
        source="mobileNumber"
        label="Mobile Number"
        validate={mobileValidate}
        maxLength={mobileRules.maxLength}
        help={loginUsernameHelp}
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

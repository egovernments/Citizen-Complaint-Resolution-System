import { DigitCreate, DigitFormInput, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { LocalityPicker } from './LocalityPicker';
import { useMobileValidator } from '@/admin/hrms/useMobileValidator';
import { ComplaintHierarchyCascade } from './ComplaintHierarchyCascade';
import { useApp } from '../../App';

export function ComplaintCreate() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const { validator: mobileValidate, rules: mobileRules } = useMobileValidator();

  const transform = (data: Record<string, unknown>): Record<string, unknown> => {
    // Citizen must be stamped at the state tenant (user-service upserts
    // CITIZEN-type users by mobileNumber at the state level).
    const citizenInput = (data.citizen as Record<string, unknown> | undefined) ?? {};
    const mobile = typeof citizenInput.mobileNumber === 'string' ? citizenInput.mobileNumber.trim() : '';
    const stateTenant = tenantId.split('.')[0];
    const citizen = mobile
      ? {
          name: typeof citizenInput.name === 'string' && citizenInput.name ? citizenInput.name : mobile,
          mobileNumber: mobile,
          emailId: typeof citizenInput.emailId === 'string' ? citizenInput.emailId : undefined,
          type: 'CITIZEN',
          tenantId: stateTenant,
          roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: stateTenant }],
        }
      : undefined;
    return { ...data, citizen };
  };

  return (
    <DigitCreate title="File Complaint" record={{}} transform={transform} redirect="show">
      <FieldSection title="Complaint">
        <div className="space-y-4">
          <ComplaintHierarchyCascade
            source="serviceCode"
            label="Complaint Type"
            validate={v.required}
          />
          <DigitFormInput
            source="description"
            label="Description"
            validate={[v.required, v.minLength(10)]}
            help="What happened? Minimum 10 characters."
          />
          <LocalityPicker
            source="address.locality.code"
            label="Locality"
            required
            help="Cascades from hierarchy → boundary type → locality."
          />
          <DigitFormInput source="address.landmark" label="Landmark" />
          <DigitFormInput source="address.pincode" label="Pincode" validate={v.postalCodeKE} />
        </div>
      </FieldSection>

      <FieldSection title="Citizen">
        <div className="space-y-4">
          <DigitFormInput
            source="citizen.mobileNumber"
            label="Mobile number"
            validate={mobileValidate}
            maxLength={mobileRules.maxLength}
            help={mobileRules.errorMessage}
          />
          <DigitFormInput
            source="citizen.name"
            label="Name"
            help="Optional. Defaults to the mobile number if left blank."
          />
          <DigitFormInput
            source="citizen.emailId"
            label="Email"
            type="email"
            validate={v.emailOptional}
          />
        </div>
      </FieldSection>
    </DigitCreate>
  );
}

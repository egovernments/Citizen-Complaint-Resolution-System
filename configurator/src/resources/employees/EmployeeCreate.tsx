import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { DEFAULT_PASSWORD } from '@/api/config';
import { useMobileValidator } from '@/admin/hrms/useMobileValidator';
import { useApp } from '../../App';
import { RolesEditor } from './RolesEditor';
import { JurisdictionEditor } from './JurisdictionEditor';
import { AssignmentEditor } from './AssignmentEditor';

const GENDER_CHOICES = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'TRANSGENDER', label: 'Transgender' },
];

const STATUS_CHOICES = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'RETIRED', label: 'Retired' },
];

const TYPE_CHOICES = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'TEMPORARY', label: 'Temporary' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'DEPUTATION', label: 'Deputation' },
];

function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

export function EmployeeCreate() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const { validator: mobileValidate, rules: mobileRules } = useMobileValidator();

  const defaults = {
    tenantId,
    employeeType: 'PERMANENT',
    employeeStatus: 'EMPLOYED',
    user: {
      type: 'EMPLOYEE',
      active: true,
      gender: 'MALE',
      password: DEFAULT_PASSWORD,
      tenantId,
      roles: [],
    },
    jurisdictions: [],
    assignments: [],
  };

  const transform = (data: Record<string, unknown>): Record<string, unknown> => {
    // Prefer the form-picked tenantId over the session tenant. The outer
    // closure `tenantId` is the session tenant (e.g. root `ke` for ADMIN);
    // letting it shadow `data.tenantId` here was the reason every Create
    // landed in the session tenant no matter which tenant the operator
    // picked in the form. The dataProvider already reads `data.tenantId`
    // correctly (PR #31) — this transform was silently clobbering the
    // form value before it ever reached the provider.
    const targetTenantId =
      typeof data.tenantId === 'string' && data.tenantId.trim()
        ? data.tenantId.trim()
        : tenantId;

    const userInput = (data.user as Record<string, unknown> | undefined) ?? {};
    const user = {
      ...userInput,
      userName: '',  // HRMS enrichUser() overwrites with employee code
      tenantId: targetTenantId,
      type: 'EMPLOYEE',
      active: true,
      password: typeof userInput.password === 'string' && userInput.password ? userInput.password : DEFAULT_PASSWORD,
      dob: toEpochMs(userInput.dob),
    };

    // Leave a blank Date of Appointment blank. Stamping `Date.now()` here used
    // to be harmless because the field was mandatory; now that it isn't, the
    // default would silently invent an appointment date the operator never
    // entered — and one that HRMS then enforces as a floor on every
    // assignment's fromDate (HRMS_INVALID_ASSIGNMENT_DATES_APPOINTMENT),
    // rejecting any backdated assignment. `undefined` is dropped from the JSON
    // body, and egov-hrms skips both DOA rules when the field is absent.
    const doa = toEpochMs(data.dateOfAppointment);

    return {
      ...data,
      tenantId: targetTenantId,
      dateOfAppointment: doa,
      user,
    };
  };

  return (
    <DigitCreate title="Create Employee" record={defaults} transform={transform}>
      <FieldSection title="Tenant">
        <DigitFormSelect
          source="tenantId"
          label="Tenant"
          reference="tenants"
          optionValue="code"
          optionText="code"
          validate={v.codeRequired}
          placeholder="Select tenant"
          help="Employee is created on this tenant — must match the login subdomain (the city tenant code, e.g. <root>.<city>)."
        />
      </FieldSection>

      <FieldSection title="Employee Info">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DigitFormInput source="user.name" label="Name" validate={v.name} />
          <DigitFormCodeInput
            source="code"
            label="Employee Code"
            deriveFrom="user.name"
            validate={v.codeRequired}
          />
          <DigitFormInput
            source="user.mobileNumber"
            label="Mobile Number"
            validate={mobileValidate}
            maxLength={mobileRules.maxLength}
            help={mobileRules.errorMessage}
          />
          <DigitFormInput source="user.emailId" label="Email" type="email" validate={v.emailOptional} />
          {/* DOB and Date of Appointment are optional — Edit already lets an
              operator clear both and save, so requiring them here only made the
              two screens disagree (egovernments/CCRS#1949). egov-hrms treats both
              as nullable: every DOB / DOA rule in EmployeeValidator is guarded by
              a null check, and the Employee POJO carries no @NotNull on
              dateOfAppointment. `dateInPast` keeps the "no future DOB" rule for a
              value that IS supplied, without marking the field required. */}
          <DigitFormInput source="user.dob" label="Date of Birth" type="date" validate={v.dateInPast} />
          <DigitFormSelect
            source="user.gender"
            label="Gender"
            choices={GENDER_CHOICES}
            placeholder="Select gender..."
          />
          <DigitFormInput source="dateOfAppointment" label="Date of Appointment" type="date" />
          <DigitFormSelect
            source="employeeStatus"
            label="Employee Status"
            choices={STATUS_CHOICES}
            placeholder="Select status..."
          />
          <DigitFormSelect
            source="employeeType"
            label="Employee Type"
            choices={TYPE_CHOICES}
            placeholder="Select type..."
          />
        </div>
      </FieldSection>

      <FieldSection title="Roles">
        <RolesEditor tenantId={tenantId} help="Pick one or more. GRO, DGRO, PGR_LME, CSR are typical for PGR." />
      </FieldSection>

      <FieldSection title="Assignments">
        <AssignmentEditor help="At least one assignment must be marked current." />
      </FieldSection>

      <FieldSection title="Jurisdictions">
        <JurisdictionEditor tenantId={tenantId} help="Areas this employee is responsible for." />
      </FieldSection>

      <FieldSection title="Account Password">
        <DigitFormInput
          source="user.password"
          label="Initial Password"
          help="Defaults to eGov@123. Employee should rotate on first login."
        />
      </FieldSection>
    </DigitCreate>
  );
}

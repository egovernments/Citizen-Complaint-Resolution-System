import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';

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

const defaults = {
  employeeType: 'PERMANENT',
  employeeStatus: 'EMPLOYED',
  user: { type: 'EMPLOYEE', gender: 'MALE', roles: [{ code: 'EMPLOYEE', name: 'Employee' }] },
  jurisdictions: [{ hierarchy: 'ADMIN', boundaryType: 'City', boundary: '' }],
  assignments: [{ department: 'DEPT_1', designation: 'DESG_1', fromDate: Date.now(), isCurrentAssignment: true }],
};

export function EmployeeCreate() {
  return (
    <DigitCreate title="Create Employee" record={defaults}>
      <DigitFormInput source="user.name" label="Name" validate={v.name} />
      <DigitFormCodeInput source="code" label="Employee Code" deriveFrom="user.name" validate={v.codeRequired} />
      <DigitFormInput source="user.mobileNumber" label="Mobile Number" validate={v.mobileRequired} />
      <DigitFormInput
        source="user.dob"
        label="Date of Birth"
        type="date"
        validate={v.required}
        parse={(v: string) => v ? new Date(v).getTime() : null}
        format={(v: number) => v ? new Date(v).toISOString().split('T')[0] : ''}
      />
      <DigitFormSelect
        source="user.gender"
        label="Gender"
        choices={GENDER_CHOICES}
        placeholder="Select gender..."
      />
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
    </DigitCreate>
  );
}

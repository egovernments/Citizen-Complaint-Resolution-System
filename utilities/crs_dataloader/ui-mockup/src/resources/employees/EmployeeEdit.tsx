import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';

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

const HIERARCHY_CHOICES = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'REVENUE', label: 'Revenue' },
  { value: 'ELECTION', label: 'Election' },
];

const BOUNDARY_TYPE_CHOICES = [
  { value: 'City', label: 'City' },
  { value: 'Ward', label: 'Ward' },
  { value: 'Locality', label: 'Locality' },
  { value: 'Block', label: 'Block' },
];

export function EmployeeEdit() {
  return (
    <DigitEdit title="Edit Employee">
      <FieldSection title="Employee Info">
        <div className="space-y-4">
          <DigitFormInput source="code" label="Employee Code" disabled />
          <DigitFormInput source="user.name" label="Name" validate={v.name} />
          <DigitFormInput source="user.mobileNumber" label="Mobile Number" validate={v.mobileRequired} />
          <DigitFormSelect
            source="employeeStatus"
            label="Status"
            choices={STATUS_CHOICES}
            placeholder="Select status..."
          />
          <DigitFormSelect
            source="employeeType"
            label="Type"
            choices={TYPE_CHOICES}
            placeholder="Select type..."
          />
        </div>
      </FieldSection>

      <FieldSection title="User Account">
        <div className="space-y-4">
          <DigitFormInput source="user.userName" label="Username" disabled />
          <DigitFormSelect
            source="user.gender"
            label="Gender"
            choices={GENDER_CHOICES}
            placeholder="Select gender..."
          />
          <DigitFormInput source="user.emailId" label="Email" validate={v.emailOptional} />
        </div>
      </FieldSection>

      <FieldSection title="Current Assignment">
        <div className="space-y-4">
          <DigitFormSelect
            source="assignments.0.department"
            label="Department"
            reference="departments"
            placeholder="Select department..."
          />
          <DigitFormSelect
            source="assignments.0.designation"
            label="Designation"
            reference="designations"
            placeholder="Select designation..."
          />
        </div>
      </FieldSection>

      <FieldSection title="Jurisdiction">
        <div className="space-y-4">
          <DigitFormSelect
            source="jurisdictions.0.hierarchy"
            label="Hierarchy"
            choices={HIERARCHY_CHOICES}
            placeholder="Select hierarchy..."
          />
          <DigitFormSelect
            source="jurisdictions.0.boundaryType"
            label="Boundary Type"
            choices={BOUNDARY_TYPE_CHOICES}
            placeholder="Select boundary type..."
          />
          <DigitFormSelect
            source="jurisdictions.0.boundary"
            label="Boundary"
            reference="boundaries"
            placeholder="Select boundary..."
          />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

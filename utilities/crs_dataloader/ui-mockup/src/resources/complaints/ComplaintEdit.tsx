import { DigitEdit, DigitFormInput, DigitFormSelect, WorkflowActionSelect } from '@/admin';
import { FieldSection } from '@/admin/fields';

const SOURCE_CHOICES = [
  { value: 'web', label: 'Web' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'ivr', label: 'IVR' },
  { value: 'counter', label: 'Counter' },
];

export function ComplaintEdit() {
  return (
    <DigitEdit title="Update Complaint">
      <FieldSection title="Header">
        <div className="space-y-4">
          <DigitFormInput source="serviceRequestId" label="Request ID" disabled />
        </div>
      </FieldSection>

      <FieldSection title="Workflow">
        <div className="space-y-4">
          <WorkflowActionSelect
            source="action"
            businessService="PGR"
            statusSource="applicationStatus"
          />
          <DigitFormInput source="comment" label="Comment" placeholder="Add a comment for this action..." />
        </div>
      </FieldSection>

      <FieldSection title="Details">
        <div className="space-y-4">
          <DigitFormSelect
            source="serviceCode"
            label="Complaint Type"
            reference="complaint-types"
            optionValue="serviceCode"
            placeholder="Select complaint type..."
          />
          <DigitFormInput source="description" label="Description" />
          <DigitFormSelect
            source="source"
            label="Source"
            choices={SOURCE_CHOICES}
            placeholder="Select source..."
          />
        </div>
      </FieldSection>

      <FieldSection title="Citizen">
        <div className="space-y-4">
          <DigitFormInput source="citizen.name" label="Name" disabled />
          <DigitFormInput source="citizen.mobileNumber" label="Mobile" disabled />
        </div>
      </FieldSection>

      <FieldSection title="Address">
        <div className="space-y-4">
          <DigitFormSelect
            source="address.locality.code"
            label="Locality"
            reference="boundaries"
            placeholder="Select locality..."
          />
          <DigitFormInput source="address.city" label="City" />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

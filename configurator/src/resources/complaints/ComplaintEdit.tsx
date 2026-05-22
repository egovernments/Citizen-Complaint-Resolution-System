import { DigitEdit, DigitFormInput, DigitFormSelect, WorkflowActionSelect } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { LocalityPicker } from './LocalityPicker';

// Aligned with the PGR service's server-side source allow-list — probed
// 2026-04-23 on naipepea: web / mobile / whatsapp accepted; ivr / phone /
// counter return INVALID_SOURCE. Extend here only after the server list does.
const SOURCE_CHOICES = [
  { value: 'web', label: 'Web' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'whatsapp', label: 'WhatsApp' },
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
          <LocalityPicker source="address.locality.code" label="Locality" />
          <DigitFormInput source="address.landmark" label="Landmark" />
          <DigitFormInput source="address.pincode" label="Pincode" />
          <DigitFormInput source="address.street" label="Street" />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

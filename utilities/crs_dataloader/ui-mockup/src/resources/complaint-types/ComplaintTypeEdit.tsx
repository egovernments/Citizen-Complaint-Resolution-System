import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';

export function ComplaintTypeEdit() {
  return (
    <DigitEdit title="Edit Complaint Type">
      <FieldSection title="Details">
        <div className="space-y-4">
          <DigitFormInput source="serviceCode" label="Service Code" disabled />
          <DigitFormInput source="name" label="Name" validate={v.name} />
          <DigitFormSelect
            source="department"
            label="Department"
            reference="departments"
            placeholder="Select department..."
          />
          <DigitFormInput source="slaHours" label="SLA (hours)" type="number" validate={v.slaHours} />
          <DigitFormInput source="menuPath" label="Menu Path" />
          <DigitFormInput source="keywords" label="Keywords" />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

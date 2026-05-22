import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { BooleanInput } from '@/admin/widgets';

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
          {/* The active flag was previously omitted from this dedicated
              edit form, so operators had no way to enable/disable a
              complaint type — `ComplaintTypeList` rendered a Status
              column for it but offered no editing affordance (closes
              the second item in egovernments/CCRS#483 follow-up).
              The `BooleanInput` widget keeps the form value as a real
              boolean so the MDMS update doesn't reject with
              "expected type: Boolean, found: String" — same fix
              Chakshu shipped for the generic edit path in #46. */}
          <BooleanInput source="active" label="Active" />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

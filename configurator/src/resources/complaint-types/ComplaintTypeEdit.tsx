import { useTranslate } from 'ra-core';
import { DigitEdit, DigitFormInput, DigitFormMultiSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { BooleanInput } from '@/admin/widgets';

// `department` (the schema's single "primary" field, used by backend
// routing/validation) is derived from the first checked entry in
// `departments` — records saved before `departments` existed only carry
// `department`, so this keeps working for them once re-saved here.
function transform(data: Record<string, unknown>) {
  const departments = Array.isArray(data.departments) ? (data.departments as string[]) : [];
  return { ...data, department: departments[0] };
}

export function ComplaintTypeEdit() {
  const translate = useTranslate();
  return (
    <DigitEdit title="Edit Complaint Type" transform={transform}>
      <FieldSection title="Details">
        <div className="space-y-4">
          {/* Grouping key — parent node code in the ComplaintHierarchy tree
              (replaces the old free-text menuPath). */}
          <DigitFormInput source="parentCode" label={translate('app.fields.parent_code')} />
          <DigitFormMultiSelect
            source="departments"
            label={translate('app.fields.departments')}
            reference="departments"
            validate={v.required}
            help={translate('app.fields.departments_primary_help')}
          />
          <DigitFormInput source="slaHours" label={translate('app.fields.sla_hours')} type="number" validate={v.slaHours} />
          <DigitFormInput source="keywords" label={translate('app.fields.keywords')} help={translate('app.fields.keywords_help')} />
          <DigitFormInput source="order" label={translate('app.fields.order')} type="number" />
          {/* The active flag was previously omitted from this dedicated
              edit form, so operators had no way to enable/disable a
              complaint type — `ComplaintTypeList` rendered a Status
              column for it but offered no editing affordance (closes
              the second item in egovernments/CCRS#483 follow-up).
              The `BooleanInput` widget keeps the form value as a real
              boolean so the MDMS update doesn't reject with
              "expected type: Boolean, found: String" — same fix
              Chakshu shipped for the generic edit path in #46. */}
          <BooleanInput source="active" label={translate('app.fields.active')} />
          <DigitFormInput source="name" label={translate('app.fields.complaint_sub_type')} validate={v.name} />
          <DigitFormInput source="serviceCode" label={translate('app.fields.service_code')} disabled />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

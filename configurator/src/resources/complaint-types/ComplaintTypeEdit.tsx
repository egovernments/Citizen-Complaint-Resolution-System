import { useLocaleState, type RaRecord } from 'ra-core';
import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { BooleanInput } from '@/admin/widgets';
import { localizationService } from '@/api/services/localization';
import { digitClient } from '@/providers/bridge';

export function ComplaintTypeEdit() {
  const [locale] = useLocaleState();

  // The sub-type's display name lives in two places: the MDMS record's `name`
  // field AND the SERVICEDEFS.* localization keys the citizen/employee PGR UI
  // reads. The MDMS update only changes the former, so re-seed the sub-type's
  // name labels for the ACTIVE locale here, then cache-bust, so the new name
  // shows everywhere. We deliberately omit `menuPath` so the PARENT type label
  // (SERVICEDEFS.<menuPath>) is not overwritten — that's edited via type rename.
  // Only the active locale is written, to avoid clobbering other languages'
  // translations (same policy as type rename).
  const afterUpdate = async (record: RaRecord) => {
    const data = record as unknown as {
      serviceCode?: string;
      name?: string;
      department?: string;
    };
    const serviceCode = data.serviceCode?.trim();
    const name = data.name?.trim();
    if (!serviceCode || !name) return;

    const tenantId = digitClient.stateTenantId;
    if (!tenantId) return;

    await localizationService.uploadComplaintTypeLocalizations(
      tenantId,
      [{ serviceCode, name, department: data.department }],
      locale,
    );
    await localizationService.cacheBust();
  };

  return (
    <DigitEdit title="Edit Complaint Type" afterUpdate={afterUpdate}>
      <FieldSection title="Details">
        <div className="space-y-4">
          <DigitFormInput source="menuPath" label="Complaint Type (Menu Path)" validate={v.required} />
          <DigitFormSelect
            source="department"
            label="Department"
            reference="departments"
            placeholder="Select department..."
          />
          <DigitFormInput source="slaHours" label="SLA (hours)" type="number" validate={v.slaHours} />
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
          <DigitFormInput source="name" label="Complaint Sub-Type" validate={v.name} />
          <DigitFormInput source="serviceCode" label="Service Code" disabled />
        </div>
      </FieldSection>
    </DigitEdit>
  );
}

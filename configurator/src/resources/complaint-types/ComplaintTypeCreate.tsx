import type { RaRecord } from 'ra-core';
import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { localizationService } from '@/api/services/localization';
import { digitClient } from '@/providers/bridge';

const defaultRecord = {
  active: true,
  keywords: 'complaint',
  order: 0,
};

export function ComplaintTypeCreate() {
  const { locales } = useAvailableLocales();

  // After the MDMS record is saved, seed `SERVICEDEFS.*` localization keys
  // for every locale the tenant declares. Without this a freshly-added
  // complaint type renders as the raw key on at least one surface — the
  // citizen subtype list uses `SERVICEDEFS.<CODE>` and the employee CSR
  // form uses `SERVICEDEFS.<CODE>.<DEPT>`. Both must resolve, and prior
  // to this seeding none of them existed (see
  // egovernments/Citizen-Complaint-Resolution-System#539).
  //
  // We seed every configured locale with the operator-provided `name` as
  // the message. Translations can be refined later via the bulk
  // localization import/export. Skipping `sw_KE` (or any other tenant
  // locale) would leave it rendering the raw key in Swahili UI, which is
  // worse than a half-translated label.
  const afterCreate = async (record: RaRecord) => {
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

    // Dedupe via Set in case StateInfo declares `en_IN` explicitly.
    const targetLocales = new Set<string>([...locales.map((l) => l.value), 'en_IN']);

    for (const locale of targetLocales) {
      await localizationService.uploadComplaintTypeLocalizations(
        tenantId,
        [{ serviceCode, name, department: data.department }],
        locale,
      );
    }

    // Drop the localization service's in-memory cache so the next /_search
    // reflects the new keys. Without this the digit-ui keeps reading the
    // pre-write snapshot for up to the cache TTL.
    await localizationService.cacheBust();
  };

  return (
    <DigitCreate title="Create Complaint Type" record={defaultRecord} afterCreate={afterCreate}>
      {/* The grouping key is the parent node's code in the ComplaintHierarchy
          tree (replaces the old free-text menuPath). Optional here — leaves
          created standalone sit ungrouped until parented. */}
      <DigitFormInput source="parentCode" label="Parent (group code)" />
      <DigitFormSelect
        source="department"
        label="Department"
        reference="departments"
        placeholder="Select department..."
        validate={v.required}
      />
      <DigitFormInput source="slaHours" label="SLA (hours)" type="number" validate={v.slaHours} />
      <DigitFormInput source="name" label="Complaint Sub-Type" validate={v.name} />
      <DigitFormCodeInput source="serviceCode" label="Service Code" deriveFrom="name" validate={v.codeRequired} />
    </DigitCreate>
  );
}

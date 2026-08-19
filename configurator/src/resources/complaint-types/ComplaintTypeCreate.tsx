import { useTranslate, type RaRecord } from 'ra-core';
import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormMultiSelect, v } from '@/admin';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { localizationService } from '@/api/services/localization';
import { digitClient } from '@/providers/bridge';

const defaultRecord = {
  active: true,
  order: 0,
};

export function ComplaintTypeCreate() {
  const { locales } = useAvailableLocales();
  const translate = useTranslate();

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

  // `department` (the schema's single "primary" field, used by backend
  // routing/validation) is derived from the first checked entry in
  // `departments` rather than collected separately — the schema itself says
  // department is just "the primary of this list", so asking for both would
  // just invite them to disagree.
  const transform = (data: Record<string, unknown>) => {
    const departments = Array.isArray(data.departments) ? (data.departments as string[]) : [];
    return { ...data, department: departments[0] };
  };

  return (
    <DigitCreate title="Create Complaint Type" record={defaultRecord} transform={transform} afterCreate={afterCreate}>
      {/* The grouping key is the parent node's code in the ComplaintHierarchy
          tree (replaces the old free-text menuPath). Optional here — leaves
          created standalone sit ungrouped until parented. */}
      <DigitFormInput source="parentCode" label={translate('app.fields.parent_code')} />
      <DigitFormMultiSelect
        source="departments"
        label={translate('app.fields.departments')}
        reference="departments"
        validate={v.required}
        help={translate('app.fields.departments_primary_help')}
      />
      <DigitFormInput source="slaHours" label={translate('app.fields.sla_hours')} type="number" validate={v.slaHours} />
      <DigitFormInput source="name" label={translate('app.fields.complaint_sub_type')} validate={v.name} />
      <DigitFormCodeInput source="serviceCode" label={translate('app.fields.service_code')} deriveFrom="name" validate={v.codeRequired} />
      <DigitFormInput source="keywords" label={translate('app.fields.keywords')} help={translate('app.fields.keywords_help')} />
      <DigitFormInput source="order" label={translate('app.fields.order')} type="number" />
    </DigitCreate>
  );
}

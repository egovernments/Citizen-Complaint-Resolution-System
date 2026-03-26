import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';

const defaultRecord = {
  active: true,
  keywords: 'complaint',
  order: 0,
  menuPath: 'Complaint',
};

export function ComplaintTypeCreate() {
  return (
    <DigitCreate title="Create Complaint Type" record={defaultRecord}>
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormCodeInput source="serviceCode" label="Service Code" deriveFrom="name" validate={v.codeRequired} />
      <DigitFormSelect
        source="department"
        label="Department"
        reference="departments"
        placeholder="Select department..."
        validate={v.required}
      />
      <DigitFormInput source="slaHours" label="SLA (hours)" type="number" validate={v.slaHours} />
      <DigitFormInput source="menuPath" label="Menu Path" />
    </DigitCreate>
  );
}

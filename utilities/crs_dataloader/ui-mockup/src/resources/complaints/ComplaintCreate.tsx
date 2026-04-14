import { DigitCreate, DigitFormInput, DigitFormSelect, v } from '@/admin';

export function ComplaintCreate() {
  return (
    <DigitCreate title="File Complaint" record={{ 'address.city': 'pg' }}>
      <DigitFormSelect
        source="serviceCode"
        label="Complaint Type"
        reference="complaint-types"
        optionValue="serviceCode"
        placeholder="Select complaint type..."
        validate={v.required}
      />
      <DigitFormInput source="description" label="Description" validate={[v.required, v.minLength(10)]} />
      <DigitFormSelect
        source="address.locality.code"
        label="Locality"
        reference="boundaries"
        placeholder="Select locality..."
      />
      <DigitFormInput source="address.city" label="City" />
    </DigitCreate>
  );
}

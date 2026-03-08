import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function ComplaintTypeEdit() {
  return (
    <DigitEdit title="Edit Complaint Type">
      <DigitFormInput source="serviceCode" label="Service Code" disabled />
      <DigitFormInput source="name" label="Name" validate={required()} />
      <DigitFormInput source="department" label="Department" />
      <DigitFormInput source="slaHours" label="SLA (hours)" type="number" />
      <DigitFormInput source="menuPath" label="Menu Path" />
    </DigitEdit>
  );
}

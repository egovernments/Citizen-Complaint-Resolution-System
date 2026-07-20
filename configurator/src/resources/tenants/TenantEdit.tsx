import { DigitEdit, DigitFormInput, v } from '@/admin';

export function TenantEdit() {
  return (
    <DigitEdit title="Edit Tenant">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormInput
        source="description"
        label="Description"
        help="Shown on the citizen home and the tenant picker."
      />
      <DigitFormInput
        source="contactNumber"
        label="Helpline number"
        placeholder="e.g. 0800 720 999"
        help="Surfaces as the citizen UI Helpline tile (tel: dial). Free text — supports short codes and spaces."
      />
      <DigitFormInput
        source="emailId"
        label="Email"
        type="email"
        validate={v.email}
      />
      <DigitFormInput
        source="address"
        label="Address"
        help="Office address shown in the citizen footer / contact pages."
      />
    </DigitEdit>
  );
}

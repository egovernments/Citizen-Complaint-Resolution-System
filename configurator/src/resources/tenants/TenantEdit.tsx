import { DigitEdit, DigitFormInput, v } from '@/admin';
import { ChipArrayInput } from '@/admin/widgets';
import { formatPincodes, parsePincodes } from './tenantFields';

export function TenantEdit() {
  return (
    <DigitEdit title="Edit Tenant">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="name" label="Name" disabled help="Change the workspace name in Workspace settings." />
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
      <DigitFormInput
        source="logoId"
        label="Logo URL"
        placeholder="https://… or /…/logo.png"
        help="The tenant's logo in the citizen and employee top bar once signed in. Empty: the state logo."
      />
      <DigitFormInput
        source="city.ulbGrade"
        label="Grade"
        placeholder="e.g. County, Municipal Corporation"
        help="Shown next to the tenant name in the top bar (as the localised ULBGRADE_<GRADE> message)."
      />
      <ChipArrayInput
        source="pincode"
        label="Serviceable postal codes"
        format={formatPincodes}
        parse={parsePincodes}
        help="The postal codes this tenant serves. When any tenant lists codes, a citizen complaint whose postal code is in none of them (and has no ward) is refused as not serviceable. Empty: no restriction."
      />
    </DigitEdit>
  );
}

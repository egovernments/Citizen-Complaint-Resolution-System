import { DigitCreate, DigitFormCodeInput, DigitFormInput, v } from '@/admin';
import { BooleanInput } from '@/admin/widgets';

// Department schema (`common-masters.Department`) declares
// additionalProperties:false and only allows {code, name, active}. Any
// extra field — `description` was here historically — makes _create
// reject with INVALID_REQUEST_ADDITIONALPROPERTIES (egovernments/CCRS#472).
// Designation, which does carry a `description`, has its own form.
export function DepartmentCreate() {
  return (
    <DigitCreate title="Create Department" record={{ active: true }}>
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormCodeInput source="code" label="Code" deriveFrom="name" validate={v.codeRequired} />
      <BooleanInput source="active" label="Active" />
    </DigitCreate>
  );
}

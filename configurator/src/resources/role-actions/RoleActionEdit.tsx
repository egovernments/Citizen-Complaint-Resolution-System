import { DigitEdit, DigitFormInput } from '@/admin';
import { BooleanInput } from '@/admin/widgets';

// rolecode + actionid form the MDMS x-unique composite key for this schema —
// changing either on an existing grant would silently retarget a different
// role/action pair rather than editing this one, so only actioncode is
// mutable here (mirrors DepartmentEdit disabling `code`).
//
// _isActive is the MDMS envelope's own isActive (not a `data` field) — the
// same generic checkbox every MdmsResourceEdit master gets (see
// dataProvider.ts's update(), which reads it back out of the submit
// payload). This schema has no in-`data` active/enabled field of its own, so
// this checkbox is the only way to deactivate/reactivate a grant; unlike most
// masters, role-actions sets `includeInactive` in the registry, so a
// deactivated grant stays reachable here to flip back on.
export function RoleActionEdit() {
  return (
    <DigitEdit title="Edit Role Action">
      <DigitFormInput source="rolecode" label="Role Code" disabled />
      <DigitFormInput source="actionid" label="Action ID" disabled />
      <DigitFormInput source="actioncode" label="Action Code" />
      <BooleanInput source="_isActive" label="Active" />
    </DigitEdit>
  );
}

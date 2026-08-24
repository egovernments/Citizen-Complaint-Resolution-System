import { DigitCreate, DigitFormSelect, DigitFormInput, v } from '@/admin';
import { useApp } from '../../App';

// ACCESSCONTROL-ROLEACTIONS.roleactions requires {rolecode, actionid, tenantId}
// in `data` itself (on top of the MDMS envelope's own tenantId) — stamp the
// session tenant in transform rather than a form field, matching
// EmployeeCreate's tenantId handling. actionid is a schema `number`, but
// DigitFormSelect always yields string choice values, so it's coerced here.
export function RoleActionCreate() {
  const { state } = useApp();
  const tenantId = state.tenant;

  const transform = (data: Record<string, unknown>): Record<string, unknown> => ({
    ...data,
    tenantId,
    actionid: Number(data.actionid),
  });

  return (
    <DigitCreate title="Create Role Action" transform={transform}>
      <DigitFormSelect
        source="rolecode"
        label="Role"
        reference="access-roles"
        optionValue="code"
        optionText="name"
        validate={v.required}
      />
      <DigitFormSelect
        source="actionid"
        label="Action"
        reference="access-actions"
        optionValue="id"
        optionText="displayName"
        validate={v.required}
      />
      <DigitFormInput source="actioncode" label="Action Code" />
    </DigitCreate>
  );
}

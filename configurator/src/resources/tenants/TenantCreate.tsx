import { useWatch } from 'react-hook-form';
import { composeValidators } from 'ra-core';
import { DigitCreate, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useApp } from '@/App';

// A node below the tenant the admin works at (a county's department, a ward office) is set up
// here by that tenant's account admin. The row lives with every tenant row at the state root (tenant.tenants is a
// state-level schema); its code is the parent's code plus one segment (the tenant-tree contract: the parent IS the code
// without its last segment). The backend completes and checks the row and refuses it unless the admin holds
// ACCOUNT_ADMIN at the parent or above.
const SEGMENT = /^[a-z0-9][a-z0-9_-]*$/;
const segment = composeValidators(v.required, v.regex(SEGMENT, 'Lower-case letters, digits, _ or -, starting with a letter or digit'));

function DepartmentField() {
  const kind = useWatch({ name: 'kind' }) as string | undefined;
  if (kind !== 'department') return null;
  return <DigitFormSelect source="departmentCode" label="Department" reference="departments" validate={v.required} help="The department this node is." />;
}

export function TenantCreate() {
  const { state } = useApp();
  const parent = state.tenant;
  const root = parent.split('.')[0];
  const transform = (d: Record<string, unknown>) => {
    const code = `${parent}.${String(d.segment ?? '').trim()}`;
    const name = String(d.name ?? '').trim();
    const kind = d.kind === 'department' ? 'department' : 'area';
    const slug = code.toLowerCase().replace(/\./g, '-');
    return {
      tenantId: root, code, name, parent, kind,
      ...(kind === 'department' ? { departmentCode: d.departmentCode } : {}),
      type: kind === 'department' ? 'Department' : 'Area', description: name, imageId: null,
      emailId: `info@${slug}.gov.in`, address: name, domainUrl: `https://${slug}.digit.org`, contactNumber: '1800-000-0000',
      OfficeTimings: { 'Mon - Fri': '9:00 AM - 6:00 PM' },
      city: { code: code.toUpperCase().replace(/\./g, '_'), name, districtTenantCode: parent, ulbGrade: kind === 'department' ? 'Department' : 'Area' },
    };
  };
  return (
    <DigitCreate title="Create Tenant" record={{ kind: 'area' }} transform={transform}>
      <p className="text-sm text-muted-foreground">
        Creating a tenant under <strong>{parent}</strong>.
      </p>
      <DigitFormInput source="segment" label="Code" validate={segment} help={`The new tenant's code is ${parent}.<this>.`} />
      <DigitFormInput source="name" label="Name" validate={v.name} />
      <DigitFormSelect
        source="kind"
        label="Kind"
        choices={[{ value: 'area', label: 'Area (a place: its own boundaries, or its parent\'s)' }, { value: 'department', label: 'Department' }]}
        validate={v.required}
      />
      <DepartmentField />
    </DigitCreate>
  );
}

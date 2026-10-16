import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { useMastersCapability } from '@/hooks/useMastersCapability';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'name', label: 'app.fields.name' },
  { source: 'description', label: 'app.fields.description' },
];

export function AccessRoleList() {
  const { canEditResource } = useMastersCapability();
  return (
    <DigitList
      title="app.resources.access_roles"
      hasCreate={canEditResource('access-roles')}
      sort={{ field: 'code', order: 'ASC' }}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

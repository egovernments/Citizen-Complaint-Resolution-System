import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { useNavigate } from 'react-router-dom';
import { useMastersCapability } from '@/hooks/useMastersCapability';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'name', label: 'app.fields.name' },
  { source: 'description', label: 'app.fields.description' },
];

export function AccessRoleList() {
  const { canEditResource } = useMastersCapability();
  const navigate = useNavigate();
  return (
    <DigitList
      title="app.resources.access_roles"
      hasCreate={canEditResource('access-roles')}
      // a new role is made in the Role editor: name, grants, scope and field rules together
      onCreate={() => navigate('/manage/access/roles/new')}
      sort={{ field: 'code', order: 'ASC' }}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

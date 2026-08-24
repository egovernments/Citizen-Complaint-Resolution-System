import { DigitList, DigitDatagrid } from '@/admin';
import { StatusChip } from '@/admin/fields';
import type { DigitColumn } from '@/admin';
import { useMastersCapability } from '@/hooks/useMastersCapability';

const columns: DigitColumn[] = [
  { source: 'rolecode', label: 'app.fields.role_code' },
  { source: 'actionid', label: 'app.fields.action_id' },
  { source: 'actioncode', label: 'app.fields.action_code' },
  { source: 'tenantId', label: 'app.fields.tenant' },
  {
    source: '_isActive',
    label: 'app.fields.status',
    sortable: false,
    render: (record) => (
      <StatusChip value={record._isActive} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];

export function RoleActionList() {
  const { canEditResource } = useMastersCapability();
  return (
    <DigitList
      title="app.resources.role_actions"
      hasCreate={canEditResource('role-actions')}
      sort={{ field: 'rolecode', order: 'ASC' }}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

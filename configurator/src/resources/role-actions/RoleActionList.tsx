import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'rolecode', label: 'app.fields.role_code' },
  { source: 'actionid', label: 'app.fields.action_id' },
  { source: 'actioncode', label: 'app.fields.action_code' },
  { source: 'tenantId', label: 'app.fields.tenant' },
];

export function RoleActionList() {
  return (
    <DigitList title="app.resources.role_actions" sort={{ field: 'rolecode', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

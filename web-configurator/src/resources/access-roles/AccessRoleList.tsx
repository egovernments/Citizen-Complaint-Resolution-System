import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name' },
  { source: 'description', label: 'Description' },
];

export function AccessRoleList() {
  return (
    <DigitList title="Access Roles" sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

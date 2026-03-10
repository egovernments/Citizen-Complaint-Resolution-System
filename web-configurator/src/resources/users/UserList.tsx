import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { Badge } from '@/components/ui/badge';

const columns: DigitColumn[] = [
  { source: 'userName', label: 'Username' },
  { source: 'name', label: 'Name' },
  { source: 'mobileNumber', label: 'Mobile' },
  {
    source: 'type',
    label: 'Type',
    render: (record) => <StatusChip value={record.type} />,
  },
  {
    source: 'active',
    label: 'Active',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
  {
    source: 'roles',
    label: 'Roles',
    sortable: false,
    render: (record) => {
      const roles = record.roles as Array<Record<string, unknown>> | undefined;
      const count = roles?.length ?? 0;
      return count > 0 ? (
        <Badge variant="secondary" className="text-xs">{count} roles</Badge>
      ) : (
        <span className="text-muted-foreground">--</span>
      );
    },
  },
];

export function UserList() {
  return (
    <DigitList title="Users" hasCreate sort={{ field: 'userName', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

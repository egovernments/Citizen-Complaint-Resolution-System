import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { Badge } from '@/components/ui/badge';

const columns: DigitColumn[] = [
  { source: 'userName', label: 'app.fields.username' },
  { source: 'name', label: 'app.fields.name' },
  { source: 'mobileNumber', label: 'app.fields.mobile' },
  {
    source: 'type',
    label: 'app.fields.type',
    render: (record) => <StatusChip value={record.type} />,
  },
  {
    source: 'active',
    label: 'app.fields.active',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
  {
    source: 'roles',
    label: 'app.fields.roles',
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
    <DigitList title="app.resources.users" hasCreate sort={{ field: 'userName', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

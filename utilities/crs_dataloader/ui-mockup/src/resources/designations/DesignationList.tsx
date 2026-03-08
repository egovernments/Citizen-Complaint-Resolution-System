import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'name', label: 'Name' },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
  { source: 'description', label: 'Description' },
];

export function DesignationList() {
  return (
    <DigitList title="Designations" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'tenantId', label: 'Tenant' },
  { source: 'description', label: 'Description' },
  {
    source: 'isActive',
    label: 'Active',
    render: (record) => (
      <StatusChip value={record.isActive} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];

export function MdmsSchemaList() {
  return (
    <DigitList title="MDMS Schemas" sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'tenantId', label: 'app.fields.tenant' },
  { source: 'description', label: 'app.fields.description' },
  {
    source: 'isActive',
    label: 'app.fields.active',
    render: (record) => (
      <StatusChip value={record.isActive} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];

export function MdmsSchemaList() {
  return (
    <DigitList title="app.resources.mdms_schemas" sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

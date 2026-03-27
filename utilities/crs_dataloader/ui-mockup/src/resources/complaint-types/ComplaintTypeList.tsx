import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  { source: 'serviceCode', label: 'app.fields.service_code' },
  { source: 'name', label: 'app.fields.name', editable: true },
  {
    source: 'department',
    label: 'app.fields.department',
    editable: { type: 'reference', reference: 'departments', displayField: 'name' },
    render: (record) => {
      const dept = String(record.department ?? '');
      return dept ? <EntityLink resource="departments" id={dept} /> : <span className="text-muted-foreground">--</span>;
    },
  },
  { source: 'slaHours', label: 'app.fields.sla_hours', editable: { type: 'number' } },
  {
    source: 'active',
    label: 'app.fields.status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];

export function ComplaintTypeList() {
  return (
    <DigitList title="app.resources.complaint_types" hasCreate sort={{ field: 'serviceCode', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

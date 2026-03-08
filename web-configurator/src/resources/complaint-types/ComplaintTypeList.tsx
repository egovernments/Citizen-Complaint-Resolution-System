import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  { source: 'serviceCode', label: 'Service Code' },
  { source: 'name', label: 'Name' },
  {
    source: 'department',
    label: 'Department',
    render: (record) => {
      const dept = String(record.department ?? '');
      return dept ? <EntityLink resource="departments" id={dept} /> : <span className="text-muted-foreground">--</span>;
    },
  },
  { source: 'slaHours', label: 'SLA (hrs)' },
  {
    source: 'active',
    label: 'Status',
    render: (record) => (
      <StatusChip value={record.active} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];

export function ComplaintTypeList() {
  return (
    <DigitList title="Complaint Types" hasCreate sort={{ field: 'serviceCode', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

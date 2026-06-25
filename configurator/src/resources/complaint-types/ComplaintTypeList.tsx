import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  // Grouping key — the leaf's parent node code in the hierarchy (was menuPath).
  { source: 'parentCode', label: 'app.fields.parent' },
  { source: 'serviceCode', label: 'app.fields.service_code' },
  { source: 'name', label: 'app.fields.name', editable: true },
  {
    source: 'department',
    label: 'app.fields.department',
    editable: { type: 'reference', reference: 'departments', displayField: 'name' },
    render: (record) => {
      // A complaint type can map to MANY departments (departments[]); the single
      // `department` is just the primary. Show all of them.
      const list =
        Array.isArray(record.departments) && record.departments.length
          ? (record.departments as string[])
          : record.department
          ? [String(record.department)]
          : [];
      if (!list.length) return <span className="text-muted-foreground">--</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {list.map((d) => (
            <EntityLink key={d} resource="departments" id={d} />
          ))}
        </div>
      );
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

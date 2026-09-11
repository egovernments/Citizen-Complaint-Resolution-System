import {
  DigitList,
  DigitDatagrid,
  SearchFilterInput,
  ReferenceFilterInput,
} from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useMastersCapability } from '@/hooks/useMastersCapability';

// Department is the axis admins actually slice this list by ("what does Public
// Works own?"), and it is already a rendered column — mirrors the Department
// filter DesignationList declares, but alwaysOn so it is visible without going
// through the Add-filter popover. Passing `filters` swaps DigitList's built-in
// search box for the FilterBar, so SearchFilterInput has to be re-declared here
// or free-text search disappears from the page.
const filters = [
  <SearchFilterInput key="q" source="q" alwaysOn />,
  <ReferenceFilterInput
    key="department"
    source="department"
    reference="departments"
    label="Department"
    alwaysOn
  />,
];

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
  const { canEditResource } = useMastersCapability();
  return (
    <DigitList
      title="app.resources.complaint_types"
      hasCreate={canEditResource('complaint-hierarchy')}
      sort={{ field: 'serviceCode', order: 'ASC' }}
      filters={filters}
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

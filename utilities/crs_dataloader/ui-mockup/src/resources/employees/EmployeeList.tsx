import { DigitList, DigitDatagrid, SearchFilterInput, SelectFilterInput, TextFilterInput } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const filters = [
  <SearchFilterInput key="q" source="q" alwaysOn />,
  <SelectFilterInput
    key="employeeStatus"
    source="employeeStatus"
    label="Status"
    choices={[
      { id: 'EMPLOYED', name: 'Employed' },
      { id: 'INACTIVE', name: 'Inactive' },
    ]}
    alwaysOn
  />,
  <TextFilterInput key="code" source="code" label="Code" />,
];

const columns: DigitColumn[] = [
  { source: 'code', label: 'app.fields.code' },
  { source: 'user.name', label: 'app.fields.name' },
  { source: 'user.mobileNumber', label: 'app.fields.mobile' },
  {
    source: 'employeeStatus',
    label: 'app.fields.status',
    render: (record) => <StatusChip value={record.employeeStatus} />,
  },
  {
    source: 'assignments',
    label: 'app.fields.department',
    sortable: false,
    render: (record) => {
      const assignments = record.assignments as Array<Record<string, unknown>> | undefined;
      const current = assignments?.find((a) => a.isCurrentAssignment);
      return current?.department
        ? <EntityLink resource="departments" id={String(current.department)} />
        : <span className="text-muted-foreground">--</span>;
    },
  },
  {
    source: 'assignments',
    label: 'app.fields.designation',
    sortable: false,
    render: (record) => {
      const assignments = record.assignments as Array<Record<string, unknown>> | undefined;
      const current = assignments?.find((a) => a.isCurrentAssignment);
      return current?.designation
        ? <EntityLink resource="designations" id={String(current.designation)} />
        : <span className="text-muted-foreground">--</span>;
    },
  },
  {
    source: 'isActive',
    label: 'app.fields.active',
    render: (record) => (
      <StatusChip value={record.isActive} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];

export function EmployeeList() {
  return (
    <DigitList title="app.resources.employees" hasCreate sort={{ field: 'code', order: 'ASC' }} filters={filters}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

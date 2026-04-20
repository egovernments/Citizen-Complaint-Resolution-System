import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  { source: 'code', label: 'Code' },
  { source: 'user.name', label: 'Name' },
  { source: 'user.mobileNumber', label: 'Mobile' },
  {
    source: 'employeeStatus',
    label: 'Status',
    render: (record) => <StatusChip value={record.employeeStatus} />,
  },
  {
    source: 'assignments',
    label: 'Department',
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
    label: 'Designation',
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
    label: 'Active',
    render: (record) => (
      <StatusChip value={record.isActive} labels={{ true: 'Active', false: 'Inactive' }} />
    ),
  },
];

export function EmployeeList() {
  return (
    <DigitList title="Employees" hasCreate sort={{ field: 'code', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

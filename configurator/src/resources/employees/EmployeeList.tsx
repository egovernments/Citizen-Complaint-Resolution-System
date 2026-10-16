import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { DigitList, DigitDatagrid, SearchFilterInput, SelectFilterInput, TextFilterInput } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { Button } from '@/components/ui/button';
import { employeeRoles, employeeStatus } from './employeeColumns';

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
  <TextFilterInput key="code" source="code" label="Employee Code" />,
];

// ours (cfgreview F16, #1562): one Status column (the two overlapped: HRMS status and the user's active flag), and
// Roles and Tenant columns, so the list shows who is a GRO and where.
const columns: DigitColumn[] = [
  { source: 'code', label: 'Employee Code' },
  { source: 'user.name', label: 'app.fields.name' },
  { source: 'user.mobileNumber', label: 'app.fields.mobile' },
  {
    source: 'employeeStatus',
    label: 'app.fields.status',
    render: (record) => {
      const s = employeeStatus(record);
      return <StatusChip value={s.active} labels={{ true: s.label, false: s.label }} />;
    },
  },
  {
    source: 'user.roles',
    label: 'Roles',
    sortable: false,
    render: (record) => {
      const r = employeeRoles(record);
      return r.shown.length
        ? <span title={r.all.join(', ')}>{r.shown.join(', ')}{r.more ? ` +${r.more}` : ''}</span>
        : <span className="text-muted-foreground">--</span>;
    },
  },
  { source: 'tenantId', label: 'Tenant' },
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
];

export function EmployeeList() {
  return (
    <DigitList
      title="app.resources.employees"
      hasCreate
      sort={{ field: 'code', order: 'ASC' }}
      filters={filters}
      actions={
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link to="/manage/employees/bulk">
            <Upload className="w-4 h-4" aria-hidden="true" />
            Bulk import
          </Link>
        </Button>
      }
    >
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, DateField, StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { Badge } from '@/components/ui/badge';
import { useShowController } from 'ra-core';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';

export function EmployeeShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Employee: ${(record.user as Record<string,unknown>)?.name ?? record.code ?? record.id}` : 'Employee'} hasEdit>
      {(rec: Record<string, unknown>) => {
        const user = rec.user as Record<string, unknown> | undefined;
        const assignments = rec.assignments as Array<Record<string, unknown>> | undefined;
        const jurisdictions = rec.jurisdictions as Array<Record<string, unknown>> | undefined;
        const roles = user?.roles as Array<Record<string, unknown>> | undefined;

        return (
          <div className="space-y-6">
            {/* Header Section */}
            <FieldSection title="Employee Info">
              <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
              <FieldRow label="Name">{String(user?.name ?? '')}</FieldRow>
              <FieldRow label="Mobile">{String(user?.mobileNumber ?? '')}</FieldRow>
              <FieldRow label="Status"><StatusChip value={rec.employeeStatus} /></FieldRow>
              <FieldRow label="Type">{String(rec.employeeType ?? '')}</FieldRow>
              <FieldRow label="Active"><StatusChip value={rec.isActive} labels={{ true: 'Active', false: 'Inactive' }} /></FieldRow>
              <FieldRow label="Date of Appointment"><DateField value={rec.dateOfAppointment} showTime={false} /></FieldRow>
            </FieldSection>

            {/* User Section */}
            <FieldSection title="User Account">
              <FieldRow label="Username">{String(user?.userName ?? '')}</FieldRow>
              <FieldRow label="Gender">{String(user?.gender ?? '--')}</FieldRow>
              <FieldRow label="Date of Birth"><DateField value={user?.dob} showTime={false} /></FieldRow>
              <FieldRow label="Email">{String(user?.emailId ?? '--')}</FieldRow>
              {roles && roles.length > 0 && (
                <FieldRow label="Roles">
                  <div className="flex flex-wrap gap-1">
                    {roles.map((role) => (
                      <EntityLink
                        key={String(role.code)}
                        resource="access-roles"
                        id={String(role.code)}
                        label={String(role.name ?? role.code)}
                      />
                    ))}
                  </div>
                </FieldRow>
              )}
            </FieldSection>

            {/* Assignments Table */}
            {assignments && assignments.length > 0 && (
              <FieldSection title="Assignments">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>Department</TableHead>
                      <TableHead>Designation</TableHead>
                      <TableHead>From Date</TableHead>
                      <TableHead>Current</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((a, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {a.department ? <EntityLink resource="departments" id={String(a.department)} /> : '--'}
                        </TableCell>
                        <TableCell>
                          {a.designation ? <EntityLink resource="designations" id={String(a.designation)} /> : '--'}
                        </TableCell>
                        <TableCell><DateField value={a.fromDate} showTime={false} /></TableCell>
                        <TableCell>
                          {a.isCurrentAssignment ? (
                            <Badge variant="default" className="text-xs">Current</Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">Past</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </FieldSection>
            )}

            {/* Jurisdictions Table */}
            {jurisdictions && jurisdictions.length > 0 && (
              <FieldSection title="Jurisdictions">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>Hierarchy</TableHead>
                      <TableHead>Boundary Type</TableHead>
                      <TableHead>Boundary</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jurisdictions.map((j, i) => (
                      <TableRow key={i}>
                        <TableCell>{String(j.hierarchy ?? '--')}</TableCell>
                        <TableCell>{String(j.boundaryType ?? '--')}</TableCell>
                        <TableCell>
                          {j.boundary ? <EntityLink resource="tenants" id={String(j.boundary)} /> : '--'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </FieldSection>
            )}
          </div>
        );
      }}
    </DigitShow>
  );
}

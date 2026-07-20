import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useShowController } from 'ra-core';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';

export function UserShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `User: ${record.name ?? record.userName ?? record.id}` : 'User'} hasEdit>
      {(rec: Record<string, unknown>) => {
        const roles = rec.roles as Array<Record<string, unknown>> | undefined;

        return (
          <div className="space-y-6">
            <FieldSection title="Profile">
              <FieldRow label="UUID">{String(rec.uuid ?? '')}</FieldRow>
              <FieldRow label="Username">{String(rec.userName ?? '')}</FieldRow>
              <FieldRow label="Name">{String(rec.name ?? '')}</FieldRow>
              <FieldRow label="Mobile">{String(rec.mobileNumber ?? '--')}</FieldRow>
              <FieldRow label="Email">{String(rec.emailId ?? '--')}</FieldRow>
              <FieldRow label="Gender">{String(rec.gender ?? '--')}</FieldRow>
              <FieldRow label="Type"><StatusChip value={rec.type} /></FieldRow>
              <FieldRow label="Active">
                <StatusChip value={rec.active} labels={{ true: 'Active', false: 'Inactive' }} />
              </FieldRow>
              <FieldRow label="Date of Birth"><DateField value={rec.dob} showTime={false} /></FieldRow>
              <FieldRow label="Tenant">
                {rec.tenantId ? <EntityLink resource="tenants" id={String(rec.tenantId)} /> : '--'}
              </FieldRow>
            </FieldSection>

            {roles && roles.length > 0 && (
              <FieldSection title="Roles">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Tenant</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {roles.map((role, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <EntityLink resource="access-roles" id={String(role.code)} />
                        </TableCell>
                        <TableCell>{String(role.name ?? '--')}</TableCell>
                        <TableCell>
                          {role.tenantId ? <EntityLink resource="tenants" id={String(role.tenantId)} /> : '--'}
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

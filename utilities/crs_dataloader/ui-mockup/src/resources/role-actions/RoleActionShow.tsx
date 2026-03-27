import { DigitShow } from '@/admin';
import { FieldSection, FieldRow } from '@/admin/fields';
import { useShowController } from 'ra-core';

export function RoleActionShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Role Action: ${record.rolecode ?? record.id}` : 'Role Action'}>
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Role Code">{String(rec.rolecode ?? '')}</FieldRow>
            <FieldRow label="Action ID">{String(rec.actionid ?? '')}</FieldRow>
            <FieldRow label="Action Code">{String(rec.actioncode ?? '--')}</FieldRow>
            <FieldRow label="Tenant">{String(rec.tenantId ?? '--')}</FieldRow>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}

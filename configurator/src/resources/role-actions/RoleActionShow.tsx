import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip } from '@/admin/fields';
import { useShowController } from 'ra-core';
import { useMastersCapability } from '@/hooks/useMastersCapability';

export function RoleActionShow() {
  const { record } = useShowController();
  const { canEditResource } = useMastersCapability();

  return (
    <DigitShow
      title={record ? `Role Action: ${record.rolecode ?? record.id}` : 'Role Action'}
      hasEdit={canEditResource('role-actions')}
    >
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Role Code">{String(rec.rolecode ?? '')}</FieldRow>
            <FieldRow label="Action ID">{String(rec.actionid ?? '')}</FieldRow>
            <FieldRow label="Action Code">{String(rec.actioncode ?? '--')}</FieldRow>
            <FieldRow label="Tenant">{String(rec.tenantId ?? '--')}</FieldRow>
            <FieldRow label="Status">
              <StatusChip value={rec._isActive} labels={{ true: 'Active', false: 'Inactive' }} />
            </FieldRow>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}

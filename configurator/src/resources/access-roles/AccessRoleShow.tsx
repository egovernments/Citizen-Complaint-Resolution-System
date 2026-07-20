import { DigitShow } from '@/admin';
import { FieldSection, FieldRow } from '@/admin/fields';
import { useShowController } from 'ra-core';

export function AccessRoleShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Role: ${record.name ?? record.id}` : 'Access Role'}>
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
            <FieldRow label="Name">{String(rec.name ?? '')}</FieldRow>
            <FieldRow label="Description">{String(rec.description ?? '--')}</FieldRow>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}

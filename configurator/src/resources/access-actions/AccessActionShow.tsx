import { DigitShow } from '@/admin';
import { FieldSection, FieldRow } from '@/admin/fields';
import { useShowController } from 'ra-core';

export function AccessActionShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Action: ${record.displayName ?? record.id}` : 'Access Action'}>
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="ID">{String(rec.id ?? '')}</FieldRow>
            <FieldRow label="Display Name">{String(rec.displayName ?? '')}</FieldRow>
            <FieldRow label="URL">{String(rec.url ?? '')}</FieldRow>
            <FieldRow label="Service Name">{String(rec.serviceName ?? '--')}</FieldRow>
            <FieldRow label="Enabled">{String(rec.enabled ?? '--')}</FieldRow>
            <FieldRow label="Order Number">{String(rec.orderNumber ?? '--')}</FieldRow>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}

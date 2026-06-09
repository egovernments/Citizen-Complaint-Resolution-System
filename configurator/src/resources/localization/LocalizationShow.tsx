import { DigitShow } from '@/admin';
import { FieldSection, FieldRow } from '@/admin/fields';
import { useShowController } from 'ra-core';

export function LocalizationShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Message: ${record.code ?? record.id}` : 'Localization'} hasEdit>
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
            <FieldRow label="Message">{String(rec.message ?? '')}</FieldRow>
            <FieldRow label="Module">{String(rec.module ?? '')}</FieldRow>
            <FieldRow label="Locale">{String(rec.locale ?? '')}</FieldRow>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}

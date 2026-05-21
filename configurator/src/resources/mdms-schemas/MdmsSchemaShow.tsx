import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip, JsonViewer } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useShowController } from 'ra-core';

export function MdmsSchemaShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Schema: ${record.code ?? record.id}` : 'MDMS Schema'}>
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
            <FieldRow label="Tenant">
              {rec.tenantId ? <EntityLink resource="tenants" id={String(rec.tenantId)} /> : '--'}
            </FieldRow>
            <FieldRow label="Description">{String(rec.description ?? '--')}</FieldRow>
            <FieldRow label="Active">
              <StatusChip value={rec.isActive} labels={{ true: 'Active', false: 'Inactive' }} />
            </FieldRow>
          </FieldSection>

          {rec.definition != null && (
            <FieldSection title="Schema Definition">
              <JsonViewer data={rec.definition} />
            </FieldSection>
          )}
        </div>
      )}
    </DigitShow>
  );
}

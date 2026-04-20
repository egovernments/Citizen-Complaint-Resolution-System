import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, JsonViewer } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useShowController } from 'ra-core';

export function BoundaryShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Boundary: ${record.code ?? record.id}` : 'Boundary'} hasEdit>
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
            <FieldRow label="Boundary Type">{String(rec.boundaryType ?? '--')}</FieldRow>
            <FieldRow label="Tenant">
              {rec.tenantId ? <EntityLink resource="tenants" id={String(rec.tenantId)} /> : '--'}
            </FieldRow>
          </FieldSection>

          {rec.additionalDetails != null && (
            <FieldSection title="Additional Details">
              <JsonViewer data={rec.additionalDetails} />
            </FieldSection>
          )}

          {rec.geometry != null && (
            <FieldSection title="Geometry">
              <JsonViewer data={rec.geometry} initialExpanded={false} />
            </FieldSection>
          )}
        </div>
      )}
    </DigitShow>
  );
}

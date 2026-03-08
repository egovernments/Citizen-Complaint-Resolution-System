import { DigitShow } from '@/admin';
import { FieldSection, FieldRow } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { Badge } from '@/components/ui/badge';
import { ArrowDown } from 'lucide-react';
import { useShowController } from 'ra-core';

export function BoundaryHierarchyShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Hierarchy: ${record.hierarchyType ?? record.id}` : 'Boundary Hierarchy'}>
      {(rec: Record<string, unknown>) => {
        const levels = rec.boundaryHierarchy as Array<Record<string, unknown>> | undefined;

        return (
          <div className="space-y-6">
            <FieldSection title="Details">
              <FieldRow label="Hierarchy Type">{String(rec.hierarchyType ?? '')}</FieldRow>
              <FieldRow label="Tenant">
                {rec.tenantId ? <EntityLink resource="tenants" id={String(rec.tenantId)} /> : '--'}
              </FieldRow>
            </FieldSection>

            {levels && levels.length > 0 && (
              <FieldSection title="Hierarchy Levels">
                <div className="flex flex-col items-start gap-1">
                  {levels.map((level, i) => (
                    <div key={i} className="flex flex-col items-start">
                      <Badge variant="outline" className="text-xs">
                        {String(level.boundaryType ?? level.parentBoundaryType ?? `Level ${i + 1}`)}
                      </Badge>
                      {i < levels.length - 1 && (
                        <div className="flex items-center ml-3 my-0.5">
                          <ArrowDown className="w-3 h-3 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </FieldSection>
            )}
          </div>
        );
      }}
    </DigitShow>
  );
}

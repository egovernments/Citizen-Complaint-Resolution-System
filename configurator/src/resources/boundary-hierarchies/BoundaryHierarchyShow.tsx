import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, DateField } from '@/admin/fields';
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
        const audit = rec.auditDetails as Record<string, unknown> | undefined;
        const inactiveCount = (levels ?? []).filter((l) => l.active === false).length;

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
                  {levels.map((level, i) => {
                    const boundaryType = String(level.boundaryType ?? level.parentBoundaryType ?? `Level ${i + 1}`);
                    const isInactive = level.active === false;
                    const parent = level.parentBoundaryType ? String(level.parentBoundaryType) : null;
                    return (
                      <div key={i} className="flex flex-col items-start">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={
                              'text-xs ' +
                              (isInactive ? 'line-through text-muted-foreground opacity-60' : '')
                            }
                          >
                            {boundaryType}
                          </Badge>
                          {isInactive && (
                            <span className="text-xs text-muted-foreground">(inactive)</span>
                          )}
                          {parent && i > 0 && parent !== String(levels[i - 1]?.boundaryType ?? '') && (
                            <span className="text-xs text-amber-600" title="Parent breaks the linear chain">
                              ⚠ parent = {parent}
                            </span>
                          )}
                        </div>
                        {i < levels.length - 1 && (
                          <div className="flex items-center ml-3 my-0.5">
                            <ArrowDown className="w-3 h-3 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {inactiveCount > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {inactiveCount} inactive level{inactiveCount === 1 ? '' : 's'}.
                  </p>
                )}
              </FieldSection>
            )}

            {audit && (
              <FieldSection title="Audit">
                <FieldRow label="Created by">{String(audit.createdBy ?? '--')}</FieldRow>
                <FieldRow label="Created at">
                  <DateField value={audit.createdTime} />
                </FieldRow>
                <FieldRow label="Last modified by">{String(audit.lastModifiedBy ?? '--')}</FieldRow>
                <FieldRow label="Last modified at">
                  <DateField value={audit.lastModifiedTime} />
                </FieldRow>
              </FieldSection>
            )}
          </div>
        );
      }}
    </DigitShow>
  );
}

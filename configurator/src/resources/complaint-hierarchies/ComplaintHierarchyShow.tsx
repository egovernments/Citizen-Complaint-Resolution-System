import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, DateField } from '@/admin/fields';
import { Badge } from '@/components/ui/badge';
import { ArrowDown } from 'lucide-react';
import { useShowController } from 'ra-core';

export function ComplaintHierarchyShow() {
  const { record } = useShowController();

  return (
    <DigitShow
      title={record ? `Hierarchy: ${record.hierarchyType ?? record.id}` : 'Complaint Hierarchy'}
    >
      {(rec: Record<string, unknown>) => {
        const levels = (rec.levels as Array<Record<string, unknown>> | undefined) ?? [];
        const ordered = [...levels].sort(
          (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
        );
        const audit = rec.auditDetails as Record<string, unknown> | undefined;

        return (
          <div className="space-y-6">
            <FieldSection title="Details">
              <FieldRow label="Hierarchy Type">{String(rec.hierarchyType ?? '')}</FieldRow>
              <FieldRow label="Levels">{String(ordered.length)}</FieldRow>
            </FieldSection>

            {ordered.length > 0 && (
              <FieldSection title="Hierarchy Levels (top → leaf)">
                <div className="flex flex-col items-start gap-1">
                  {ordered.map((level, i) => {
                    const code = String(level.levelCode ?? `Level ${i + 1}`);
                    const isLeaf = !!level.isLeafServiceCode;
                    return (
                      <div key={i} className="flex flex-col items-start">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {code}
                          </Badge>
                          {isLeaf && (
                            <span className="text-xs text-emerald-600">
                              leaf · serviceCode level
                            </span>
                          )}
                        </div>
                        {i < ordered.length - 1 && (
                          <div className="flex items-center ml-3 my-0.5">
                            <ArrowDown className="w-3 h-3 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </FieldSection>
            )}

            {audit && (
              <FieldSection title="Audit">
                <FieldRow label="Created by">{String(audit.createdBy ?? '--')}</FieldRow>
                <FieldRow label="Created at">
                  <DateField value={audit.createdTime} />
                </FieldRow>
              </FieldSection>
            )}
          </div>
        );
      }}
    </DigitShow>
  );
}

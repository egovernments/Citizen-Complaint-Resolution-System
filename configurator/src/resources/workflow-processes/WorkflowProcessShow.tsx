import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useShowController } from 'ra-core';

export function WorkflowProcessShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Process: ${record.businessId ?? record.id}` : 'Workflow Process'}>
      {(rec: Record<string, unknown>) => {
        const state = rec.state as Record<string, unknown> | undefined;
        const audit = rec.auditDetails as Record<string, unknown> | undefined;
        const assignes = rec.assignes as Array<Record<string, unknown>> | undefined;

        return (
          <div className="space-y-6">
            <FieldSection title="Details">
              <FieldRow label="Business ID">
                {rec.businessId ? <EntityLink resource="complaints" id={String(rec.businessId)} label={String(rec.businessId)} /> : '--'}
              </FieldRow>
              <FieldRow label="Action">{String(rec.action ?? '--')}</FieldRow>
              <FieldRow label="State"><StatusChip value={state?.state ?? rec.state} /></FieldRow>
              <FieldRow label="Comment">{String(rec.comment ?? '--')}</FieldRow>
            </FieldSection>

            {assignes && assignes.length > 0 && (
              <FieldSection title="Assignees">
                <div className="flex flex-wrap gap-1">
                  {assignes.map((a, i) => (
                    <EntityLink key={i} resource="users" id={String(a.uuid ?? '')} label={String(a.name ?? a.uuid ?? '')} />
                  ))}
                </div>
              </FieldSection>
            )}

            <FieldSection title="Audit">
              <FieldRow label="Created"><DateField value={audit?.createdTime} /></FieldRow>
              <FieldRow label="Last Modified"><DateField value={audit?.lastModifiedTime} /></FieldRow>
            </FieldSection>
          </div>
        );
      }}
    </DigitShow>
  );
}

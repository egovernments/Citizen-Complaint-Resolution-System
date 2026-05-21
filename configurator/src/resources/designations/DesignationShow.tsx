import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, ReverseReferenceList, StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { useShowController } from 'ra-core';

export function DesignationShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Designation: ${record.name ?? record.id}` : 'Designation'} hasEdit>
      {(rec: Record<string, unknown>) => {
        const raw = rec.department;
        const deptCodes: string[] = Array.isArray(raw)
          ? (raw.filter((x) => typeof x === 'string') as string[])
          : typeof raw === 'string' && raw
          ? [raw]
          : [];

        return (
          <div className="space-y-6">
            <FieldSection title="Details">
              <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
              <FieldRow label="Name">{String(rec.name ?? '')}</FieldRow>
              <FieldRow label="Status">
                <StatusChip value={rec.active} labels={{ true: 'Active', false: 'Inactive' }} />
              </FieldRow>
              <FieldRow label="Description">{String(rec.description ?? '--')}</FieldRow>
              <FieldRow label="Departments">
                {deptCodes.length === 0 ? (
                  <span className="text-muted-foreground">--</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {deptCodes.map((code) => (
                      <EntityLink key={code} resource="departments" id={code} />
                    ))}
                  </div>
                )}
              </FieldRow>
            </FieldSection>

            <FieldSection title="Related">
              <ReverseReferenceList
                resource="employees"
                target="assignments.designation"
                id={String(rec.code ?? rec.id)}
                label="Employees"
                displayField="code"
              />
            </FieldSection>
          </div>
        );
      }}
    </DigitShow>
  );
}

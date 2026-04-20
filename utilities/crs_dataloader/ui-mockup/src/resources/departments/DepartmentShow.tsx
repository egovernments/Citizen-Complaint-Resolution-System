import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, ReverseReferenceList } from '@/admin/fields';
import { StatusChip } from '@/admin/fields';
import { useShowController } from 'ra-core';

export function DepartmentShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Department: ${record.name ?? record.id}` : 'Department'} hasEdit>
      {(rec: Record<string, unknown>) => (
        <div className="space-y-6">
          <FieldSection title="Details">
            <FieldRow label="Code">{String(rec.code ?? '')}</FieldRow>
            <FieldRow label="Name">{String(rec.name ?? '')}</FieldRow>
            <FieldRow label="Status">
              <StatusChip value={rec.active} labels={{ true: 'Active', false: 'Inactive' }} />
            </FieldRow>
            <FieldRow label="Description">{String(rec.description ?? '--')}</FieldRow>
          </FieldSection>

          <FieldSection title="Related">
            <ReverseReferenceList
              resource="complaint-types"
              target="department"
              id={String(rec.code ?? rec.id)}
              label="Complaint Types"
              displayField="name"
            />
            <div className="mt-4">
              <ReverseReferenceList
                resource="employees"
                target="assignments.department"
                id={String(rec.code ?? rec.id)}
                label="Employees"
                displayField="code"
              />
            </div>
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}

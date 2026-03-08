import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, ReverseReferenceList } from '@/admin/fields';
import { StatusChip } from '@/admin/fields';
import { useShowController } from 'ra-core';

export function DesignationShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Designation: ${record.name ?? record.id}` : 'Designation'} hasEdit>
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
              resource="employees"
              target="assignments.designation"
              id={String(rec.code ?? rec.id)}
              label="Employees"
              displayField="code"
            />
          </FieldSection>
        </div>
      )}
    </DigitShow>
  );
}

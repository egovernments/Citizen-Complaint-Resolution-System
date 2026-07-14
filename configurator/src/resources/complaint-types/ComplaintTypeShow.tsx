import { DigitShow } from '@/admin';
import { FieldSection, FieldRow, ReverseReferenceList } from '@/admin/fields';
import { StatusChip } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { Badge } from '@/components/ui/badge';
import { useShowController } from 'ra-core';

export function ComplaintTypeShow() {
  const { record } = useShowController();

  return (
    <DigitShow title={record ? `Complaint Type: ${record.name ?? record.id}` : 'Complaint Type'} hasEdit>
      {(rec: Record<string, unknown>) => {
        const keywords = rec.keywords as string[] | string | undefined;
        const keywordList = Array.isArray(keywords) ? keywords : (typeof keywords === 'string' ? keywords.split(',').map(k => k.trim()) : []);
        // A complaint type can map to MANY departments; `department` is the primary.
        const deptList =
          Array.isArray(rec.departments) && rec.departments.length
            ? (rec.departments as string[])
            : rec.department
            ? [String(rec.department)]
            : [];

        return (
          <div className="space-y-6">
            <FieldSection title="Details">
              <FieldRow label="Parent (group code)">{String(rec.parentCode ?? '--')}</FieldRow>
              <FieldRow label={deptList.length > 1 ? 'Departments' : 'Department'}>
                {deptList.length ? (
                  <div className="flex flex-wrap gap-1">
                    {deptList.map((d) => (
                      <EntityLink key={d} resource="departments" id={d} />
                    ))}
                  </div>
                ) : (
                  '--'
                )}
              </FieldRow>
              <FieldRow label="SLA (hours)">{String(rec.slaHours ?? '--')}</FieldRow>
              <FieldRow label="Status">
                <StatusChip value={rec.active} labels={{ true: 'Active', false: 'Inactive' }} />
              </FieldRow>
              {keywordList.length > 0 && (
                <FieldRow label="Keywords">
                  <div className="flex flex-wrap gap-1">
                    {keywordList.map((kw) => (
                      <Badge key={kw} variant="secondary" className="text-xs">{kw}</Badge>
                    ))}
                  </div>
                </FieldRow>
              )}
              <FieldRow label="Complaint Sub-Type">{String(rec.name ?? '')}</FieldRow>
              <FieldRow label="Service Code">{String(rec.serviceCode ?? '')}</FieldRow>
            </FieldSection>

            <FieldSection title="Related">
              <ReverseReferenceList
                resource="complaints"
                target="serviceCode"
                id={String(rec.serviceCode ?? rec.id)}
                label="Recent Complaints"
                displayField="serviceRequestId"
              />
            </FieldSection>
          </div>
        );
      }}
    </DigitShow>
  );
}

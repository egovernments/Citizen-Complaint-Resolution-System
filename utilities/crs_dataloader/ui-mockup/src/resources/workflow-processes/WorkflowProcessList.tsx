import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  {
    source: 'businessId',
    label: 'Business ID',
    render: (record) => {
      const id = String(record.businessId ?? '');
      return id ? <EntityLink resource="complaints" id={id} label={id} /> : <span className="text-muted-foreground">--</span>;
    },
  },
  { source: 'action', label: 'Action' },
  {
    source: 'state',
    label: 'State',
    sortable: false,
    render: (record) => {
      const state = record.state as Record<string, unknown> | undefined;
      return <StatusChip value={state?.state ?? record.state} />;
    },
  },
  {
    source: 'auditDetails.createdTime',
    label: 'Created',
    render: (record) => {
      const audit = record.auditDetails as Record<string, unknown> | undefined;
      return <DateField value={audit?.createdTime} />;
    },
  },
];

export function WorkflowProcessList() {
  return (
    <DigitList title="Workflow Processes" sort={{ field: 'auditDetails.createdTime', order: 'DESC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

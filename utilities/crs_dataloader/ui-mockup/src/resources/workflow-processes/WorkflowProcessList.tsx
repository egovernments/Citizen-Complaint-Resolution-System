import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  {
    source: 'businessId',
    label: 'app.fields.business_id',
    render: (record) => {
      const id = String(record.businessId ?? '');
      return id ? <EntityLink resource="complaints" id={id} label={id} /> : <span className="text-muted-foreground">--</span>;
    },
  },
  { source: 'action', label: 'app.fields.action' },
  {
    source: 'state',
    label: 'app.fields.state',
    sortable: false,
    render: (record) => {
      const state = record.state as Record<string, unknown> | undefined;
      return <StatusChip value={state?.state ?? record.state} />;
    },
  },
  {
    source: 'auditDetails.createdTime',
    label: 'app.fields.created',
    render: (record) => {
      const audit = record.auditDetails as Record<string, unknown> | undefined;
      return <DateField value={audit?.createdTime} />;
    },
  },
];

export function WorkflowProcessList() {
  return (
    <DigitList title="app.resources.workflow_processes" sort={{ field: 'auditDetails.createdTime', order: 'DESC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

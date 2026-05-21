import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';

const columns: DigitColumn[] = [
  { source: 'businessService', label: 'app.fields.business_service' },
  { source: 'business', label: 'app.fields.business' },
  {
    source: 'businessServiceSla',
    label: 'app.fields.sla',
    render: (record) => {
      const sla = Number(record.businessServiceSla);
      if (!sla) return <span className="text-muted-foreground">--</span>;
      const days = Math.round(sla / (1000 * 60 * 60 * 24));
      return <span>{days} day{days !== 1 ? 's' : ''}</span>;
    },
  },
];

export function WorkflowServiceList() {
  return (
    <DigitList title="app.resources.workflow_services" sort={{ field: 'businessService', order: 'ASC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

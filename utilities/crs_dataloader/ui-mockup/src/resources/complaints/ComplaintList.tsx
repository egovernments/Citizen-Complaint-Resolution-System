import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

const columns: DigitColumn[] = [
  { source: 'serviceRequestId', label: 'app.fields.request_id' },
  {
    source: 'serviceCode',
    label: 'app.fields.type',
    render: (record) => {
      const code = String(record.serviceCode ?? '');
      return code ? <EntityLink resource="complaint-types" id={code} /> : <span className="text-muted-foreground">--</span>;
    },
  },
  {
    source: 'description',
    label: 'app.fields.description',
    render: (record) => {
      const desc = String(record.description ?? '');
      return <span className="truncate max-w-[200px] block">{desc.length > 60 ? desc.slice(0, 60) + '...' : desc}</span>;
    },
  },
  {
    source: 'applicationStatus',
    label: 'app.fields.status',
    render: (record) => <StatusChip value={record.applicationStatus} />,
  },
  {
    source: 'citizen',
    label: 'app.fields.citizen',
    sortable: false,
    render: (record) => {
      const citizen = record.citizen as Record<string, unknown> | undefined;
      return <span>{String(citizen?.name ?? '--')}</span>;
    },
  },
  {
    source: 'address.locality.code',
    label: 'app.fields.locality',
    sortable: false,
    render: (record) => {
      const address = record.address as Record<string, unknown> | undefined;
      const locality = address?.locality as Record<string, unknown> | undefined;
      const code = String(locality?.code ?? '');
      return code ? <EntityLink resource="boundaries" id={code} /> : <span className="text-muted-foreground">--</span>;
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

export function ComplaintList() {
  return (
    <DigitList title="app.resources.complaints" hasCreate sort={{ field: 'auditDetails.createdTime', order: 'DESC' }}>
      <DigitDatagrid columns={columns} rowClick="show" />
    </DigitList>
  );
}

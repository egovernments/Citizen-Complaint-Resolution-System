import {
  DigitList,
  DigitDatagrid,
  SelectFilterInput,
  TextFilterInput,
} from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

// Delivery channels novu-bridge writes to nb_dispatch_log. Every event lands
// here with an explicit terminal status; WHATSAPP has no enabled provider yet,
// so those rows show up as SKIPPED/NB_NO_PROVIDER rather than being invisible
// (see the backend DispatchLogController javadoc).
const CHANNEL_CHOICES = [
  { id: 'SMS', name: 'SMS' },
  { id: 'EMAIL', name: 'Email' },
  { id: 'WHATSAPP', name: 'WhatsApp' },
];

// Coarse delivery states persisted on the log row.
const STATUS_CHOICES = [
  { id: 'SENT', name: 'Sent' },
  { id: 'DELIVERED', name: 'Delivered' },
  { id: 'FAILED', name: 'Failed' },
  { id: 'PENDING', name: 'Pending' },
  { id: 'SKIPPED', name: 'Skipped' },
];

const filters = [
  // referenceNumber is the real search — the data provider maps the explicit
  // inputs below onto server-side query params. (A generic `q` quick-search was
  // removed: the dataProvider drops `q` for this resource, so it was a dead
  // field operators typed into.)
  <TextFilterInput key="referenceNumber" source="referenceNumber" label="Complaint #" alwaysOn />,
  <SelectFilterInput key="channel" source="channel" label="Channel" choices={CHANNEL_CHOICES} alwaysOn />,
  <SelectFilterInput key="status" source="status" label="Status" choices={STATUS_CHOICES} alwaysOn />,
];

/** Mask a recipient (phone/email) so the log never renders a full PII value:
 *  keep the domain for emails, the last 3 digits for phones.
 *  Server also masks recipient_value/transaction_id (novu-bridge PiiMask) — this
 *  is defense-in-depth for older bridges. */
function maskRecipient(value: unknown): string {
  const s = String(value ?? '');
  if (!s) return '--';
  if (s.includes('@')) {
    const [local, domain] = s.split('@');
    const head = local.slice(0, 1);
    return `${head}***@${domain}`;
  }
  if (s.length <= 3) return '***';
  return `***${s.slice(-3)}`;
}

const columns: DigitColumn[] = [
  {
    source: 'createdTime',
    label: 'app.fields.created',
    render: (record) => <DateField value={record.createdTime} />,
  },
  {
    source: 'referenceNumber',
    label: 'Complaint',
    sortable: false,
    render: (record) => {
      const ref = String(record.referenceNumber ?? '');
      return ref ? (
        <EntityLink resource="complaints" id={ref} label={ref} />
      ) : (
        <span className="text-muted-foreground">--</span>
      );
    },
  },
  { source: 'channel', label: 'Channel', sortable: false },
  {
    source: 'status',
    label: 'app.fields.status',
    sortable: false,
    render: (record) => <StatusChip value={record.status} />,
  },
  {
    source: 'recipientValue',
    label: 'Recipient',
    sortable: false,
    render: (record) => (
      <span className="font-mono text-xs">{maskRecipient(record.recipientValue)}</span>
    ),
  },
  {
    source: 'templateKey',
    label: 'Template',
    sortable: false,
    render: (record) => {
      const key = String(record.templateKey ?? '');
      const ver = record.templateVersion ? ` v${record.templateVersion}` : '';
      return key ? (
        <span className="font-mono text-xs">{key}{ver}</span>
      ) : (
        <span className="text-muted-foreground">--</span>
      );
    },
  },
  {
    source: 'attemptCount',
    label: 'Attempts',
    sortable: false,
    render: (record) => <span>{String(record.attemptCount ?? 0)}</span>,
  },
  {
    source: 'lastErrorMessage',
    label: 'Error',
    sortable: false,
    render: (record) => {
      const code = record.lastErrorCode ? String(record.lastErrorCode) : '';
      const msg = record.lastErrorMessage ? String(record.lastErrorMessage) : '';
      if (!code && !msg) return <span className="text-muted-foreground">--</span>;
      const text = [code, msg].filter(Boolean).join(': ');
      return (
        <span className="text-destructive text-xs truncate max-w-[240px] block" title={text}>
          {text.length > 80 ? text.slice(0, 80) + '…' : text}
        </span>
      );
    },
  },
];

/**
 * Read-only delivery-log viewer backed by the novu-bridge proxy
 * (`GET /novu-bridge/novu-adapter/v1/logs`). Lists every notification event
 * novu-bridge processed, newest first, with an explicit terminal status
 * (SENT / SKIPPED / FAILED); WHATSAPP has no enabled provider yet, so those
 * rows appear as SKIPPED/NB_NO_PROVIDER.
 */
export function NotificationLogList() {
  return (
    <DigitList
      title="Notification Logs"
      subtitle="SMS/Email delivered via Novu — WHATSAPP shows as SKIPPED (no provider yet)"
      sort={{ field: 'createdTime', order: 'DESC' }}
      filters={filters}
    >
      <DigitDatagrid columns={columns} />
    </DigitList>
  );
}

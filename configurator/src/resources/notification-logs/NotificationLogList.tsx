import {
  DigitList,
  DigitDatagrid,
  SearchFilterInput,
  SelectFilterInput,
  TextFilterInput,
} from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';

// Delivery channels novu-bridge writes to nb_dispatch_log. WhatsApp only shows
// up here when it went through the Novu path; direct Baileys/Telegram sends
// bypass Novu and are NOT logged (observability boundary — see the backend
// DispatchLogController javadoc).
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
  // The list quick-search box also emits `q`; keep it so the search field
  // renders, but the real filtering is done by the explicit inputs below,
  // which the data provider maps onto server-side query params.
  <SearchFilterInput key="q" source="q" alwaysOn />,
  <TextFilterInput key="referenceNumber" source="referenceNumber" label="Complaint #" alwaysOn />,
  <SelectFilterInput key="channel" source="channel" label="Channel" choices={CHANNEL_CHOICES} alwaysOn />,
  <SelectFilterInput key="status" source="status" label="Status" choices={STATUS_CHOICES} alwaysOn />,
];

/** Mask a recipient (phone/email) so the log never renders a full PII value:
 *  keep the domain for emails, the last 3 digits for phones. */
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
 * (`GET /novu-bridge/novu-adapter/v1/logs`). Lists SMS/Email notifications
 * novu-bridge delivered via Novu, newest first. Not a complete notification
 * audit: direct Baileys/Telegram WhatsApp sends bypass Novu and aren't logged.
 */
export function NotificationLogList() {
  return (
    <DigitList
      title="Notification Logs"
      subtitle="Novu-delivered SMS/Email — direct WhatsApp not tracked"
      sort={{ field: 'createdTime', order: 'DESC' }}
      filters={filters}
    >
      <DigitDatagrid columns={columns} />
    </DigitList>
  );
}

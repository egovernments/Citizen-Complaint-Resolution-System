import {
  DigitList,
  DigitDatagrid,
  SelectFilterInput,
  TextFilterInput,
} from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip, DateField } from '@/admin/fields';
import { EntityLink } from '@/components/ui/EntityLink';
import {
  CHANNEL_CHOICES,
  SOURCE_PATH_CHOICES,
  SOURCE_PATH_HELP,
  STATUS_CHOICES,
  TEST_CHOICES,
  channelDisplay,
  recipientDisplay,
  sourcePathDisplay,
} from './notificationLogDisplay';

// Every choice list, label and row→cell rule lives in notificationLogDisplay.ts
// (pure, unit-tested). This file is wiring only.
//
// Delivery outcomes novu-bridge writes to nb_dispatch_log. Every event lands
// here with an explicit terminal status; a channel with no enabled provider
// shows up as SKIPPED/NB_NO_PROVIDER rather than being invisible (see the
// backend DispatchLogController javadoc). A channel whose SELECTED provider has
// been deleted, disabled or points at another Novu channel is
// SKIPPED/NB_PROVIDER_UNAVAILABLE instead — the bridge refuses to trigger it
// rather than reporting SENT for a message Novu would silently drop. Some
// outcomes have no channel at all (nobody routed, nobody found): those rows
// carry channel NONE and are reachable from the Channel filter.
// Error codes are rendered verbatim in the Error column (there is no code->label
// map): the bridge's message already names the provider and the reason.

const filters = [
  // referenceNumber is the real search — the data provider maps the explicit
  // inputs below onto server-side query params. (A generic `q` quick-search was
  // removed: the dataProvider drops `q` for this resource, so it was a dead
  // field operators typed into.)
  <TextFilterInput key="referenceNumber" source="referenceNumber" label="Complaint #" alwaysOn />,
  <SelectFilterInput key="channel" source="channel" label="Channel" choices={CHANNEL_CHOICES} alwaysOn />,
  <SelectFilterInput key="status" source="status" label="Status" choices={STATUS_CHOICES} alwaysOn />,
  <SelectFilterInput key="sourcePath" source="sourcePath" label="Produced by" choices={SOURCE_PATH_CHOICES} alwaysOn />,
  <SelectFilterInput key="includeTest" source="includeTest" label="Test sends" choices={TEST_CHOICES} alwaysOn />,
];

/** Muted text is a non-value ("--", "none", "No channel") — never a badge, so a
 *  channel-less row does not paint an empty chip. */
function Cell({ text, muted, mono }: { text: string; muted: boolean; mono?: boolean }) {
  const cls = [mono ? 'font-mono text-xs' : '', muted ? 'text-muted-foreground' : '']
    .filter(Boolean)
    .join(' ');
  return <span className={cls || undefined}>{text}</span>;
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
  {
    source: 'channel',
    label: 'Channel',
    sortable: false,
    render: (record) => <Cell {...channelDisplay(record.channel)} />,
  },
  {
    source: 'status',
    label: 'app.fields.status',
    sortable: false,
    render: (record) => <StatusChip value={record.status} />,
  },
  {
    source: 'sourcePath',
    label: 'Produced by',
    sortable: false,
    render: (record) => <Cell {...sourcePathDisplay(record.sourcePath)} />,
  },
  {
    source: 'recipientValue',
    label: 'Recipient',
    sortable: false,
    render: (record) => <Cell {...recipientDisplay(record)} mono />,
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
    source: 'providerRef',
    label: 'Provider ref',
    sortable: false,
    render: (record) => {
      const ref = String(record.providerRef ?? '');
      const test = record.isTest ? ' · test' : '';
      return ref || test ? <span className="font-mono text-xs">{ref}{test}</span> : <span className="text-muted-foreground">--</span>;
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
 * (SENT / SKIPPED / FAILED / REJECTED, and DELIVERED / BOUNCED once provider receipts are
 * wired), and which half produced it (`sourcePath`). Test sends are flagged rows
 * at this tenant, shown on request.
 */
export function NotificationLogList() {
  return (
    <DigitList
      title="Notification Logs"
      subtitle="One row per recipient × channel — SENT means the transport accepted it; DELIVERED needs provider receipts"
      sort={{ field: 'createdTime', order: 'DESC' }}
      filters={filters}
    >
      <p className="mb-3 text-xs text-muted-foreground">{SOURCE_PATH_HELP}</p>
      <DigitDatagrid columns={columns} />
    </DigitList>
  );
}

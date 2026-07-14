import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';

/** Read a channel's consent status off a preference row and render it as a
 *  GRANTED/REVOKED chip. Missing consent for a channel shows a neutral --. */
function consent(record: Record<string, unknown>, channel: 'WHATSAPP' | 'SMS' | 'EMAIL') {
  const block = record.consent as Record<string, { status?: unknown }> | undefined;
  const status = block?.[channel]?.status;
  if (status == null || status === '') return <span className="text-muted-foreground">--</span>;
  return <StatusChip value={String(status)} />;
}

const columns: DigitColumn[] = [
  {
    source: 'userId',
    label: 'User',
    sortable: false,
    render: (record) => {
      const id = String(record.userId ?? '');
      return id ? (
        <span className="font-mono text-xs">{id}</span>
      ) : (
        <span className="text-muted-foreground">--</span>
      );
    },
  },
  {
    source: 'preferredLanguage',
    label: 'Preferred Language',
    sortable: false,
    render: (record) => <span>{String(record.preferredLanguage ?? '--')}</span>,
  },
  {
    source: 'consent.WHATSAPP',
    label: 'WhatsApp',
    sortable: false,
    render: (record) => consent(record, 'WHATSAPP'),
  },
  {
    source: 'consent.SMS',
    label: 'SMS',
    sortable: false,
    render: (record) => consent(record, 'SMS'),
  },
  {
    source: 'consent.EMAIL',
    label: 'Email',
    sortable: false,
    render: (record) => consent(record, 'EMAIL'),
  },
];

/**
 * Read-only view of per-user notification preferences, served by the novu-bridge
 * proxy (`GET /novu-bridge/novu-adapter/v1/preferences`). Each row is one user's
 * per-channel consent (WhatsApp / SMS / Email as GRANTED/REVOKED) plus their
 * preferredLanguage. Mirrors the Notification Providers screen: a custom-path GET
 * list, no create/edit/delete.
 */
export function NotificationPreferenceList() {
  return (
    <DigitList
      title="User Preferences"
      subtitle="Per-user notification consent — read-only"
      sort={{ field: 'userId', order: 'ASC' }}
    >
      <DigitDatagrid columns={columns} rowActions="none" />
    </DigitList>
  );
}

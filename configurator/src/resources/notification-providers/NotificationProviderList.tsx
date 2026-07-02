import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';

/** Render a boolean flag as a compact yes/no chip. */
function flag(value: unknown) {
  return <StatusChip value={value ? 'YES' : 'NO'} />;
}

const columns: DigitColumn[] = [
  { source: 'channel', label: 'Channel', sortable: false },
  {
    source: 'providerId',
    label: 'Provider',
    sortable: false,
    render: (record) => {
      const id = String(record.providerId ?? record.name ?? '');
      return id ? (
        <span className="font-mono text-xs">{id}</span>
      ) : (
        <span className="text-muted-foreground">--</span>
      );
    },
  },
  {
    source: 'name',
    label: 'Name',
    sortable: false,
    render: (record) => <span>{String(record.name ?? '--')}</span>,
  },
  {
    source: 'active',
    label: 'Active',
    sortable: false,
    render: (record) => flag(record.active),
  },
  {
    source: 'primary',
    label: 'Primary',
    sortable: false,
    render: (record) => flag(record.primary),
  },
  {
    source: 'credentials',
    label: 'Credentials',
    sortable: false,
    render: (record) => {
      // The backend masks every credential value to "***" before it reaches
      // the browser, so we only surface which credential keys are configured —
      // never any secret. If a provider carries no credentials block, show --.
      const creds = record.credentials as Record<string, unknown> | undefined;
      const keys = creds ? Object.keys(creds).filter((k) => creds[k] != null) : [];
      if (keys.length === 0) return <span className="text-muted-foreground">--</span>;
      return (
        <span className="font-mono text-xs" title="Values are redacted server-side">
          {keys.join(', ')} <span className="text-muted-foreground">(redacted)</span>
        </span>
      );
    },
  },
];

/**
 * Read-only view of the configured Novu provider integrations, served by the
 * novu-bridge proxy (`GET /novu-bridge/novu-adapter/v1/integrations`). The
 * proxy calls Novu server-side with its ApiKey (never exposed to this keyless
 * SPA) and redacts every credential value to "***" before returning. This
 * screen therefore shows provider config (channel, id, active/primary, which
 * credential keys exist) but no secrets.
 */
export function NotificationProviderList() {
  return (
    <DigitList
      title="Notification Providers"
      subtitle="Novu integrations — credentials redacted server-side"
      sort={{ field: 'channel', order: 'ASC' }}
    >
      <DigitDatagrid columns={columns} rowActions="none" />
    </DigitList>
  );
}

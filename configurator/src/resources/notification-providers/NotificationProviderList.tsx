import { useMemo, useState } from 'react';
import { useTranslate } from 'ra-core';
import { RefreshCw } from 'lucide-react';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { StatusChip } from '@/admin/fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  integrationChannel, integrationKey, isDeliverableIntegration, isProviderAdmin, providerTypeLabelKey, findProviderType,
  type IntegrationRow,
} from './providerApi';
import { selectionsByProvider } from './channelStatus';
import { SyncTwilioTemplatesDialog } from './SyncTwilioTemplatesDialog';
import { AddProviderDialog } from './AddProviderDialog';
import { ProviderRowActions } from './ProviderRowActions';
import { useProviderCatalog } from './useProviderCatalog';
import { useChannelRows } from './useChannelRows';
import { useApp } from '../../App';

/** Render a boolean flag as a compact yes/no chip. */
function flag(value: unknown) {
  return <StatusChip value={value ? 'YES' : 'NO'} />;
}

// ---------------------------------------------------------------------------
// "Sync WhatsApp templates" — opens the map-and-confirm dialog that pulls the
// operator's approved Twilio Content templates from the bridge and persists the
// selected routing rows into MDMS NotificationProviderTemplate. Sits beside Add
// Provider so it's discoverable right where operators manage their Twilio setup.
// ---------------------------------------------------------------------------
function SyncTemplatesAction() {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <RefreshCw className="w-4 h-4" />
        {t('app.providers.sync_action', { _: 'Sync WhatsApp templates' })}
      </Button>
      <SyncTwilioTemplatesDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Notification provider integrations served by the novu-bridge proxy
 * (`GET /novu-bridge/novu-adapter/v1/integrations`). The proxy calls the
 * notification service server-side with its ApiKey (never exposed to this keyless
 * SPA) and redacts every credential value before returning.
 *
 * The screen is driven by the bridge's provider catalog
 * (`GET /providers/catalog`): provider types, their credential fields and whether
 * verify / test-send are supported all come from there, so adding a provider type
 * on the bridge needs no change here. The operator adds, renames, rotates,
 * enables/disables and deletes providers without touching env files, redeploying,
 * or opening the notification vendor's own dashboard.
 *
 * Which provider a channel actually uses is chosen on Notifications → Channels —
 * exactly one active provider per channel per state tenant.
 */
export function NotificationProviderList() {
  const t = useTranslate();
  const catalogState = useProviderCatalog();
  const { catalog } = catalogState;
  const { rows: channelRows, stateTenant } = useChannelRows();
  // Add / rename / rotate / enable / disable / delete / test are admin-only on the
  // bridge; offering them to everyone meant non-admins only learned that from a 403.
  const { state } = useApp();
  const canManage = isProviderAdmin(state.user?.roles);

  const selected = useMemo(() => selectionsByProvider(channelRows), [channelRows]);
  const channelOf = (record: IntegrationRow) => {
    const key = integrationKey(record).toLowerCase();
    const byKey = key ? selected.get(key) : undefined;
    const byId = String(record._id ?? record.id ?? '').toLowerCase();
    return byKey ?? (byId ? selected.get(byId) : undefined);
  };

  const columns = useMemo<DigitColumn[]>(() => [
    {
      source: 'channel',
      label: 'app.providers.col_channel',
      sortable: false,
      // The catalog `type` decides the channel; the legacy identifier/name marker
      // is the fallback for integrations created before types existed (Novu stores
      // WhatsApp as a Twilio `sms` integration). A row with no DIGIT channel is
      // filtered out below, so the dash is only ever a belt-and-braces fallback.
      render: (record) => <span>{integrationChannel(record as IntegrationRow, catalog) ?? '--'}</span>,
    },
    {
      source: 'type',
      label: 'app.providers.col_type',
      sortable: false,
      render: (record) => {
        const pt = findProviderType(catalog, (record as IntegrationRow).type);
        if (pt) return <span>{t(providerTypeLabelKey(pt.type), { _: pt.label })}</span>;
        const legacy = String(record.providerId ?? '');
        return legacy ? (
          <span className="font-mono text-xs text-muted-foreground" title={t('app.providers.type_legacy', { _: 'Created before provider types existed' })}>
            {legacy}
          </span>
        ) : (
          <span className="text-muted-foreground">--</span>
        );
      },
    },
    {
      source: 'name',
      label: 'app.providers.col_name',
      sortable: false,
      render: (record) => <span>{String(record.name ?? '--')}</span>,
    },
    {
      source: 'active',
      label: 'app.providers.col_active',
      sortable: false,
      render: (record) => flag(record.active),
    },
    {
      source: 'selected',
      label: 'app.providers.col_selected',
      sortable: false,
      render: (record) => {
        const channel = channelOf(record as IntegrationRow);
        return channel ? (
          <Badge variant="success" className="text-[10px]">
            {t('app.providers.selected_for', { _: 'Active for' })} {channel}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t('app.providers.not_selected', { _: 'Not selected' })}
          </span>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [catalog, selected, t]);

  // Title spelled out rather than taken from app.nav.notification_providers:
  // that key is the SIDEBAR label, which is just "Providers" inside a menu
  // already titled Notifications. A page title has to stand on its own.
  return (
    <DigitList
      title="Notification Providers"
      subtitle={t('app.providers.subtitle', {
        _: 'Delivery accounts. Credentials are stored by the notification service and never shown again. Choose which one each channel uses under Channels.',
      })}
      sort={{ field: 'channel', order: 'ASC' }}
      // Novu hosts integrations we do not deliver on — every workspace ships a
      // built-in "Novu Inbox" on `in_app`. They are not DIGIT providers: listing
      // them offered Check status / Test / Rotate / Delete on something with no
      // credentials and no channel, and counted them in the header badge.
      recordFilter={(record) => isDeliverableIntegration(record as IntegrationRow, catalog)}
      actions={
        <div className="flex items-center gap-2">
          <SyncTemplatesAction />
          {canManage ? (
            <AddProviderDialog catalogState={catalogState} />
          ) : (
            <span className="text-xs text-muted-foreground max-w-xs">
              {t('app.providers.admin_only', {
                _: 'Read-only: adding, changing or testing a provider needs the SUPERUSER, MDMS_ADMIN or ACCOUNT_ADMIN role at the state tenant.',
              })}
            </span>
          )}
        </div>
      }
    >
      <DigitDatagrid
        columns={columns}
        rowActions={(record) => (
          <ProviderRowActions
            record={record as IntegrationRow}
            catalog={catalog}
            selectedForChannel={channelOf(record as IntegrationRow)}
            stateTenant={stateTenant}
            canManage={canManage}
          />
        )}
      />
    </DigitList>
  );
}

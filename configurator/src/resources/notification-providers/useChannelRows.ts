// The tenant's channel-policy rows, read where novu-bridge reads them: at the
// STATE tenant. Shared by the Providers list (to show which provider a channel
// has selected) and the Channels page card (to change that selection).
//
// TWO MASTERS, ONE ANSWER. The policy moved from `RAINMAKER-PGR.NotificationChannel`
// to `NOTIFICATIONS.Channel` — same shape, module-neutral content, different
// namespace. On a tenant whose deploy-time copy has not run, the legacy rows are
// still what the bridge enforces, so this hook reads both and lets
// selectNotificationSource decide which one is live. The legacy rows are shown
// READ-ONLY: writing them would leave the tenant with two policies, and the
// copy step (create-only) would then keep the pre-edit values.
//
// The decision here is made on the CHANNEL master alone, deliberately, and not
// on the whole notification configuration: the bridge reads this master through
// its own configurable schema code, so it is the one master that can legitimately
// move ahead of (or behind) the rest.
//
// MDMS writes land in the SESSION tenant, so a session scoped to a city can read the
// state-level policy but must not write it — `scopedToCity` is what the UI disables on.
import { useGetList } from 'ra-core';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../../App';
import { selectNotificationSource, type SourceDecision } from '../notification-configure/notificationSource';
import type { ChannelRow } from './channelStatus';

/** The master the UI WRITES. Never the legacy one. */
export const CHANNEL_RESOURCE = 'notifications-channel';
/** The master the UI still READS on an un-migrated tenant. */
export const LEGACY_CHANNEL_RESOURCE = 'notification-channel';

export interface ChannelRowsState {
  rows: ChannelRow[];
  isLoading: boolean;
  sessionTenant: string;
  stateTenant: string;
  scopedToCity: boolean;
  /** Which namespace served these rows, and the banner text for it. */
  decision: SourceDecision;
  /** True when the rows shown cannot be edited from here (legacy, or unseeded). */
  readOnly: boolean;
}

export function useChannelRows(): ChannelRowsState {
  const { state } = useApp();
  const sessionTenant = String(state?.tenant ?? '');
  const stateTenant = String(digitClient.stateTenantId || sessionTenant.split('.')[0] || '');
  const scopedToCity = !!stateTenant && !!sessionTenant && sessionTenant !== stateTenant;

  const query = {
    pagination: { page: 1, perPage: 20 },
    sort: { field: 'code', order: 'ASC' as const },
    filter: stateTenant ? { __tenantId: stateTenant } : {},
  };
  const { data, isLoading } = useGetList(CHANNEL_RESOURCE, query);
  const { data: legacyData, isLoading: legacyLoading } = useGetList(LEGACY_CHANNEL_RESOURCE, query);

  const decision = selectNotificationSource({
    pending: isLoading || legacyLoading,
    modern: { channel: data?.length ?? 0 },
    legacy: { channel: legacyData?.length ?? 0 },
  });

  const rows = (decision.source === 'LEGACY' ? legacyData : data) ?? [];

  return {
    rows: rows as ChannelRow[],
    isLoading: isLoading || legacyLoading,
    sessionTenant,
    stateTenant,
    scopedToCity,
    decision,
    readOnly: decision.source === 'LEGACY',
  };
}

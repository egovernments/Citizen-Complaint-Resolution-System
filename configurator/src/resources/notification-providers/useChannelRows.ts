// The tenant's RAINMAKER-PGR.NotificationChannel rows, read where novu-bridge reads
// them: at the STATE tenant. Shared by the Providers list (to show which provider a
// channel has selected) and the Channels card (to change that selection).
//
// MDMS writes land in the SESSION tenant, so a session scoped to a city can read the
// state-level policy but must not write it — `scopedToCity` is what the UI disables on.
import { useGetList } from 'ra-core';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../../App';
import type { ChannelRow } from './channelStatus';

export const CHANNEL_RESOURCE = 'notification-channel';

export interface ChannelRowsState {
  rows: ChannelRow[];
  isLoading: boolean;
  sessionTenant: string;
  stateTenant: string;
  scopedToCity: boolean;
}

export function useChannelRows(): ChannelRowsState {
  const { state } = useApp();
  const sessionTenant = String(state?.tenant ?? '');
  const stateTenant = String(digitClient.stateTenantId || sessionTenant.split('.')[0] || '');
  const scopedToCity = !!stateTenant && !!sessionTenant && sessionTenant !== stateTenant;

  const { data, isLoading } = useGetList(CHANNEL_RESOURCE, {
    pagination: { page: 1, perPage: 20 },
    sort: { field: 'code', order: 'ASC' },
    filter: stateTenant ? { __tenantId: stateTenant } : {},
  });

  return {
    rows: (data ?? []) as ChannelRow[],
    isLoading,
    sessionTenant,
    stateTenant,
    scopedToCity,
  };
}

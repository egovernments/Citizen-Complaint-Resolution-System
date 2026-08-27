import type { MdmsRecord } from './types';

export const PUBLIC_DASHBOARD_PATH = '/digit-ui/public-dashboard';

export interface DashboardConfigData extends Record<string, unknown> {
  id: string;
  publicDashboardEnabled?: boolean;
  /**
   * Epoch millis of the last time public access was turned ON. Powers the
   * "Last published" tile (CCRS#1883).
   */
  lastPublishedAt?: number;
  /**
   * Who last turned public access OFF, and when (CCRS#1883). Stored explicitly
   * rather than read from the record's auditDetails: lastModifiedBy/Time move on
   * ANY write to DashboardConfig (timeZone, numberFormat, departmentScoping), so
   * a later unrelated edit would silently re-attribute the disable to whoever
   * made it. These two only ever change when the switch itself is turned off.
   *
   * The display NAME is captured at the time of the action on purpose — the
   * attribution line is a record of who acted then, and it must stay readable
   * without a user lookup on every page load.
   */
  disabledBy?: string;
  disabledAt?: number;
}

/** The same deterministic record rule used by pgr-services and digit-ui. */
export function selectOwnedDashboardConfig(
  records: MdmsRecord[],
  tenantId: string,
): MdmsRecord | null {
  const own = records.filter(
    (record) => record.tenantId === tenantId && record.isActive !== false,
  );
  if (own.length === 0) return null;

  return own.find((record) => String(record.data?.id ?? '').trim() === 'default')
    ?? own[0];
}

export function buildPublicDashboardUrl(environment: string): string {
  return `${environment.replace(/\/+$/, '')}${PUBLIC_DASHBOARD_PATH}`;
}

/** "1 Aug 2026" — the date form the Last published tile uses. */
export function formatPublishedDate(epochMillis?: number): string | null {
  if (typeof epochMillis !== 'number' || !Number.isFinite(epochMillis)) return null;
  const date = new Date(epochMillis);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
}

/** "1 Aug 2026, 14:32" — the date-time form the disabled attribution line uses. */
export function formatDisabledTimestamp(epochMillis?: number): string | null {
  if (typeof epochMillis !== 'number' || !Number.isFinite(epochMillis)) return null;
  const date = new Date(epochMillis);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

/**
 * The attribution line shown inside the Public URL box while public access is
 * off (CCRS#1883). Returns null when the dashboard is enabled, or when the
 * record predates this field — an existing deployment that was disabled before
 * this shipped has nobody recorded, and inventing an actor would be worse than
 * staying quiet.
 */
export function describeDisabledBy(data?: Partial<DashboardConfigData> | null): string | null {
  if (!data || data.publicDashboardEnabled === true) return null;
  const who = typeof data.disabledBy === 'string' ? data.disabledBy.trim() : '';
  const when = formatDisabledTimestamp(data.disabledAt);
  if (!who || !when) return null;
  return `Public Dashboard disabled by ${who} on ${when}`;
}

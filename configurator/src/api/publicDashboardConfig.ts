import type { MdmsRecord } from './types';

export const PUBLIC_DASHBOARD_PATH = '/digit-ui/public-dashboard';

export interface DashboardConfigData extends Record<string, unknown> {
  id: string;
  publicDashboardEnabled?: boolean;
  /** IANA zone, e.g. "Africa/Nairobi". Absent/invalid falls back to Africa/Nairobi server-side. */
  timeZone?: string;
}

export const DEFAULT_DASHBOARD_TIME_ZONE = 'Africa/Nairobi';

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

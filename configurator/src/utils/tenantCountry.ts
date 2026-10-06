// The workspace's country (ISO 3166-1 alpha-2) and display name, from its
// tenant record (tenant.tenants), which onboarding writes at signup. The
// country is the one chosen at signup; nothing else is taken as the country —
// the phone rule's dial code was, until it proved misleading: deploy-created
// tenants keep the seeded +91, which read as India.
import { mdmsService } from '@/api';

export function isCountryCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v.trim().toUpperCase());
}

export interface TenantProfile {
  /** The signup country, from the tenant's own record or (for a city tenant) its root's; null when neither has one. */
  country: string | null;
  /** The workspace's name ("Riverside Council"), for copy; null when unknown. */
  name: string | null;
}

/** Read once per Geography visit. Never throws: an unreadable record means we can't tell. */
export async function readTenantProfile(tenant: string): Promise<TenantProfile> {
  const root = tenant.split('.')[0];
  const ids = [...new Set([tenant, root])];
  try {
    const records = await mdmsService.search<Record<string, unknown>>(root, 'tenant.tenants', {
      uniqueIdentifiers: ids,
    });
    let country: string | null = null;
    for (const id of ids) {
      const value = records.find((r) => r.code === id)?.country;
      if (isCountryCode(value)) {
        country = value.trim().toUpperCase();
        break;
      }
    }
    const own = records.find((r) => r.code === tenant)?.name;
    return { country, name: typeof own === 'string' && own.trim() ? own.trim() : null };
  } catch {
    return { country: null, name: null };
  }
}

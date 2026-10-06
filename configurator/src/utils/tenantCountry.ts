// Which country a tenant is in (ISO 3166-1 alpha-2), for offering that
// country's official boundaries: the one chosen at signup, which onboarding
// writes onto the tenant record (tenant.tenants `country`). Nothing else is
// taken as the country — the phone rule's dial code was, until it proved
// misleading: deploy-created tenants keep the seeded +91, which read as India.
import { mdmsService } from '@/api';

export function isCountryCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v.trim().toUpperCase());
}

/** The tenant's signup country, from its own record or (for a city tenant) its root's; null when neither has one. */
export async function resolveTenantCountry(tenant: string): Promise<string | null> {
  const root = tenant.split('.')[0];
  const ids = [...new Set([tenant, root])];
  try {
    const records = await mdmsService.search<Record<string, unknown>>(root, 'tenant.tenants', {
      uniqueIdentifiers: ids,
    });
    for (const id of ids) {
      const country = records.find((r) => r.code === id)?.country;
      if (isCountryCode(country)) return country.trim().toUpperCase();
    }
  } catch {
    // An unreadable record means we can't tell; the card says so.
  }
  return null;
}

// Which country a tenant is in (ISO 3166-1 alpha-2), for offering that
// country's official boundaries. Signup writes it onto the tenant record
// (tenant.tenants `country`); tenants created before that, or by a deploy,
// don't have it, so the tenant's phone-number rule is the fallback — its dial
// code names the country for the countries we hold official sets for.
import { mdmsService } from '@/api';

/** Dial code → country, for the countries turbopass holds official sets for (#1994). */
export const DIAL_CODE_COUNTRIES: Record<string, string> = {
  '+253': 'DJ',
  '+245': 'GW',
  '+257': 'BI',
  '+231': 'LR',
  '+229': 'BJ',
  '+258': 'MZ',
  '+251': 'ET',
  '+250': 'RW',
  '+254': 'KE',
  '+27': 'ZA',
  '+55': 'BR',
  '+91': 'IN',
};

export interface TenantCountry {
  country: string;
  /** Where it came from — the dial code is a guess the operator may correct. */
  from: 'tenant' | 'dial-code';
}

export function countryFromDialCode(code: string | null | undefined): string | null {
  const normalised = (code ?? '').replace(/[\s-]/g, '');
  const withPlus = normalised.startsWith('+') ? normalised : normalised ? `+${normalised}` : '';
  return DIAL_CODE_COUNTRIES[withPlus] ?? null;
}

export function isCountryCode(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Z]{2}$/.test(v.trim().toUpperCase());
}

export async function resolveTenantCountry(tenant: string): Promise<TenantCountry | null> {
  const root = tenant.split('.')[0];
  const ids = [...new Set([tenant, root])];
  try {
    const records = await mdmsService.search<Record<string, unknown>>(root, 'tenant.tenants', {
      uniqueIdentifiers: ids,
    });
    // The tenant's own record first, then its root's.
    for (const id of ids) {
      const country = records.find((r) => r.code === id)?.country;
      if (isCountryCode(country)) return { country: country.trim().toUpperCase(), from: 'tenant' };
    }
  } catch {
    // An unreadable tenant record is no reason to stop: try the dial code.
  }
  try {
    const rule = await mdmsService.getMobileValidation(tenant);
    const country = countryFromDialCode(rule?.countryCode);
    if (country) return { country, from: 'dial-code' };
  } catch {
    // Nothing more to go on; the operator picks.
  }
  return null;
}

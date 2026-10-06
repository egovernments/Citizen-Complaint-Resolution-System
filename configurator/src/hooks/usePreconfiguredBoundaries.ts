import { useEffect, useState } from 'react';
import { TURBOPASS_BASE } from './useTurbopassSources';
import { fetchOfficialSet, type OfficialSet } from '@/utils/officialBoundaries';
import { resolveTenantCountry, type TenantCountry } from '@/utils/tenantCountry';

export type PreconfiguredState =
  | { status: 'loading' }
  /** turbopass isn't reachable or holds no official sets. */
  | { status: 'unavailable' }
  /** The tenant has no country on record (signup predates it, or it was made by a deploy). */
  | { status: 'unknown-country' }
  /** turbopass holds no official set for the tenant's country. */
  | { status: 'none'; country: TenantCountry }
  | { status: 'ready'; country: TenantCountry; set: OfficialSet };

/** Whether this turbopass holds any official sets, from /health. */
async function holdsOfficialSets(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/health`);
    if (!res.ok) return false;
    const body = await res.json();
    return !!body?.official && typeof body.official === 'object' && Object.keys(body.official).length > 0;
  } catch {
    return false;
  }
}

/**
 * Geography's "Preconfigured boundaries" option: the official boundary set
 * turbopass holds for the tenant's country. The country is the one chosen at
 * signup (see resolveTenantCountry); it is not editable here.
 */
export function usePreconfiguredBoundaries(tenant: string, base: string = TURBOPASS_BASE): PreconfiguredState {
  const [state, setState] = useState<PreconfiguredState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await holdsOfficialSets(base))) {
        if (!cancelled) setState({ status: 'unavailable' });
        return;
      }
      const country = await resolveTenantCountry(tenant);
      if (cancelled) return;
      if (!country) {
        setState({ status: 'unknown-country' });
        return;
      }
      const set = await fetchOfficialSet(base, country.country);
      if (cancelled) return;
      if (set === 'unavailable') setState({ status: 'unavailable' });
      else if (set === null) setState({ status: 'none', country });
      else setState({ status: 'ready', country, set });
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, base]);

  return state;
}

import { useCallback, useEffect, useState } from 'react';
import { TURBOPASS_BASE } from './useTurbopassSources';
import { fetchOfficialSet, type OfficialSet } from '@/utils/officialBoundaries';
import { resolveTenantCountry, type TenantCountry } from '@/utils/tenantCountry';

export type PreconfiguredState =
  | { status: 'loading' }
  /** turbopass isn't reachable or holds no official sets. */
  | { status: 'unavailable' }
  /** The tenant's country isn't known: the operator picks from these. */
  | { status: 'pick-country'; countries: string[] }
  /** turbopass holds no official set for the country. */
  | { status: 'none'; country: TenantCountry; countries: string[] }
  | { status: 'ready'; country: TenantCountry; set: OfficialSet; countries: string[] };

/** Countries this turbopass holds official sets for, from /health. */
async function officialCountries(base: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${base}/health`);
    if (!res.ok) return null;
    const body = await res.json();
    return body?.official && typeof body.official === 'object' ? Object.keys(body.official).sort() : null;
  } catch {
    return null;
  }
}

/**
 * Geography's "Preconfigured" option: the tenant's country and the official
 * boundary set turbopass holds for it. `chooseCountry` overrides the country
 * (when it is unknown, or the dial-code guess is wrong).
 */
export function usePreconfiguredBoundaries(tenant: string, base: string = TURBOPASS_BASE) {
  const [state, setState] = useState<PreconfiguredState>({ status: 'loading' });
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const countries = await officialCountries(base);
      if (cancelled) return;
      if (!countries?.length) {
        setState({ status: 'unavailable' });
        return;
      }
      const country: TenantCountry | null = chosen
        ? { country: chosen, from: 'tenant' }
        : await resolveTenantCountry(tenant);
      if (cancelled) return;
      if (!country) {
        setState({ status: 'pick-country', countries });
        return;
      }
      const set = await fetchOfficialSet(base, country.country);
      if (cancelled) return;
      if (set === 'unavailable') setState({ status: 'unavailable' });
      else if (set === null) setState({ status: 'none', country, countries });
      else setState({ status: 'ready', country, set, countries });
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, base, chosen]);

  const chooseCountry = useCallback((code: string) => {
    setState({ status: 'loading' });
    setChosen(code);
  }, []);
  return { state, chooseCountry };
}

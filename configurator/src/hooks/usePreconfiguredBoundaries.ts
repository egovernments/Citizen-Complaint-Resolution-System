import { useCallback, useEffect, useState } from 'react';
import { TURBOPASS_BASE } from './useTurbopassSources';
import { fetchOfficialSet, type OfficialSet } from '@/utils/officialBoundaries';
import { resolveTenantCountry } from '@/utils/tenantCountry';

export type PreconfiguredState =
  | { status: 'loading' }
  /** turbopass isn't reachable or holds no official sets. */
  | { status: 'unavailable' }
  /** The tenant has no country on record (signup predates it, or a deploy created it). */
  | { status: 'unknown-country' }
  /** turbopass holds no official set for the tenant's country. */
  | { status: 'none'; country: string }
  /** /health lists the country but its set couldn't be loaded just now (or this turbopass predates /boundary/official). */
  | { status: 'error'; country: string }
  | { status: 'ready'; country: string; set: OfficialSet };

/**
 * Geography's "Preconfigured boundaries" option: the official boundary set
 * turbopass holds for the tenant's country — the one chosen at signup, not
 * editable here. `officialCountries` is Geography's single /health read (null
 * while asking), so this hook adds no second /health request, and a country
 * /health doesn't list is answered without calling /boundary/official at all.
 */
export function usePreconfiguredBoundaries(
  tenant: string,
  officialCountries: string[] | null,
  base: string = TURBOPASS_BASE,
): { state: PreconfiguredState; retry: () => void } {
  const [state, setState] = useState<PreconfiguredState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Keyed on the list's contents, not its identity: a caller passing a fresh
  // array each render must not re-run the lookup (and re-render) forever.
  const countriesKey = officialCountries === null ? null : officialCountries.join(',');

  useEffect(() => {
    if (countriesKey === null) return;
    const listed = countriesKey ? countriesKey.split(',') : [];
    let cancelled = false;
    (async () => {
      if (listed.length === 0) {
        setState({ status: 'unavailable' });
        return;
      }
      const country = await resolveTenantCountry(tenant);
      if (cancelled) return;
      if (!country) {
        setState({ status: 'unknown-country' });
        return;
      }
      if (!listed.includes(country)) {
        setState({ status: 'none', country });
        return;
      }
      const set = await fetchOfficialSet(base, country);
      if (cancelled) return;
      // Listed in /health, so a 404 here is an older turbopass, not "no set".
      setState(set && set !== 'unavailable' ? { status: 'ready', country, set } : { status: 'error', country });
    })();
    return () => {
      cancelled = true;
    };
  }, [tenant, base, countriesKey, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}

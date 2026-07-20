import { useQuery } from '@tanstack/react-query';
import { digitClient } from '@/providers/bridge';

const DEFAULT_MODULE = 'rainmaker-common';

/**
 * Reads DIGIT's own cached module list from localStorage. digit-ui's
 * Localization service accumulates loaded modules under `Digit.Locale.<locale>.List`
 * and the cross-locale union `Digit.Locale.List`, each wrapped as
 * `{ value, ttl, expiry }`. Same-origin in production, so we can read it for an
 * instant, sync seed while the authoritative fetch runs. Returns [] if
 * absent/expired (incognito, configurator-only, or a different dev origin).
 */
function readDigitModuleList(locale: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  for (const key of ['Digit.Locale.List', `Digit.Locale.${locale}.List`]) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { value?: unknown; expiry?: number };
      if (parsed?.expiry && Date.now() > parsed.expiry) continue; // expired
      if (Array.isArray(parsed?.value)) {
        const mods = parsed.value.filter((m): m is string => typeof m === 'string');
        if (mods.length) return mods.slice().sort();
      }
    } catch {
      /* ignore malformed cache entry */
    }
  }
  return [];
}

/**
 * Returns the localization module names for the tenant, derived from the
 * localization messages themselves -- the only authoritative source for which
 * modules actually have localizations. (MDMS StateInfo.localizationModules is
 * often stale: it omits in-use digit- and tenant-specific modules, and lists
 * unused ones.)
 *
 * Performance: the message table can be very large, so we don't make this cheap
 * by guessing -- we make it cheap by NOT repeating it:
 *   - staleTime 30 min: the full search runs at most once per session; repeat
 *     visits are served from cache instantly.
 *   - placeholderData: the dropdown renders immediately from DIGIT's cached
 *     localStorage list while the authoritative fetch resolves in the
 *     background, so it is never empty and never blocks opening the form.
 *   - distinct via Set is O(n) -- negligible next to the network payload, which
 *     the caching amortizes. (This is the same data the localization list page
 *     already fetches.)
 *
 * There is no server-side distinct-modules endpoint and no index on the module
 * column, so a single cached scan is the most effective authoritative option.
 */
export function useLocalizationModules(locale = 'en_IN'): {
  modules: string[];
  isLoading: boolean;
  error: Error | null;
} {
  const tenantId = digitClient.stateTenantId;

  const { data, isLoading, error } = useQuery<string[], Error>({
    queryKey: ['localization-modules', tenantId, locale],
    queryFn: async () => {
      // No module arg -> every message for the locale, across all modules.
      const messages = await digitClient.localizationSearch(tenantId!, locale);
      const unique = [...new Set(messages.map((m: Record<string, unknown>) => String(m.module ?? '')))]
        .filter(Boolean)
        .sort();
      return unique.length ? unique : [DEFAULT_MODULE];
    },
    // Module set rarely changes -> fetch the heavy payload at most once/session.
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // Instant, non-blocking seed from DIGIT's cache while the fetch runs.
    placeholderData: () => {
      const cached = readDigitModuleList(locale);
      return cached.length ? cached : undefined;
    },
    enabled: !!tenantId,
  });

  return {
    modules: data ?? [DEFAULT_MODULE],
    isLoading,
    error: error ?? null,
  };
}

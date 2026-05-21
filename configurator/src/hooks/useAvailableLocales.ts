import { useQuery } from '@tanstack/react-query';
import { digitClient } from '@/providers/bridge';

/**
 * Hook that returns the locales available for localization editing on the
 * current session tenant.
 *
 * Source of truth (in priority order):
 *   1. MDMS `common-masters.StateInfo[0].languages` — what the tenant
 *      formally declares it supports. This is the same source DIGIT-UI
 *      uses to populate its language switcher.
 *   2. Curated fallback set if StateInfo is missing/empty so the dropdown
 *      is never blank — `en_IN` (universal default) plus `default` (DIGIT's
 *      i18n fallback bucket).
 *
 * What this DOESN'T do: probe the localization service for which locales
 * actually have rows. The localization API requires a `locale` param on
 * search and offers no enumeration endpoint, so discovery would mean
 * brute-forcing a candidate set. StateInfo is the correct knob — fix it
 * for tenants whose data is stale.
 */
export interface LocaleOption {
  value: string;   // e.g. "en_IN"
  label: string;   // e.g. "English (en_IN)"
}

const FALLBACK_LOCALES: LocaleOption[] = [
  { value: 'en_IN', label: 'English (en_IN)' },
  { value: 'default', label: 'Default (default)' },
];

// Friendly labels keyed by BCP-47-ish DIGIT codes. Falls back to
// the StateInfo `label` if present, else the raw value.
const NICE_NAME: Record<string, string> = {
  en_IN: 'English',
  sw_KE: 'Swahili',
  hi_IN: 'Hindi',
  ka_IN: 'Kannada',
  ta_IN: 'Tamil',
  te_IN: 'Telugu',
  default: 'Default',
};

function formatLabel(value: string, label?: string): string {
  const friendly = NICE_NAME[value] ?? label ?? value;
  return `${friendly} (${value})`;
}

export function useAvailableLocales(): {
  locales: LocaleOption[];
  isLoading: boolean;
  error: Error | null;
} {
  const tenantId = digitClient.stateTenantId;

  const { data, isLoading, error } = useQuery<LocaleOption[], Error>({
    queryKey: ['available-locales', tenantId],
    queryFn: async () => {
      if (!tenantId) return FALLBACK_LOCALES;
      const records = await digitClient.mdmsSearch(tenantId, 'common-masters.StateInfo', { limit: 1 });
      const stateInfo = records.find((r) => r.isActive)?.data as Record<string, unknown> | undefined;
      const langs = Array.isArray(stateInfo?.languages) ? stateInfo!.languages as Array<{ value?: string; label?: string }> : [];
      const fromStateInfo: LocaleOption[] = langs
        .filter((l): l is { value: string; label?: string } => typeof l?.value === 'string')
        .map((l) => ({ value: l.value, label: formatLabel(l.value, l.label) }));
      // Always include `default` since DIGIT consumers fall back to it when a
      // tenant locale is missing — translators want to edit it directly.
      const seen = new Set(fromStateInfo.map((l) => l.value));
      if (!seen.has('default')) {
        fromStateInfo.push({ value: 'default', label: formatLabel('default') });
      }
      return fromStateInfo.length > 0 ? fromStateInfo : FALLBACK_LOCALES;
    },
    staleTime: 10 * 60 * 1000, // 10 minutes — StateInfo doesn't change often
    gcTime: 10 * 60 * 1000,
    enabled: !!tenantId,
  });

  return {
    locales: data ?? FALLBACK_LOCALES,
    isLoading,
    error: error ?? null,
  };
}

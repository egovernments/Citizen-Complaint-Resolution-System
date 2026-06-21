import { useQuery } from '@tanstack/react-query';
import { useLocaleState } from 'ra-core';
import { digitClient } from '@/providers/bridge';

/** Build a localization `code → message` map from raw localization rows. */
export function buildServiceDefLabelMap(
  messages: Record<string, unknown>[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of messages) {
    const code = m.code as string | undefined;
    const text = m.message as string | undefined;
    if (code && text) map[code] = text;
  }
  return map;
}

/**
 * Loads the tenant's `rainmaker-pgr` localization (where the `SERVICEDEFS.*`
 * complaint-type labels live) for the active locale, as a code→message map.
 *
 * The configurator's i18nProvider only loads the `configurator-ui` module, so
 * these PGR labels must be fetched separately — otherwise complaint-type names
 * render as raw menuPath keys (e.g. `complaints.categories.<code>`). Cached for
 * 5 minutes; returns an empty map until loaded. `refetch` lets callers refresh
 * after a rename writes a new SERVICEDEFS message.
 */
export function useServiceDefLabels(): {
  labels: Record<string, string>;
  refetch: () => void;
} {
  const [locale] = useLocaleState();
  const tenantId = digitClient.stateTenantId;
  const { data, refetch } = useQuery({
    queryKey: ['servicedef-labels', tenantId, locale],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () =>
      buildServiceDefLabelMap(
        await digitClient.localizationSearch(tenantId as string, locale, 'rainmaker-pgr'),
      ),
  });
  return {
    labels: data ?? {},
    refetch: () => {
      void refetch();
    },
  };
}

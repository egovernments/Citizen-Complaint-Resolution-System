import { useEffect, useState } from 'react';
import { configService, ApiClientError } from '@/api';
import { buildChannelPayload } from '@/components/communications/channels';

export interface SaveResult {
  ok: boolean;
  enabledNames: string[];
}

/**
 * Loads a tenant's NotificationChannel toggle state and persists changes via config-service.
 * Shared by the onboarding step (Phase 5) and the management settings page so both behave identically.
 *
 * `loadError` is exposed so the caller can warn before saving: if the initial read failed we cannot
 * know the current state, and saving would overwrite every channel (silently disabling live ones).
 */
export function useNotificationChannels(tenantId: string) {
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset on tenant change so we never show the previous tenant's state while reloading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setEnabledMap({});
    setLoadError(null);
    (async () => {
      try {
        const existing = await configService.getNotificationChannels(tenantId);
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const ch of existing) map[ch.code] = !!ch.enabled;
        setEnabledMap(map);
      } catch (err) {
        if (cancelled) return;
        // Surface it: saving now would overwrite all channels from a wrong (all-off) baseline.
        const msg =
          err instanceof ApiClientError ? err.firstError : err instanceof Error ? err.message : 'unknown error';
        setLoadError(`Couldn't load current channel settings (${msg}). Saving would overwrite all channels.`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const setEnabled = (code: string, value: boolean) =>
    setEnabledMap((m) => ({ ...m, [code]: value }));

  const save = async (): Promise<SaveResult> => {
    setSaving(true);
    setError(null);
    try {
      const channels = buildChannelPayload(enabledMap);
      await configService.saveNotificationChannels(tenantId, channels);
      return { ok: true, enabledNames: channels.filter((c) => c.enabled).map((c) => c.name) };
    } catch (err) {
      let msg =
        err instanceof ApiClientError
          ? err.firstError
          : err instanceof Error
            ? err.message
            : 'Failed to save channels';
      if (err instanceof ApiClientError && err.statusCode === 403) {
        msg = `You don't have permission to configure communications for this tenant (${err.firstError}).`;
      }
      setError(msg);
      return { ok: false, enabledNames: [] };
    } finally {
      setSaving(false);
    }
  };

  return { enabledMap, setEnabled, loading, saving, error, loadError, save };
}

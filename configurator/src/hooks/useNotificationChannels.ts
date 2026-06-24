import { useEffect, useState } from 'react';
import { configService, ApiClientError } from '@/api';
import { buildChannelPayload } from '@/components/communications/channels';

export interface SaveResult {
  ok: boolean;
  enabledNames: string[];
}

/**
 * Loads a tenant's NotificationChannel toggle state and persists changes via config-service.
 * Shared by the onboarding step (Phase 5) and the management settings page so both behave
 * identically. Reads default to OFF if the lookup fails (non-fatal); save surfaces an error.
 */
export function useNotificationChannels(tenantId: string) {
  const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await configService.getNotificationChannels(tenantId);
        if (cancelled) return;
        const map: Record<string, boolean> = {};
        for (const ch of existing) map[ch.code] = !!ch.enabled;
        setEnabledMap(map);
      } catch {
        // Non-fatal: default everything to off if we cannot read current state.
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
      const msg =
        err instanceof ApiClientError
          ? err.firstError
          : err instanceof Error
            ? err.message
            : 'Failed to save channels';
      setError(msg);
      return { ok: false, enabledNames: [] };
    } finally {
      setSaving(false);
    }
  };

  return { enabledMap, setEnabled, loading, saving, error, save };
}

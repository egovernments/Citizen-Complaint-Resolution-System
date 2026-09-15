import { useCallback, useEffect, useState } from 'react';
import { mdmsService, MDMS_SCHEMAS } from '@/api';

/** Which library draws this tenant's maps, from RAINMAKER-PGR.MapConfig (#1994). */
export interface MapProviderConfig {
  provider: 'leaflet' | 'google';
  googleMapsApiKey: string;
  /** Ready for <BoundaryMap google={...}>: set only when Google is selected AND keyed. */
  google?: { apiKey: string };
}

const DEFAULT: MapProviderConfig = { provider: 'leaflet', googleMapsApiKey: '' };

/** MapConfig record data → provider settings. Google without a key can't draw, so it falls back. */
export function mapProviderFrom(data: Record<string, unknown> | null | undefined): MapProviderConfig {
  const key = typeof data?.googleMapsApiKey === 'string' ? data.googleMapsApiKey.trim() : '';
  const provider = data?.mapProvider === 'google' && key ? 'google' : 'leaflet';
  return { provider, googleMapsApiKey: key, google: provider === 'google' ? { apiKey: key } : undefined };
}

/** The tenant's own MapConfig record first, else the one it inherits. */
async function readMapProvider(tenantId: string): Promise<MapProviderConfig> {
  try {
    const records = await mdmsService.searchRecords(tenantId, MDMS_SCHEMAS.MAP_CONFIG);
    const active = records.filter((r) => r.isActive !== false);
    const own = active.find((r) => r.tenantId === tenantId) ?? active[0];
    return mapProviderFrom(own?.data as Record<string, unknown> | undefined);
  } catch {
    return DEFAULT; // no MapConfig master on this deployment → OpenStreetMap tiles
  }
}

/** The tenant's map provider. `reload()` re-reads it after a save. */
export function useMapProviderConfig(tenantId: string | undefined) {
  // Tagged with its tenant, so a tenant change never shows the previous one's config.
  const [loaded, setLoaded] = useState<{ tenantId: string; config: MapProviderConfig } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void readMapProvider(tenantId).then((config) => {
      if (!cancelled) setLoaded({ tenantId, config });
    });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const reload = useCallback(async () => {
    if (!tenantId) return;
    setLoaded({ tenantId, config: await readMapProvider(tenantId) });
  }, [tenantId]);

  const current = loaded && loaded.tenantId === tenantId ? loaded.config : DEFAULT;
  return { ...current, loading: !!tenantId && loaded?.tenantId !== tenantId, reload };
}

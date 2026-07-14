import { useState, useEffect } from 'react';
import { fetchPack, fetchCatalog } from '../services/analyticsService';

/**
 * Fetches the tile catalog (viz schema) and pack (role-filtered tile list + default layout)
 * from the backend. Does NOT fetch data — that stays in useDashboardData.
 *
 * Returns: { loading, kpis, pack, error }
 * - kpis: object keyed by kpiId, value = full tile descriptor including viz
 * - pack: { tiles, layout } — tiles already ceiling-filtered by server
 * - error: string | null
 *
 * Falls back gracefully (error state + empty) if the endpoints don't exist yet —
 * the existing hardcoded path is left intact.
 */
export function useCatalog(tenantId) {
  const [state, setState] = useState({ loading: true, kpis: {}, pack: null, error: null });

  useEffect(() => {
    if (!tenantId) {
      setState({ loading: false, kpis: {}, pack: null, error: 'No tenant' });
      return;
    }

    let cancelled = false;
    Promise.all([fetchPack(tenantId), fetchCatalog(tenantId)])
      .then(([packRes, catalogRes]) => {
        if (cancelled) return;
        const allKpis = Object.fromEntries(
          ((catalogRes && catalogRes.tiles) || []).map(k => [k.kpiId, k])
        );
        const packTiles = (packRes && packRes.tiles) || [];
        const packLayout = (packRes && packRes.defaultLayout) || [];
        // Gate: only tiles present in the catalog (visibleTo already applied server-side)
        const filteredTiles = packTiles.filter(t => allKpis[t.kpiId]);
        setState({
          loading: false,
          kpis: allKpis,
          pack: { tiles: filteredTiles, layout: packLayout },
          error: null,
        });
      })
      .catch(err => {
        if (!cancelled) {
          // Graceful degradation — the /packs endpoint may not exist yet
          console.warn('[useCatalog] Backend catalog not available, using local config fallback:', err.message);
          setState({ loading: false, kpis: {}, pack: null, error: err.message });
        }
      });

    return () => { cancelled = true; };
  }, [tenantId]);

  return state;
}

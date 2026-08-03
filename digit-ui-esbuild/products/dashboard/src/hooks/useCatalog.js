import { useState, useEffect } from 'react';
import { fetchPack, fetchCatalog } from '../services/analyticsService';
import { markInteraction, setPackMeta } from '../services/dashboardMetrics';

// Role set observed at the previous catalog fetch (module-scoped: survives
// remounts within one page session). A refetch with a CHANGED role set is the
// closest thing to an in-app persona switch today — expected to be ~empty
// until in-app persona switching exists (a persona change currently requires
// re-login + full reload, which shows up as a fresh load with a different
// `persona` tag instead).
let lastRoleSetKey = null;

function currentRoleSetKey() {
  try {
    const raw = window.localStorage?.getItem('Employee.user-info');
    const info = raw && raw !== 'undefined' ? JSON.parse(raw) : null;
    const codes = (Array.isArray(info?.roles) ? info.roles : [])
      .map(r => String(r?.code ?? ''))
      .filter(Boolean)
      .sort();
    return codes.join(',');
  } catch {
    return '';
  }
}

/**
 * Fetches the tile catalog (viz schema) and pack (role-filtered tile list + default layout)
 * from the backend. Does NOT fetch data — that stays in useDashboardData.
 *
 * Returns: { loading, kpis, pack, packMeta, error }
 * - kpis: object keyed by kpiId, value = full tile descriptor including viz
 * - pack: { tiles, layout } — tiles already ceiling-filtered by server
 * - packMeta: { packId, recordCount, persona } — read DEFENSIVELY off the
 *   /packs response; all null until the PR2 backend exposes them (#1110)
 * - error: string | null
 *
 * Falls back gracefully (error state + empty) if the endpoints don't exist yet —
 * the existing hardcoded path is left intact.
 */
export function useCatalog(tenantId) {
  const [state, setState] = useState({ loading: true, kpis: {}, pack: null, packMeta: null, error: null });

  useEffect(() => {
    if (!tenantId) {
      setState({ loading: false, kpis: {}, pack: null, packMeta: null, error: 'No tenant' });
      return;
    }

    // persona_switch (#1110): the pack is the server's role->pack match, so a
    // refetch under a changed role set IS a persona change from the
    // dashboard's point of view.
    const roleSetKey = currentRoleSetKey();
    if (lastRoleSetKey != null && roleSetKey !== lastRoleSetKey) {
      markInteraction('persona');
    }
    lastRoleSetKey = roleSetKey;

    let cancelled = false;
    Promise.all([fetchPack(tenantId), fetchCatalog(tenantId)])
      .then(([packRes, catalogRes]) => {
        if (cancelled) return;
        const allKpis = Object.fromEntries(
          ((catalogRes && catalogRes.tiles) || []).map(k => [k.kpiId, k])
        );
        const packTiles = (packRes && packRes.tiles) || [];
        const packLayoutRaw = (packRes && packRes.defaultLayout) || [];
        // Gate: only tiles present in the catalog (visibleTo already applied server-side)
        const filteredTiles = packTiles.filter(t => allKpis[t.kpiId]);
        // Bomet (and other tenants) may return role-visible tiles with an empty
        // defaultLayout when no DashboardPack MDMS entry matches. Seed from the
        // tile list so the grid is not blank on first load (#1276 / empty pack).
        const packLayout = packLayoutRaw.length
          ? packLayoutRaw
          : filteredTiles.map((t) => ({ kpiId: t.kpiId }));
        // Metric tags (layout_id / record_count_tier / persona): absent until
        // the #1110 PR2 backend adds them to /packs — tags read "unknown" then.
        const packMeta = {
          packId: packRes?.packId ?? null,
          recordCount: packRes?.recordCount ?? null,
          persona: packRes?.persona ?? null,
        };
        setPackMeta(packMeta);
        setState({
          loading: false,
          kpis: allKpis,
          pack: { tiles: filteredTiles, layout: packLayout },
          packMeta,
          error: null,
        });
      })
      .catch(err => {
        if (!cancelled) {
          // Graceful degradation — the /packs endpoint may not exist yet
          console.warn('[useCatalog] Backend catalog not available, using local config fallback:', err.message);
          setState({ loading: false, kpis: {}, pack: null, packMeta: null, error: err.message });
        }
      });

    return () => { cancelled = true; };
  }, [tenantId]);

  return state;
}

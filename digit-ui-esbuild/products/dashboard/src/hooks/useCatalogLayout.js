import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DROPPING_ITEM_ID } from "../constants/layoutConfig";
import { compactVertically } from "../utils/gridGeometry";
import {
  LEGACY_STORAGE_KEY,
  storageKeyFor,
  buildSeedLayout,
  resolveInitialLayout,
  addItemToLayout,
  readSavedLayout,
  persistLayout,
  sizeConstraintsForKpi,
} from "../utils/layoutStore";
import { getTenantId, getUserUuid } from "../services/analyticsService";

/**
 * useCatalogLayout — the catalog-world layout hook (kpiId-keyed).
 *
 * The legacy useDashboardLayout is keyed on dash-case widget-ids and carries a
 * decade of migration/legacy-id machinery for the inline-query dashboard. The
 * inverted dashboard renders straight from the MDMS catalog (snake_case kpiIds)
 * and seeds its grid from the DashboardPack layout, so it gets a fresh, far
 * smaller hook that speaks kpiIds and reuses only the pure geometry/collision
 * helpers.
 *
 * All pure logic (constraints, seed/saved reconciliation, add placement,
 * storage IO) lives in utils/layoutStore.js so the add/persist/rehydrate cycle
 * is unit-testable; this hook owns only the React state around it.
 *
 * Inputs:
 *   kpis        — { [kpiId]: def }  (catalog map; used for size-constraint by viz.kind)
 *   packLayout  — [{ kpiId, x, y, w, h }]  (DashboardPack defaultLayout — the seed)
 *
 * Returns the interaction surface AdminDashboard's grid expects:
 *   { layout, onLayoutChange, resetLayout, removeWidgetFromLayout,
 *     addKpiToLayout, visibleLayoutIds }
 * where every layout item.i is a kpiId.
 */

export { sizeConstraintsForKpi } from "../utils/layoutStore";

// Layout state is per-user, per-tenant (see storageKeyFor — the single global
// v1 key let personas sharing a browser clobber each other's layout). Reads
// fall back to the legacy global key once so pre-migration layouts survive;
// writes only ever touch the scoped key.
function storageKey() {
  return storageKeyFor(getTenantId(), getUserUuid());
}

function readSaved() {
  return readSavedLayout(window.localStorage, storageKey(), LEGACY_STORAGE_KEY);
}

function persist(layout) {
  persistLayout(window.localStorage, storageKey(), layout);
}

export function useCatalogLayout(kpis, packLayout) {
  const seed = useMemo(() => buildSeedLayout(packLayout, kpis), [packLayout, kpis]);
  // The catalog is the hydration signal, NOT the seed: /packs returns
  // defaultLayout: [] when no DashboardPack matches the caller's roles
  // (AnalyticsController.getPacks), and a role-filtered catalog can empty the
  // seed too. Gating on seed.length left those users with a hook that never
  // read the saved layout — picker adds worked in-session, then vanished on
  // every reload (#1276).
  const catalogReady = useMemo(() => Object.keys(kpis || {}).length > 0, [kpis]);

  const [layout, setLayout] = useState([]);

  // Hydrate once the catalog resolves (even when the pack seed is empty).
  // Prefer a SAVED layout (the user's arrangement, including an intentional
  // empty one) over the pack seed; drop tiles the role can no longer see and
  // re-normalise geometry so a viz.kind change or a malformed entry can't
  // leave a stale/invalid clamp. Only seeds from the pack when there is no
  // saved layout at all (saved === null). A saved layout is taken as-is —
  // newly-published pack tiles are added via the picker or a layout reset,
  // not auto-injected.
  useEffect(() => {
    if (!catalogReady) return;
    setLayout(resolveInitialLayout(readSaved(), seed, kpis));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, catalogReady]);

  // Debounced persistence — onLayoutChange fires on every drag/resize tick.
  const persistTimerRef = useRef(null);
  const persistDebounced = useCallback((lay) => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => persist(lay), 300);
  }, []);

  // Synchronous persistence for structural changes (add / remove / reset).
  // MUST cancel any pending debounced write: the debounce captured the layout
  // at schedule time, so a drag-tick write landing up to 300ms later would
  // overwrite the just-persisted add/remove with the pre-change layout — the
  // change survives on screen but is gone from storage (and thus on reload).
  const persistNow = useCallback((lay) => {
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    persist(lay);
  }, []);

  /**
   * The single source of layout truth during interaction. With compactType=
   * "vertical" (set on the grid), react-grid-layout owns collision + compaction:
   * dragging a tile pushes the others and the layout RGL emits here is already the
   * flowed, non-overlapping result. We accept it verbatim — re-merging only the
   * per-item min/max constraints RGL strips — and feed it straight back as the
   * controlled prop. Because the prop we return equals RGL's internal state,
   * getDerivedStateFromProps never has a stale copy to discard, so there is no
   * snap-back (this replaces the old swapOnDrop + compactVertically + rAF/moved
   * machinery that fought RGL's controlled-sync model).
   */
  const onLayoutChange = useCallback(
    (next) => {
      setLayout((prev) => {
        // While a picker item hovers the grid (isDroppable), RGL injects its
        // synthetic __dropping-elem__ placeholder into the layout it emits —
        // never let it into state/storage (the real tile arrives via
        // addKpiToLayout on drop).
        const real = next.filter((item) => item.i !== DROPPING_ITEM_ID);
        const merged = real.map((item) => {
          const existing = prev.find((p) => p.i === item.i);
          return existing
            ? { ...existing, x: item.x, y: item.y, w: item.w, h: item.h }
            : item;
        });
        persistDebounced(merged);
        return merged;
      });
    },
    [persistDebounced]
  );

  const removeWidgetFromLayout = useCallback(
    (kpiId) => {
      setLayout((prev) => {
        const next = compactVertically(prev.filter((item) => item.i !== kpiId));
        persistNow(next);
        return next;
      });
    },
    [persistNow]
  );

  const addKpiToLayout = useCallback(
    (kpiId, position) => {
      setLayout((prev) => {
        const next = addItemToLayout(prev, kpiId, kpis, position);
        if (next === prev) return prev; // unknown kpi or already placed
        persistNow(next);
        return next;
      });
    },
    [kpis, persistNow]
  );

  const resetLayout = useCallback(() => {
    const fresh = buildSeedLayout(packLayout, kpis);
    setLayout(fresh);
    persistNow(fresh);
  }, [packLayout, kpis, persistNow]);

  const visibleLayoutIds = useMemo(() => layout.map((item) => item.i), [layout]);

  return {
    layout,
    onLayoutChange, // RGL (compactType="vertical") drives drag/resize natively
    resetLayout,
    removeWidgetFromLayout,
    addKpiToLayout,
    addWidgetToLayout: addKpiToLayout, // charts + cards share one add path now
    visibleLayoutIds,
  };
}

export default useCatalogLayout;

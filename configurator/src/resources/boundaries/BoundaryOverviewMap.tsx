import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { boundaryService } from '@/api/services/boundary';
import { BoundaryMap } from '@/components/ui/BoundaryMap';

type Feature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: { code: string; name: string; boundaryType?: string };
};

// boundary-service emits a unit-square placeholder for boundaries created
// without real geometry. Filter those out so the map shows only real outlines.
const DEGENERATE_SPAN_DEG = 0.001;
function ringIsReal(ring: unknown): boolean {
  if (!Array.isArray(ring) || ring.length === 0) return false;
  if (ring.length > 5) return true;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const pt of ring as number[][]) {
    if (!Array.isArray(pt) || pt.length < 2) return false;
    minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
    minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
  }
  return maxX - minX >= DEGENERATE_SPAN_DEG || maxY - minY >= DEGENERATE_SPAN_DEG;
}
function hasRealGeometry(g?: { type: string; coordinates: unknown }): boolean {
  if (!g || !Array.isArray(g.coordinates)) return false;
  if (g.type === 'Polygon') return ringIsReal((g.coordinates as unknown[])[0]);
  if (g.type === 'MultiPolygon') {
    return (g.coordinates as unknown[][]).some((poly) => Array.isArray(poly) && ringIsReal(poly[0]));
  }
  return false;
}

// "See everything we created" map for the Management view. Fetches every
// boundary ENTITY for the logged-in tenant (one /boundary/_search, no codes)
// and highlights the ones with real geometry on an OSM basemap. Entity-based
// rather than relationship-based so it works even when the hierarchy tree is
// incomplete or inconsistent — geometry lives on the entity, not the tree.
export function BoundaryOverviewMap() {
  const tenantId = apiClient.getAuth().tenantId;
  const [features, setFeatures] = useState<Feature[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'ready' | 'error'>('idle');
  const [count, setCount] = useState<{ total: number; withGeom: number }>({ total: 0, withGeom: 0 });

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const entities = await boundaryService.getAllBoundaryEntities(tenantId);
        if (cancelled) return;
        const feats: Feature[] = entities
          .filter((e) => hasRealGeometry(e.geometry))
          .map((e) => ({
            type: 'Feature',
            geometry: e.geometry as { type: string; coordinates: unknown },
            properties: { code: e.code, name: e.code, boundaryType: e.boundaryType },
          }));
        setFeatures(feats);
        setCount({ total: entities.length, withGeom: feats.length });
        setStatus(feats.length > 0 ? 'ready' : 'empty');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (!tenantId) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Boundary map</span>
        {status === 'ready' && (
          <span className="text-xs text-gray-500">
            {count.withGeom} of {count.total} boundaries with map geometry
          </span>
        )}
      </div>

      {status === 'loading' && <div className="text-sm text-gray-500">Loading boundaries…</div>}
      {status === 'error' && <div className="text-sm text-red-600">Could not load boundaries for this tenant.</div>}
      {status === 'empty' && (
        <div className="text-sm text-gray-500">
          No boundaries with real map geometry yet. Run Phase 2 (Fetch from OpenStreetMap) to populate them.
        </div>
      )}
      {status === 'ready' && (
        <BoundaryMap data={{ type: 'FeatureCollection', features: features as unknown[] }} height="480px" />
      )}
    </div>
  );
}

export default BoundaryOverviewMap;

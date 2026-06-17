import { useEffect, useState } from 'react';
import { apiClient } from '@/api/client';
import { boundaryService } from '@/api/services/boundary';
import { BoundaryMap } from '@/components/ui/BoundaryMap';

type Feature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: { code: string; name: string; boundaryType?: string };
};

// "See everything we just created" map for the management view. Resolves the
// logged-in tenant, walks its boundary hierarchy, and draws the leaf-level
// polygons (wards) highlighted on an OSM basemap. Leaves only — drawing every
// level stacks overlapping fills; the lowest level is the meaningful outline.
export function BoundaryOverviewMap() {
  const tenantId = apiClient.getAuth().tenantId;
  const [hierarchies, setHierarchies] = useState<{ hierarchyType: string }[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [features, setFeatures] = useState<Feature[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'empty' | 'ready' | 'error'>('idle');
  const [count, setCount] = useState<{ leaves: number; withGeom: number }>({ leaves: 0, withGeom: 0 });

  // Load hierarchies once, default to the first.
  useEffect(() => {
    if (!tenantId) return;
    boundaryService
      .getHierarchies(tenantId)
      .then((hs) => {
        setHierarchies(hs);
        if (hs.length > 0) setSelected(hs[0].hierarchyType);
      })
      .catch(() => setStatus('error'));
  }, [tenantId]);

  // Fetch tree + geometries for the selected hierarchy.
  useEffect(() => {
    if (!tenantId || !selected) return;
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const tree = await boundaryService.searchBoundaries(tenantId, { hierarchyType: selected });
        // Leaves = codes that are never a parent of another node.
        const parents = new Set(tree.map((b) => b.parent).filter(Boolean) as string[]);
        const leaves = tree.filter((b) => !parents.has(b.code));
        const geomByCode = await boundaryService.getGeometriesByCodes(
          tenantId,
          leaves.map((b) => b.code),
        );
        if (cancelled) return;
        const feats: Feature[] = leaves
          .filter((b) => geomByCode[b.code])
          .map((b) => ({
            type: 'Feature',
            geometry: geomByCode[b.code],
            properties: { code: b.code, name: b.name || b.code, boundaryType: b.boundaryType },
          }));
        setFeatures(feats);
        setCount({ leaves: leaves.length, withGeom: feats.length });
        setStatus(feats.length > 0 ? 'ready' : 'empty');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, selected]);

  if (!tenantId) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Boundary map</span>
        {hierarchies.length > 1 && (
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            {hierarchies.map((h) => (
              <option key={h.hierarchyType} value={h.hierarchyType}>
                {h.hierarchyType}
              </option>
            ))}
          </select>
        )}
        {status === 'ready' && (
          <span className="text-xs text-gray-500">
            {count.withGeom} of {count.leaves} boundaries with geometry
          </span>
        )}
      </div>

      {status === 'loading' && <div className="text-sm text-gray-500">Loading boundaries…</div>}
      {status === 'error' && <div className="text-sm text-red-600">Could not load boundaries for this tenant.</div>}
      {status === 'empty' && (
        <div className="text-sm text-gray-500">
          No boundaries with real geometry yet. Run Phase 2 to populate them.
        </div>
      )}
      {status === 'ready' && (
        <BoundaryMap data={{ type: 'FeatureCollection', features: features as unknown[] }} height="480px" />
      )}
    </div>
  );
}

export default BoundaryOverviewMap;

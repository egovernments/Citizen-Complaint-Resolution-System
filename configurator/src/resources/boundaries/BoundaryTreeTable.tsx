import { useEffect, useMemo, useState } from 'react';
import { useListContext } from 'ra-core';
import { useNavigate } from 'react-router-dom';
import { localizationService } from '@/api/services/localization';
import { readLocales } from '@/onboarding/labelLocales';
import { boundaryTree } from './boundaryTree';

/**
 * ours (cfgreview F19, #1565): the boundaries as a tree with their names (rainmaker-boundary-<hierarchy> labels, the
 * active locale first, then en_IN), the code and level beside each. A row opens the boundary.
 */
export function BoundaryTreeTable() {
  const { data, isPending } = useListContext();
  const navigate = useNavigate();
  const rows = useMemo(() => (data ?? []) as Record<string, unknown>[], [data]);
  const [names, setNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    const pairs = new Set<string>();
    for (const r of rows) if (r.tenantId && r.hierarchyType) pairs.add(`${r.tenantId}|${String(r.hierarchyType).toLowerCase()}`);
    const locales = readLocales().slice().reverse();
    Promise.all([...pairs].flatMap((p) => {
      const [tenant, hierarchy] = p.split('|');
      return locales.map((l) => localizationService.searchMessages(tenant, l, `rainmaker-boundary-${hierarchy}`).catch(() => []));
    })).then((sets) => { if (live) setNames(new Map(sets.flat().map((m) => [m.code, m.message]))); });
    return () => { live = false; };
  }, [rows]);

  const tree = useMemo(() => boundaryTree(rows, (c) => names.get(c)), [rows, names]);
  if (isPending) return <p className="p-4 text-sm text-muted-foreground">Loading...</p>;
  if (!tree.length) return <p className="p-4 text-sm text-muted-foreground">No boundaries yet.</p>;
  return (
    <div className="overflow-x-auto" data-testid="boundary-tree">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Level</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">Tenant</th>
          </tr>
        </thead>
        <tbody>
          {tree.map((r) => (
            <tr key={r.code} className="cursor-pointer border-b hover:bg-muted/50" onClick={() => navigate(`/manage/boundaries/${encodeURIComponent(String(r.id))}/show`)}>
              <td className="px-3 py-2" style={{ paddingLeft: `${0.75 + r.depth * 1.25}rem` }}>
                {r.depth > 0 && <span className="mr-1 text-muted-foreground" aria-hidden="true">└</span>}
                <span className="font-medium">{r.name}</span>
              </td>
              <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
              <td className="px-3 py-2">{r.boundaryType ?? ''}</td>
              <td className="hidden px-3 py-2 sm:table-cell">{r.tenantId ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

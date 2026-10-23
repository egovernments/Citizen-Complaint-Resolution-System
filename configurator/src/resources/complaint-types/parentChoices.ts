import { useMemo } from 'react';
import { useGetList } from 'ra-core';

export interface Choice {
  value: string;
  label: string;
}

/**
 * ours#861 A3: the categories a complaint sub-type can sit under - the INTERIOR nodes of RAINMAKER-PGR.ComplaintHierarchy
 * (rows without `department` / `slaHours`, which only leaves carry; the same rule as the leaf adapter), active only,
 * labelled "Name (CODE)". `current` stays offered even when it is not (yet) a known category, so an existing record's
 * parent is never silently blanked on edit.
 */
export function parentChoices(rows: ReadonlyArray<Record<string, unknown>> | undefined, current?: string): Choice[] {
  const out: Choice[] = [];
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    if (row.active === false) continue;
    if (row.department != null && row.department !== '') continue;
    if (row.slaHours != null && row.slaHours !== '') continue;
    const code = String(row.code ?? row.id ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const name = typeof row.name === 'string' && row.name.trim() && row.name.trim() !== code ? row.name.trim() : '';
    out.push({ value: code, label: name ? `${name} (${code})` : code });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  const cur = (current ?? '').trim();
  if (cur && !seen.has(cur)) out.unshift({ value: cur, label: `${cur} (not a category)` });
  return out;
}

/** The nodes come from patch 05's whole-tree resource (complaint-hierarchy-nodes). */
export function useParentChoices(current?: string): Choice[] {
  const { data } = useGetList('complaint-hierarchy-nodes', { pagination: { page: 1, perPage: 1000 }, sort: { field: 'code', order: 'ASC' } });
  return useMemo(() => parentChoices(data as Record<string, unknown>[] | undefined, current), [data, current]);
}

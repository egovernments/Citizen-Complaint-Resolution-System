import { useEffect, useMemo, useState } from 'react';
import { useInput, type InputProps } from 'ra-core';
import { useQuery } from '@tanstack/react-query';
import { mdmsService } from '@/api';
import { useApp } from '../../App';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

// One RAINMAKER-PGR.ComplaintHierarchy row (interior node OR leaf complaint type).
interface HierNode {
  code: string;
  parentCode?: string | null;
  name?: string;
  levelCode?: string;
  order?: number;
  active?: boolean;
  hierarchyType?: string;
  department?: string;
  slaHours?: number;
}
interface Level {
  levelCode: string;
  order?: number;
  isLeafServiceCode?: boolean;
  label?: string;
}

/**
 * Dependent-dropdown cascade over RAINMAKER-PGR.ComplaintHierarchy, mirroring the
 * citizen/employee create flows: one Select per declared level
 * (MAIN_CATEGORY → SECTOR → SUB_TYPE …). The form field (`source`, e.g.
 * serviceCode) is set to the DEEPEST node the operator selects. A branch that
 * has no children at the next level is terminal — its own code becomes the
 * serviceCode (pgr-services accepts any ComplaintHierarchy code). Levels deeper
 * than a terminal selection are hidden.
 */
export function ComplaintHierarchyCascade(props: InputProps & { label?: string }) {
  const { label } = props;
  const { field, fieldState, isRequired } = useInput(props);
  const { state } = useApp();
  // Fetch at the LOGGED-IN tenant (e.g. ke.ige) — that's the operator's own
  // hierarchy. The state root can carry stale/dev-seed rows (Garbage/Street
  // Lights) re-seeded by a redeploy, which would otherwise mask the real data.
  const tenant = state.tenant;

  const { data, isLoading } = useQuery({
    queryKey: ['complaint-hierarchy-cascade', tenant],
    enabled: !!tenant,
    queryFn: async () => {
      const [defs, nodes] = await Promise.all([
        mdmsService.search<{ hierarchyType?: string; levels?: Level[] }>(
          tenant,
          'RAINMAKER-PGR.ComplaintHierarchyDefinition',
          { limit: 50 },
        ),
        mdmsService.search<HierNode>(tenant, 'RAINMAKER-PGR.ComplaintHierarchy', { limit: 2000 }),
      ]);
      const allRows = (nodes || []).filter((n) => n.active !== false && n.code);
      const def =
        (defs || []).find(
          (d) => Array.isArray(d.levels) && d.levels!.length && allRows.some((n) => n.hierarchyType === d.hierarchyType),
        ) ||
        (defs || [])[0] ||
        null;
      const ht = def?.hierarchyType;
      const rows = ht ? allRows.filter((n) => !n.hierarchyType || n.hierarchyType === ht) : allRows;
      const levels: Level[] = def?.levels ? [...def.levels].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
      return { levels, rows };
    },
  });

  const levels = data?.levels ?? [];
  const rows = data?.rows ?? [];
  const byCode = useMemo(() => new Map(rows.map((n) => [n.code, n])), [rows]);

  const [sel, setSel] = useState<(string | null)[]>([]);
  useEffect(() => {
    setSel(levels.map(() => null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levels.length]);

  // Rehydrate the cascade from an existing serviceCode (Edit): walk parentCode up.
  useEffect(() => {
    if (!field.value || rows.length === 0 || levels.length === 0) return;
    if (sel.some(Boolean)) return;
    const chain: Record<string, string> = {};
    let cur = byCode.get(String(field.value));
    const guard = new Set<string>();
    while (cur && !guard.has(cur.code)) {
      guard.add(cur.code);
      if (cur.levelCode) chain[cur.levelCode] = cur.code;
      cur = cur.parentCode ? byCode.get(String(cur.parentCode)) : undefined;
    }
    if (Object.keys(chain).length) setSel(levels.map((l) => chain[l.levelCode] ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.value, rows.length, levels.length]);

  const optionsForLevelWith = (selArr: (string | null)[], i: number): HierNode[] => {
    const lvl = levels[i];
    if (!lvl) return [];
    const parentCode = i === 0 ? null : selArr[i - 1];
    if (i > 0 && !parentCode) return [];
    return rows
      .filter((n) => n.levelCode === lvl.levelCode)
      .filter((n) => (i === 0 ? !n.parentCode : n.parentCode === parentCode))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  };

  const handleChange = (i: number, value: string) => {
    const next = sel.slice();
    next[i] = value || null;
    for (let j = i + 1; j < next.length; j++) next[j] = null;
    setSel(next);
    if (!value) {
      field.onChange('');
      return;
    }
    // Terminal when this is the declared leaf level OR the next level has no
    // options for this selection → its code is the serviceCode. Otherwise clear
    // (force the operator to drill deeper).
    const isLeaf = !!levels[i]?.isLeafServiceCode;
    const hasDeeper = i + 1 < levels.length && optionsForLevelWith(next, i + 1).length > 0;
    field.onChange(isLeaf || !hasDeeper ? value : '');
  };

  const deepest = sel.reduce<number>((acc, v, idx) => (v != null ? idx : acc), -1);
  const terminalAt =
    deepest >= 0 &&
    (deepest + 1 >= levels.length || optionsForLevelWith(sel, deepest + 1).length === 0)
      ? deepest
      : -1;

  return (
    <div>
      {label && (
        <Label className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <div className="space-y-3">
        {levels.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Loading complaint hierarchy…' : 'No complaint hierarchy configured for this tenant.'}
          </p>
        )}
        {levels.map((lvl, i) => {
          if (terminalAt >= 0 && i > terminalAt) return null;
          const opts = optionsForLevelWith(sel, i);
          const disabled = (i > 0 && !sel[i - 1]) || isLoading;
          return (
            <div key={lvl.levelCode}>
              <Label className="mb-1 block text-xs text-muted-foreground">{lvl.label || lvl.levelCode}</Label>
              <Select value={sel[i] ?? ''} onValueChange={(v: string) => handleChange(i, v)} disabled={disabled}>
                <SelectTrigger aria-invalid={(fieldState.invalid && fieldState.isTouched) || undefined}>
                  <SelectValue
                    placeholder={isLoading ? 'Loading…' : disabled ? 'Select the level above first' : 'Select…'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {opts.map((n) => (
                    <SelectItem key={n.code} value={n.code}>
                      {n.name || n.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
      {fieldState.invalid && fieldState.isTouched && fieldState.error?.message && (
        <p className="mt-1 text-xs text-destructive">{fieldState.error.message}</p>
      )}
    </div>
  );
}

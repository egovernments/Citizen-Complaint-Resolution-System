import { useMemo } from 'react';
import { useInput, useGetList, type RaRecord } from 'ra-core';
import { Plus, Trash2 } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { EmployeeJurisdiction } from '@/api/types';

export interface JurisdictionEditorProps {
  source?: string;
  label?: string;
  tenantId: string;
  help?: string;
}

interface HierarchyLevel {
  boundaryType: string;
  parentBoundaryType?: string | null;
  active?: boolean;
}

interface HierarchyRecord extends RaRecord {
  hierarchyType: string;
  boundaryHierarchy?: HierarchyLevel[];
}

interface BoundaryRecord extends RaRecord {
  code: string;
  name?: string;
  boundaryType: string;
  hierarchyType?: string;
  parentCode?: string;
}

function toJurisdictionRow(entry: unknown, tenantId: string): EmployeeJurisdiction {
  const r = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
  // HRMS DTO uses `hierarchy`; MDMS side uses `hierarchyType`. Read either, write both.
  const hierarchyType =
    (typeof r.hierarchyType === 'string' && r.hierarchyType) ||
    (typeof r.hierarchy === 'string' && r.hierarchy) ||
    '';
  return {
    id: typeof r.id === 'string' ? r.id : undefined,
    boundary: typeof r.boundary === 'string' ? r.boundary : '',
    boundaryType: typeof r.boundaryType === 'string' ? r.boundaryType : '',
    hierarchyType,
    isActive: typeof r.isActive === 'boolean' ? r.isActive : true,
    auditDetails: r.auditDetails && typeof r.auditDetails === 'object'
      ? r.auditDetails as EmployeeJurisdiction['auditDetails'] : undefined,
    ...(typeof r.tenantId === 'string' ? { tenantId: r.tenantId } : { tenantId }),
  } as EmployeeJurisdiction & { tenantId: string };
}

export function JurisdictionEditor({
  source = 'jurisdictions',
  label = 'Jurisdictions',
  tenantId,
  help,
}: JurisdictionEditorProps) {
  const { id, field } = useInput({ source });

  const rows: EmployeeJurisdiction[] = useMemo(() => {
    if (!Array.isArray(field.value)) return [];
    return (field.value as unknown[]).map((v) => toJurisdictionRow(v, tenantId));
  }, [field.value, tenantId]);

  const { data: hierarchies, isLoading: hierarchiesLoading } = useGetList<HierarchyRecord>(
    'boundary-hierarchies',
    { pagination: { page: 1, perPage: 100 }, sort: { field: 'hierarchyType', order: 'ASC' } },
  );

  const { data: boundaries, isLoading: boundariesLoading } = useGetList<BoundaryRecord>(
    'boundaries',
    { pagination: { page: 1, perPage: 1000 }, sort: { field: 'name', order: 'ASC' } },
  );

  const hierarchyChoices = useMemo(() => {
    if (!hierarchies) return [] as { value: string; label: string }[];
    return hierarchies.map((h) => ({ value: h.hierarchyType, label: h.hierarchyType }));
  }, [hierarchies]);

  const boundaryTypesByHierarchy = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!hierarchies) return map;
    for (const h of hierarchies) {
      const levels = Array.isArray(h.boundaryHierarchy) ? h.boundaryHierarchy : [];
      const types: string[] = [];
      const seen = new Set<string>();
      for (const lvl of levels) {
        if (!lvl || lvl.active === false) continue;
        const t = lvl.boundaryType;
        if (!t || seen.has(t)) continue;
        seen.add(t);
        types.push(t);
      }
      map.set(h.hierarchyType, types);
    }
    return map;
  }, [hierarchies]);

  const boundariesByHierarchyAndType = useMemo(() => {
    const byHierarchy = new Map<string, Map<string, BoundaryRecord[]>>();
    const byTypeOnly = new Map<string, BoundaryRecord[]>();
    if (!boundaries) return { byHierarchy, byTypeOnly };
    for (const b of boundaries) {
      if (!b.boundaryType) continue;
      const listByType = byTypeOnly.get(b.boundaryType) ?? [];
      listByType.push(b);
      byTypeOnly.set(b.boundaryType, listByType);
      if (b.hierarchyType) {
        const inner = byHierarchy.get(b.hierarchyType) ?? new Map<string, BoundaryRecord[]>();
        const arr = inner.get(b.boundaryType) ?? [];
        arr.push(b);
        inner.set(b.boundaryType, arr);
        byHierarchy.set(b.hierarchyType, inner);
      }
    }
    return { byHierarchy, byTypeOnly };
  }, [boundaries]);

  const writeRows = (next: EmployeeJurisdiction[]) => {
    field.onChange(
      next.map((r) => {
        // Boundaries live under the tenant that seeded them (e.g. NAIROBI_CITY
        // lives under ke.nairobi, BOMET under ke). HRMS stores each
        // jurisdiction with the boundary's *home* tenantId, not the session's.
        // Fall back to the session tenant only if we can't resolve.
        const rowTenant = (r as unknown as Record<string, unknown>).tenantId;
        const resolvedTenant = typeof rowTenant === 'string' && rowTenant ? rowTenant : tenantId;
        return {
          ...r,
          // HRMS's DTO validates `hierarchy` (NotNull). Stamp both field names.
          hierarchy: r.hierarchyType ?? '',
          hierarchyType: r.hierarchyType ?? '',
          isActive: true,
          tenantId: resolvedTenant,
        };
      }),
    );
  };

  const updateRow = (index: number, patch: Partial<EmployeeJurisdiction>) => {
    const next = rows.slice();
    next[index] = { ...next[index], ...patch } as EmployeeJurisdiction;
    writeRows(next);
  };

  const addRow = () => {
    writeRows([
      ...rows,
      {
        hierarchyType: '',
        boundaryType: '',
        boundary: '',
        isActive: true,
      } as EmployeeJurisdiction,
    ]);
  };

  const removeRow = (index: number) => {
    const next = rows.slice();
    next.splice(index, 1);
    writeRows(next);
  };

  const boundaryByCode = useMemo(() => {
    const m = new Map<string, BoundaryRecord>();
    for (const b of boundaries ?? []) if (b.code) m.set(b.code, b);
    return m;
  }, [boundaries]);

  // Walk up parentCode from the deepest stored boundary so the cascade
  // pre-fills the selection at every level on edit.
  const reconstructPath = (boundaryCode: string): Record<string, string> => {
    const path: Record<string, string> = {};
    let cur = boundaryCode ? boundaryByCode.get(boundaryCode) : undefined;
    let guard = 0;
    while (cur && guard++ < 25) {
      if (cur.boundaryType) path[cur.boundaryType] = cur.code;
      cur = cur.parentCode ? boundaryByCode.get(cur.parentCode) : undefined;
    }
    return path;
  };

  // Boundaries selectable at one level: of that type in the hierarchy, filtered
  // to the chosen parent (root level lists all of its type).
  const boundariesForLevel = (
    hierType: string,
    levelType: string,
    parentCode?: string,
  ): BoundaryRecord[] => {
    const inner = boundariesByHierarchyAndType.byHierarchy.get(hierType);
    let candidates =
      inner && inner.size > 0
        ? inner.get(levelType) ?? []
        : boundariesByHierarchyAndType.byTypeOnly.get(levelType) ?? [];
    if (parentCode) candidates = candidates.filter((b) => b.parentCode === parentCode);
    return candidates;
  };

  // Picking a boundary at a level makes it the deepest stored selection;
  // deeper levels reset automatically (the path is derived from row.boundary).
  const selectLevel = (index: number, levelType: string, code: string) => {
    const picked = boundaryByCode.get(code);
    updateRow(index, {
      boundary: code,
      boundaryType: levelType,
      // Correct any stale stored hierarchy (e.g. "ADMIN") to the boundary's real one.
      ...(picked?.hierarchyType ? { hierarchyType: picked.hierarchyType } : {}),
      ...(picked?.tenantId
        ? ({ tenantId: picked.tenantId } as Partial<EmployeeJurisdiction>)
        : {}),
    });
  };

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
        </Label>
      )}

      {rows.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
          <p className="text-sm text-muted-foreground">No jurisdictions added yet</p>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-4 h-4" />
            Add jurisdiction
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => {
            const storedHier = row.hierarchyType ?? '';
            // Old jurisdictions (bulk import) often store a stale hierarchy name
            // like "ADMIN" that doesn't match the tenant's real boundary
            // hierarchy (e.g. "Bomet_Hierarchy") — so the cascade rendered empty.
            // Infer the effective hierarchy from the stored boundary, then fall
            // back to the sole hierarchy, so existing jurisdictions still show.
            const knownHiers = new Set(hierarchyChoices.map((c) => c.value));
            const boundaryHier = row.boundary
              ? boundaryByCode.get(row.boundary)?.hierarchyType
              : undefined;
            const hierarchyType =
              storedHier && knownHiers.has(storedHier)
                ? storedHier
                : boundaryHier && knownHiers.has(boundaryHier)
                  ? boundaryHier
                  : hierarchyChoices.length === 1
                    ? hierarchyChoices[0].value
                    : storedHier;
            const levels = hierarchyType ? boundaryTypesByHierarchy.get(hierarchyType) ?? [] : [];
            const path = reconstructPath(row.boundary ?? '');

            return (
              <div key={index} className="relative border rounded p-3 pr-10 bg-muted/30">
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  aria-label={`Remove jurisdiction ${index + 1}`}
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Hierarchy
                    </Label>
                    <Select
                      value={hierarchyType}
                      onValueChange={(value) =>
                        updateRow(index, {
                          hierarchyType: value,
                          boundaryType: '',
                          boundary: '',
                        })
                      }
                      disabled={hierarchiesLoading}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={hierarchiesLoading ? 'Loading...' : 'Select hierarchy...'}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {hierarchyChoices.map((c) => (
                          <SelectItem key={c.value} value={c.value} data-value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* One dropdown per hierarchy level (e.g. Province → District →
                      Municipality). Each level is filtered to the parent picked
                      above it; depth adapts to whatever the hierarchy defines.
                      The deepest pick becomes the stored jurisdiction boundary. */}
                  {levels.map((levelType, li) => {
                    const parentType = li > 0 ? levels[li - 1] : null;
                    const parentCode = parentType ? path[parentType] : undefined;
                    const gatedOff = li > 0 && !parentCode;
                    const opts = boundariesForLevel(hierarchyType, levelType, parentCode);
                    const selected = path[levelType] ?? '';
                    return (
                      <div key={levelType}>
                        <Label className="mb-1.5 block text-xs font-medium text-foreground">
                          {levelType}
                        </Label>
                        <Select
                          value={selected}
                          onValueChange={(code) => selectLevel(index, levelType, code)}
                          disabled={!hierarchyType || gatedOff || boundariesLoading}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                gatedOff
                                  ? `Select ${parentType} first`
                                  : boundariesLoading
                                    ? 'Loading...'
                                    : `Select ${levelType}...`
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {opts.map((b) => (
                              <SelectItem key={b.code} value={b.code} data-value={b.code}>
                                {b.name ?? b.code}
                                {b.tenantId && b.tenantId !== tenantId ? (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    · {b.tenantId}
                                  </span>
                                ) : null}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>

              </div>
            );
          })}

          <div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="w-4 h-4" />
              Add jurisdiction
            </Button>
          </div>
        </div>
      )}

      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

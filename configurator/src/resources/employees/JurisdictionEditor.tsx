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
        const rowTenant = (r as Record<string, unknown>).tenantId;
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

  const getBoundaryOptions = (hierarchyType: string, boundaryType: string): BoundaryRecord[] => {
    if (!boundaryType) return [];
    const inner = boundariesByHierarchyAndType.byHierarchy.get(hierarchyType);
    if (inner && inner.size > 0) {
      return inner.get(boundaryType) ?? [];
    }
    return boundariesByHierarchyAndType.byTypeOnly.get(boundaryType) ?? [];
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
            const hierarchyType = row.hierarchyType ?? '';
            const boundaryType = row.boundaryType ?? '';
            const boundary = row.boundary ?? '';

            const boundaryTypes = hierarchyType
              ? boundaryTypesByHierarchy.get(hierarchyType) ?? []
              : [];
            const boundaryOptions = getBoundaryOptions(hierarchyType, boundaryType);

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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Boundary Type
                    </Label>
                    <Select
                      value={boundaryType}
                      onValueChange={(value) =>
                        updateRow(index, { boundaryType: value, boundary: '' })
                      }
                      disabled={!hierarchyType || boundaryTypes.length === 0}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select boundary type..." />
                      </SelectTrigger>
                      <SelectContent>
                        {boundaryTypes.map((t) => (
                          <SelectItem key={t} value={t} data-value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Boundary
                    </Label>
                    <Select
                      value={boundary}
                      onValueChange={(value) => {
                        const picked = boundaryOptions.find((b) => b.code === value);
                        updateRow(index, {
                          boundary: value,
                          // Inherit the selected boundary's home tenant so HRMS
                          // can resolve it — boundaries at ke.nairobi are not
                          // visible under ke and vice versa.
                          ...(picked?.tenantId
                            ? ({ tenantId: picked.tenantId } as Partial<EmployeeJurisdiction>)
                            : {}),
                        });
                      }}
                      disabled={!boundaryType || boundariesLoading}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={boundariesLoading ? 'Loading...' : 'Select boundary...'}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {boundaryOptions.map((b) => (
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

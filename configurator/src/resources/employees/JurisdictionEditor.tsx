import { useMemo } from 'react';
import { useInput, useGetList, type RaRecord } from 'ra-core';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { uniqueBy } from '@/lib/uniqueBy';
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

  // One option per hierarchyType. `boundary-hierarchies` aggregates the state
  // tenant's definitions with every city tenant's, and nothing stops two tenants
  // from both calling theirs "ADMIN" — bomet has 7 — which Radix renders as 7
  // identical, all-checked options (#1923). The cascade below keys purely off
  // the hierarchyType string, so the collapsed option drives it identically.
  const hierarchyChoices = useMemo(() => {
    if (!hierarchies) return [] as { value: string; label: string }[];
    return uniqueBy(
      hierarchies.map((h) => ({ value: h.hierarchyType, label: h.hierarchyType })),
      (c) => c.value,
    );
  }, [hierarchies]);

  // Keyed by hierarchyType, first definition wins — deliberately the same
  // survivor `hierarchyChoices` keeps, so the levels the cascade renders belong
  // to the tenant whose option the operator actually picked. Last-wins here let
  // a sub-tenant's shallower "ADMIN" silently truncate the state tenant's
  // County -> Ward cascade to just County.
  const boundaryTypesByHierarchy = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!hierarchies) return map;
    for (const h of hierarchies) {
      if (map.has(h.hierarchyType)) continue;
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
          // Carry the row's own flag through. `false` is how a jurisdiction is
          // revoked (see removeRow); hard-coding `true` here re-granted it on
          // the very next edit to any other row.
          isActive: r.isActive !== false,
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

  // HRMS will not accept an update payload that drops a jurisdiction it has
  // already stored: EmployeeValidator.validateConsistencyJurisdiction fails the
  // whole request with ERR_HRMS_UPDATE_JURISDICTION_INCOSISTENT unless every
  // previously persisted id comes back, so splicing the row out made every
  // revoke 400 (#1957). HRMS's own revoke mechanism is the isActive flag, so
  // keep the row in the payload and switch it off: egov-hrms's
  // EmployeeRowMapper then drops it from _search, and pgr-services'
  // PolicyDrivenScopeResolver stops unioning its boundary into the employee's
  // scope. A row the operator added but never saved has no id for HRMS to miss,
  // so that one really is just removed.
  const removeRow = (index: number) => {
    if (rows[index]?.id) {
      updateRow(index, { isActive: false });
      return;
    }
    const next = rows.slice();
    next.splice(index, 1);
    writeRows(next);
  };

  const restoreRow = (index: number) => {
    updateRow(index, { isActive: true });
  };

  // A revoked row still has to travel in the form value (HRMS needs the id
  // back) but must not keep rendering a live editor, so split the two views.
  // Indices are the ones into the full `rows` array — every mutation below
  // addresses the payload, not the visible list.
  const visibleRows = useMemo(
    () => rows.map((row, index) => ({ row, index })).filter(({ row }) => row.isActive !== false),
    [rows],
  );
  const revokedRows = useMemo(
    () => rows.map((row, index) => ({ row, index })).filter(({ row }) => row.isActive === false),
    [rows],
  );

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
    // Boundary codes are unique per tenant, not globally — `ke.mycitynew` and
    // `ke.hajbvfg` both seed CITY_001/WARD_001 — and the provider concatenates
    // both tenants' trees. Collapse by code so one boundary is one option.
    return uniqueBy(candidates, (b) => b.code);
  };

  // Picking a boundary at a level makes it the deepest stored selection;
  // deeper levels reset automatically (the path is derived from row.boundary).
  const selectLevel = (index: number, levelType: string, code: string) => {
    // Radix's Select renders a hidden native <select> ("bubble input") that
    // fires onValueChange('') whenever the controlled `value` matches none of
    // the registered SelectItems — which is exactly the state this cascade is
    // in for the first frames after mount, while the boundary list is still
    // being fetched. Writing that '' through would blank an existing
    // jurisdiction the user never touched, and HRMS then hands boundary-service
    // an empty code list, which composes `... AND boundary.code IN ( )` and
    // dies with a Postgres syntax error surfaced as QUERY_EXECUTION_ERROR — so
    // editing ANY employee that already has a jurisdiction 400s on Save.
    // A real pick can never be empty: Radix forbids SelectItem value="".
    if (!code) return;
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

      {visibleRows.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
          <p className="text-sm text-muted-foreground">No jurisdictions added yet</p>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-4 h-4" />
            Add jurisdiction
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map(({ row, index }) => {
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
              <div key={row.id ?? `new-${index}`} className="relative border rounded p-3 pr-10 bg-muted/30">
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
                      onValueChange={(value) => {
                        // Same Radix bubble-input guard as selectLevel: an
                        // unregistered controlled value (a stale stored
                        // hierarchy like "ADMIN", or the loading window) echoes
                        // '' back through onValueChange, and this handler
                        // clears `boundary` — silently discarding the
                        // jurisdiction on the next Save.
                        if (!value) return;
                        updateRow(index, {
                          hierarchyType: value,
                          boundaryType: '',
                          boundary: '',
                        });
                      }}
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

      {revokedRows.length > 0 && (
        <div className="mt-2 rounded-md border border-dashed p-3">
          <p className="text-xs font-medium text-foreground">Revoked on save</p>
          <ul className="mt-1.5 space-y-1">
            {revokedRows.map(({ row, index }) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
              >
                <span>
                  {boundaryByCode.get(row.boundary ?? '')?.name ?? row.boundary}
                  {row.boundaryType ? ` · ${row.boundaryType}` : ''}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => restoreRow(index)}
                  className="h-6 gap-1 px-2"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            HRMS keeps the record and marks it inactive — the employee loses access to these
            boundaries.
          </p>
        </div>
      )}

      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

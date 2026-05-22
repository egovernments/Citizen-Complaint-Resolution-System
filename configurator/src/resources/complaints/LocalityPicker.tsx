import { useMemo } from 'react';
import { useInput, useGetList, type RaRecord } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

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

export interface LocalityPickerProps {
  /** Form path for the boundary CODE (typically `address.locality.code`). */
  source?: string;
  label?: string;
  help?: string;
  /** When true, the field is required for validation. */
  required?: boolean;
}

/** Single-select cascading locality picker: hierarchy → boundaryType → boundary.
 *  Writes only the selected boundary's `code` to the form. Hierarchy and type
 *  choices live in local state — they're navigation, not data.
 *
 *  Mirrors `JurisdictionEditor`'s index scheme but emits a flat string for
 *  PGR's `address.locality.code` shape. */
export function LocalityPicker({
  source = 'address.locality.code',
  label = 'Locality',
  help,
  required,
}: LocalityPickerProps) {
  const { id, field, fieldState } = useInput({ source, validate: required ? requiredV : undefined });

  const { data: hierarchies, isLoading: hierarchiesLoading } = useGetList<HierarchyRecord>(
    'boundary-hierarchies',
    { pagination: { page: 1, perPage: 100 }, sort: { field: 'hierarchyType', order: 'ASC' } },
  );

  const { data: boundaries, isLoading: boundariesLoading } = useGetList<BoundaryRecord>(
    'boundaries',
    { pagination: { page: 1, perPage: 1000 }, sort: { field: 'name', order: 'ASC' } },
  );

  // Seed the navigation selects from the *current* boundary code (if the form
  // loaded an existing complaint). We look up the boundary record and back out
  // its hierarchy + boundaryType so the selects display the right ancestors.
  const currentBoundary = useMemo<BoundaryRecord | undefined>(() => {
    const code = field.value;
    if (!code || typeof code !== 'string') return undefined;
    return (boundaries ?? []).find((b) => b.code === code);
  }, [field.value, boundaries]);

  const hierarchyChoices = useMemo(() => {
    if (!hierarchies) return [] as { value: string; label: string }[];
    return hierarchies.map((h) => ({ value: h.hierarchyType, label: h.hierarchyType }));
  }, [hierarchies]);

  const boundaryTypesByHierarchy = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!hierarchies) return map;
    for (const h of hierarchies) {
      const seen = new Set<string>();
      const types: string[] = [];
      for (const lvl of h.boundaryHierarchy ?? []) {
        if (!lvl || lvl.active === false) continue;
        if (!lvl.boundaryType || seen.has(lvl.boundaryType)) continue;
        seen.add(lvl.boundaryType);
        types.push(lvl.boundaryType);
      }
      map.set(h.hierarchyType, types);
    }
    return map;
  }, [hierarchies]);

  const boundaryIndex = useMemo(() => {
    const byHierarchy = new Map<string, Map<string, BoundaryRecord[]>>();
    const byTypeOnly = new Map<string, BoundaryRecord[]>();
    for (const b of boundaries ?? []) {
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

  // Local navigation state — derived from the loaded value or defaults.
  const hierarchyType =
    currentBoundary?.hierarchyType ?? hierarchyChoices[0]?.value ?? '';
  const boundaryType =
    currentBoundary?.boundaryType ??
    (boundaryTypesByHierarchy.get(hierarchyType) ?? [])[0] ??
    '';

  // Navigation state that the operator *actually* manipulates: we keep the
  // hierarchy + type in form-local sidecars so changing them doesn't fire an
  // immediate `field.onChange` of a broken code.
  const { hSource, tSource } = {
    hSource: `${source}__h`,
    tSource: `${source}__t`,
  };
  const hInput = useInput({ source: hSource, defaultValue: hierarchyType });
  const tInput = useInput({ source: tSource, defaultValue: boundaryType });
  const activeHierarchy = String(hInput.field.value || hierarchyType);
  const activeType = String(tInput.field.value || boundaryType);

  const typesForHierarchy =
    boundaryTypesByHierarchy.get(activeHierarchy) ?? [];

  const boundaryOptions = useMemo<BoundaryRecord[]>(() => {
    if (!activeType) return [];
    const inner = boundaryIndex.byHierarchy.get(activeHierarchy);
    if (inner && inner.size > 0) return inner.get(activeType) ?? [];
    return boundaryIndex.byTypeOnly.get(activeType) ?? [];
  }, [boundaryIndex, activeHierarchy, activeType]);

  const hasError = fieldState.invalid && fieldState.isTouched;
  const errorMessage = fieldState.error?.message;

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {required && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Select
          value={activeHierarchy}
          onValueChange={(v) => {
            hInput.field.onChange(v);
            tInput.field.onChange('');
            field.onChange('');
          }}
          disabled={hierarchiesLoading}
        >
          <SelectTrigger>
            <SelectValue placeholder={hierarchiesLoading ? 'Loading…' : 'Hierarchy'} />
          </SelectTrigger>
          <SelectContent>
            {hierarchyChoices.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={activeType}
          onValueChange={(v) => {
            tInput.field.onChange(v);
            field.onChange('');
          }}
          disabled={!activeHierarchy || typesForHierarchy.length === 0}
        >
          <SelectTrigger>
            <SelectValue placeholder="Boundary Type" />
          </SelectTrigger>
          <SelectContent>
            {typesForHierarchy.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={typeof field.value === 'string' ? field.value : ''}
          onValueChange={(v) => field.onChange(v)}
          disabled={!activeType || boundariesLoading}
        >
          <SelectTrigger
            id={id}
            aria-invalid={hasError || undefined}
            className={hasError ? 'border-destructive focus-visible:ring-destructive' : ''}
          >
            <SelectValue placeholder={boundariesLoading ? 'Loading…' : 'Boundary'} />
          </SelectTrigger>
          <SelectContent>
            {boundaryOptions.map((b) => (
              <SelectItem key={b.code} value={b.code}>
                {b.name ?? b.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasError && errorMessage && (
        <p className="mt-1 text-xs text-destructive" role="alert">{errorMessage}</p>
      )}
      {!hasError && help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function requiredV(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? 'Required' : undefined;
}

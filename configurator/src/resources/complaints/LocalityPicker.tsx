import { useMemo, useState } from 'react';
import { useInput, useGetList, type RaRecord } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { uniqueBy } from '@/lib/uniqueBy';

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

  // Same story as `boundaries` below: client-side slicing only, so don't truncate.
  const { data: hierarchies, isLoading: hierarchiesLoading } = useGetList<HierarchyRecord>(
    'boundary-hierarchies',
    { pagination: { page: 1, perPage: 100_000 }, sort: { field: 'hierarchyType', order: 'ASC' } },
  );

  // `boundaries` has no server-side pagination in the data provider — it fetches
  // every tenant tree and then slices `perPage` off the front — so `perPage` is
  // a pure TRUNCATION knob here, not a cost control. The old 1000 silently cut a
  // 1256-node deployment (mz.maputo) off at the knees: any complaint whose
  // locality fell past the cut had no matching record, so `currentBoundary` came
  // back undefined, the ancestor selects fell back to some unrelated hierarchy,
  // and the Boundary control rendered its bare "Boundary" placeholder instead of
  // the complaint's real locality. Ask for the whole set.
  const { data: boundaries, isLoading: boundariesLoading } = useGetList<BoundaryRecord>(
    'boundaries',
    { pagination: { page: 1, perPage: 100_000 }, sort: { field: 'name', order: 'ASC' } },
  );

  // Seed the navigation selects from the *current* boundary code (if the form
  // loaded an existing complaint). We look up the boundary record and back out
  // its hierarchy + boundaryType so the selects display the right ancestors.
  const currentBoundary = useMemo<BoundaryRecord | undefined>(() => {
    const code = field.value;
    if (!code || typeof code !== 'string') return undefined;
    return (boundaries ?? []).find((b) => b.code === code);
  }, [field.value, boundaries]);

  // One option per hierarchyType — see the same note in JurisdictionEditor.
  // `boundary-hierarchies` merges the state tenant's definitions with every city
  // tenant's and two tenants may both name theirs "ADMIN" (#1923).
  const hierarchyChoices = useMemo(() => {
    if (!hierarchies) return [] as { value: string; label: string }[];
    return uniqueBy(
      hierarchies.map((h) => ({ value: h.hierarchyType, label: h.hierarchyType })),
      (c) => c.value,
    );
  }, [hierarchies]);

  // Only expose the LEAF boundary type(s) per hierarchy — types that
  // aren't anyone's `parentBoundaryType` within the same hierarchy.
  // Gurjeet's #478 retest showed operators filing complaints at
  // "Nairobi City County" (root), which the PGR backend will route to
  // no ward and the resolver UI then can't show a sane assignment
  // surface. The original digit-ui side enforced this with
  // `isBoundaryLeaf` at submit; mirror that constraint here at the
  // picker so the operator is structurally prevented from choosing a
  // non-leaf rather than seeing a late toast.
  const boundaryTypesByHierarchy = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!hierarchies) return map;
    for (const h of hierarchies) {
      // First definition wins — the same survivor hierarchyChoices keeps, so a
      // sub-tenant's same-named hierarchy can't override the leaf types of the
      // one the operator sees. See JurisdictionEditor for the long note.
      if (map.has(h.hierarchyType)) continue;
      const levels = (h.boundaryHierarchy ?? []).filter(
        (lvl): lvl is HierarchyLevel => !!lvl && lvl.active !== false && !!lvl.boundaryType,
      );
      const parents = new Set<string>();
      for (const lvl of levels) {
        if (lvl.parentBoundaryType) parents.add(lvl.parentBoundaryType);
      }
      const seen = new Set<string>();
      const leafTypes: string[] = [];
      for (const lvl of levels) {
        // Leaf = not the parent of anything else in this hierarchy.
        if (parents.has(lvl.boundaryType)) continue;
        if (seen.has(lvl.boundaryType)) continue;
        seen.add(lvl.boundaryType);
        leafTypes.push(lvl.boundaryType);
      }
      map.set(h.hierarchyType, leafTypes);
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

  // Navigation state that the operator *actually* manipulates. This is COMPONENT
  // state, never form state: the previous version registered `useInput` on
  // `${source}__h` / `${source}__t`, and because `source` is `address.locality.code`
  // those paths resolve INSIDE the locality object — so react-hook-form built
  // `address.locality.code__h` / `code__t` and the form posted this picker's
  // private navigation into PGR's address contract. pgr-services tolerates the
  // extra keys (they're dropped when the payload is bound to the Boundary POJO),
  // but they are not ours to send.
  const [navHierarchy, setNavHierarchy] = useState<string | null>(null);
  const [navType, setNavType] = useState<string | null>(null);
  const activeHierarchy = navHierarchy ?? hierarchyType;
  const activeType = navType ?? boundaryType;

  const typesForHierarchy =
    boundaryTypesByHierarchy.get(activeHierarchy) ?? [];

  // Collapse by code: boundary codes are unique per tenant, not globally, and
  // the provider concatenates every tenant's tree — two tenants seeding
  // CITY_001 would otherwise offer the same locality twice.
  const boundaryOptions = useMemo<BoundaryRecord[]>(() => {
    if (!activeType) return [];
    const inner = boundaryIndex.byHierarchy.get(activeHierarchy);
    const forType =
      inner && inner.size > 0
        ? inner.get(activeType) ?? []
        : boundaryIndex.byTypeOnly.get(activeType) ?? [];
    return uniqueBy(forType, (b) => b.code);
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
            if (!v) return; // Radix echo — see the note on the Boundary select below.
            setNavHierarchy(v);
            setNavType(null);
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
            if (!v) return; // Radix echo — see the note on the Boundary select below.
            setNavType(v);
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

        {/* THE LOCALITY WIPE. Radix renders a hidden form-bubble <select> to make
            the control submittable, and its <option>s are contributed by the
            SelectItems — which live in the portalled content and are therefore
            NOT mounted while the dropdown is closed. Its effect fires on every
            change of the controlled `value`: it assigns the new value to the
            native select and dispatches a synthetic `change`. With no options
            mounted the assignment can't take, the native value stays "", and the
            event reports "" back through `onValueChange`.

            On an edit form that happens unprompted: the hierarchy/type selects
            go from "" to their resolved defaults the moment the boundary queries
            settle, each echoes "", and the handlers dutifully cleared the code.
            `useInput`'s default parse turns "" into null, so the form posted
            `address.locality.code: null`. pgr-services accepted it (200) and
            published to `update-pgr-request`, then egov-persister died on
            `null value in column "locality" of relation "eg_pgr_address_v2"` —
            and because the address and service UPDATEs share one transaction,
            the description/status edit rolled back with it. Nine retries, message
            dropped, complaint silently unchanged with its workflow advanced.

            Radix rejects an empty SelectItem value, so an empty payload is ALWAYS
            the echo and never an operator choice. Drop it. */}
        <Select
          value={typeof field.value === 'string' ? field.value : ''}
          onValueChange={(v) => {
            if (!v) return;
            field.onChange(v);
          }}
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

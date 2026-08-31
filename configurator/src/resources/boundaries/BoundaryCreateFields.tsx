import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFormContext, useWatch } from 'react-hook-form';
import { DigitFormCodeInput, DigitFormSelect, v } from '@/admin';
import { boundaryService } from '@/api';
import type { Boundary, BoundaryHierarchy } from '@/api/types';
import { useApp } from '@/App';
import {
  activeHierarchyLevels,
  parentBoundaryChoices,
  parentTypeForLevel,
} from './boundaryCreateModel';

export function BoundaryCreateFields() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const { control, setValue } = useFormContext();
  const hierarchyType = (useWatch({ control, name: 'hierarchyType' }) as string | undefined) ?? '';
  const boundaryType = (useWatch({ control, name: 'boundaryType' }) as string | undefined) ?? '';
  const previousHierarchy = useRef(hierarchyType);
  const previousBoundaryType = useRef(boundaryType);

  const {
    data: hierarchies = [],
    isLoading: hierarchiesLoading,
    isError: hierarchiesError,
  } = useQuery<BoundaryHierarchy[]>({
    queryKey: ['boundary-create-hierarchies', tenantId],
    enabled: Boolean(tenantId),
    queryFn: () => boundaryService.getHierarchies(tenantId),
  });

  const levels = useMemo(
    () => activeHierarchyLevels(hierarchies, hierarchyType),
    [hierarchies, hierarchyType],
  );
  const parentBoundaryType = parentTypeForLevel(levels, boundaryType);

  const {
    data: boundaries = [],
    isLoading: boundariesLoading,
    isError: boundariesError,
  } = useQuery<Boundary[]>({
    queryKey: ['boundary-create-parents', tenantId, hierarchyType],
    enabled: Boolean(tenantId && hierarchyType && parentBoundaryType),
    // Use the boundary service directly here. The generic Management list
    // intentionally aggregates child tenants for state-level visibility; a
    // create form must only offer parents owned by the authenticated tenant.
    queryFn: () => boundaryService.searchBoundaries(tenantId, { hierarchyType }),
  });

  useEffect(() => {
    if (previousHierarchy.current !== hierarchyType) {
      previousHierarchy.current = hierarchyType;
      previousBoundaryType.current = '';
      setValue('boundaryType', '', { shouldDirty: true, shouldValidate: true });
      setValue('parent', null, { shouldDirty: true, shouldValidate: true });
    }
  }, [hierarchyType, setValue]);

  useEffect(() => {
    if (previousBoundaryType.current !== boundaryType) {
      previousBoundaryType.current = boundaryType;
      setValue('parent', null, { shouldDirty: true, shouldValidate: true });
    }
  }, [boundaryType, setValue]);

  useEffect(() => {
    if (!parentBoundaryType) {
      setValue('parent', null, { shouldValidate: true });
    }
  }, [parentBoundaryType, setValue]);

  const hierarchyChoices = useMemo(
    () =>
      hierarchies
        .filter((item) => item.tenantId === tenantId && Boolean(item.hierarchyType))
        .map((item) => ({ value: item.hierarchyType, label: item.hierarchyType }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [hierarchies, tenantId],
  );
  const boundaryTypeChoices = levels.map((level) => ({
    value: level.boundaryType,
    label: level.boundaryType,
  }));
  const parentChoices = useMemo(
    () =>
      parentBoundaryType
        ? parentBoundaryChoices(boundaries, tenantId, hierarchyType, parentBoundaryType)
        : [],
    [boundaries, hierarchyType, parentBoundaryType, tenantId],
  );

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Creating this boundary for login tenant <strong>{tenantId}</strong>.
      </p>

      <DigitFormCodeInput source="code" label="Code" validate={v.codeRequired} />
      <DigitFormSelect
        source="hierarchyType"
        label="Hierarchy"
        choices={hierarchyChoices}
        validate={v.required}
        disabled={hierarchiesLoading || hierarchyChoices.length === 0}
        placeholder={hierarchiesLoading ? 'Loading hierarchies...' : 'Select hierarchy...'}
        help={
          hierarchiesError
            ? `Could not load hierarchy definitions for ${tenantId}.`
            : hierarchyChoices.length === 0 && !hierarchiesLoading
              ? `No boundary hierarchy is defined for ${tenantId}. Create one before adding boundaries.`
              : undefined
        }
      />
      <DigitFormSelect
        source="boundaryType"
        label="Boundary Type"
        choices={boundaryTypeChoices}
        validate={v.required}
        disabled={!hierarchyType || boundaryTypeChoices.length === 0}
        placeholder={hierarchyType ? 'Select boundary type...' : 'Select hierarchy first'}
      />

      {parentBoundaryType && (
        <DigitFormSelect
          source="parent"
          label={`Parent Boundary (${parentBoundaryType})`}
          choices={parentChoices}
          validate={v.required}
          disabled={boundariesLoading || parentChoices.length === 0}
          placeholder={boundariesLoading ? 'Loading parent boundaries...' : 'Select parent boundary...'}
          help={
            boundariesError
              ? `Could not load ${parentBoundaryType} boundaries for ${tenantId}.`
              : parentChoices.length === 0 && !boundariesLoading
                ? `No ${parentBoundaryType} parent exists in ${hierarchyType} for ${tenantId}.`
                : undefined
          }
        />
      )}
    </>
  );
}

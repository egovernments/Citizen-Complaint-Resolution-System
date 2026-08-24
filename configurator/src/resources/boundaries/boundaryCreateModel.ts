import type { Boundary, BoundaryHierarchy, BoundaryLevel } from '@/api/types';

export function activeHierarchyLevels(
  hierarchies: BoundaryHierarchy[],
  hierarchyType: string,
): BoundaryLevel[] {
  const hierarchy = hierarchies.find((item) => item.hierarchyType === hierarchyType);
  return (hierarchy?.boundaryHierarchy ?? []).filter(
    (level) => level.active !== false && Boolean(level.boundaryType),
  );
}

export function parentTypeForLevel(
  levels: BoundaryLevel[],
  boundaryType: string,
): string | null {
  const level = levels.find((item) => item.boundaryType === boundaryType);
  const parentType = level?.parentBoundaryType?.trim();
  return parentType || null;
}

export function parentBoundaryChoices(
  boundaries: Boundary[],
  tenantId: string,
  hierarchyType: string,
  parentBoundaryType: string,
): Array<{ value: string; label: string }> {
  return boundaries
    .filter(
      (boundary) =>
        boundary.tenantId === tenantId &&
        boundary.hierarchyType === hierarchyType &&
        boundary.boundaryType === parentBoundaryType &&
        Boolean(boundary.code),
    )
    .map((boundary) => ({
      value: boundary.code,
      label: boundary.name?.trim() || boundary.code,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

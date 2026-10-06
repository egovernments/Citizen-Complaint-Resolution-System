import { describe, expect, it } from 'vitest';
import type { Boundary, BoundaryHierarchy } from '@/api/types';
import {
  activeHierarchyLevels,
  parentBoundaryChoices,
  parentTypeForLevel,
} from './boundaryCreateModel';

const hierarchies: BoundaryHierarchy[] = [
  {
    tenantId: 'ke',
    hierarchyType: 'CUSTOM',
    boundaryHierarchy: [
      { boundaryType: 'County', active: true },
      { boundaryType: 'SubCounty', parentBoundaryType: 'County', active: true },
      { boundaryType: 'Ward', parentBoundaryType: 'SubCounty', active: true },
      { boundaryType: 'Inactive', parentBoundaryType: 'Ward', active: false },
    ],
  },
];

describe('boundary create hierarchy model', () => {
  it('derives active boundary types and their configured direct parents', () => {
    const levels = activeHierarchyLevels(hierarchies, 'CUSTOM');

    expect(levels.map((level) => level.boundaryType)).toEqual(['County', 'SubCounty', 'Ward']);
    expect(parentTypeForLevel(levels, 'County')).toBeNull();
    expect(parentTypeForLevel(levels, 'Ward')).toBe('SubCounty');
  });

  it('offers parent relationships only from the exact tenant, hierarchy, and parent type', () => {
    const boundaries: Boundary[] = [
      { tenantId: 'ke', hierarchyType: 'CUSTOM', boundaryType: 'SubCounty', code: 'SC_B', name: 'Beta' },
      { tenantId: 'ke', hierarchyType: 'CUSTOM', boundaryType: 'SubCounty', code: 'SC_A', name: 'Alpha' },
      { tenantId: 'ke', hierarchyType: 'ADMIN', boundaryType: 'SubCounty', code: 'WRONG_H', name: 'Wrong hierarchy' },
      { tenantId: 'ke.city', hierarchyType: 'CUSTOM', boundaryType: 'SubCounty', code: 'WRONG_T', name: 'Wrong tenant' },
      { tenantId: 'ke', hierarchyType: 'CUSTOM', boundaryType: 'County', code: 'WRONG_L', name: 'Wrong level' },
    ];

    expect(parentBoundaryChoices(boundaries, 'ke', 'CUSTOM', 'SubCounty')).toEqual([
      { value: 'SC_A', label: 'Alpha' },
      { value: 'SC_B', label: 'Beta' },
    ]);
  });
});

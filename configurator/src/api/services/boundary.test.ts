import { describe, expect, it } from 'vitest';
import { boundaryService } from './boundary';
import type { Boundary } from '../types';

describe('boundaryService.flattenBoundaries', () => {
  it('carries exact tenant and hierarchy context from the relationship wrapper to every node', () => {
    const result: Boundary[] = [];
    const root = {
      code: 'COUNTY_1',
      name: 'County 1',
      boundaryType: 'County',
      children: [
        {
          code: 'WARD_1',
          name: 'Ward 1',
          boundaryType: 'Ward',
        },
      ],
    } as Boundary;

    boundaryService.flattenBoundaries(root, result, new Set(), 'CUSTOM', 'ke');

    expect(result).toHaveLength(2);
    expect(result.map(({ code, tenantId, hierarchyType }) => ({ code, tenantId, hierarchyType }))).toEqual([
      { code: 'COUNTY_1', tenantId: 'ke', hierarchyType: 'CUSTOM' },
      { code: 'WARD_1', tenantId: 'ke', hierarchyType: 'CUSTOM' },
    ]);
  });
});

import { describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    buildRequestInfo: () => ({ apiId: 'test' }),
  },
}));

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

describe('boundaryService.getHierarchies', () => {
  it("hides the baseline's reserved WORKSPACE hierarchy (founder root only)", async () => {
    post.mockResolvedValueOnce({
      BoundaryHierarchy: [
        { tenantId: 'newtown', hierarchyType: 'WORKSPACE', boundaryHierarchy: [{ boundaryType: 'ROOT' }] },
        { tenantId: 'newtown', hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'District' }, { boundaryType: 'Ward' }] },
      ],
    });

    const hierarchies = await boundaryService.getHierarchies('newtown');

    expect(hierarchies.map((h) => h.hierarchyType)).toEqual(['ADMIN']);
  });
});

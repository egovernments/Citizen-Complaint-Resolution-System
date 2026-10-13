import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    buildRequestInfo: () => ({ apiId: 'test' }),
  },
}));

import { boundaryService, pickDefaultHierarchy } from './boundary';
import type { Boundary, BoundaryHierarchy } from '../types';

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

const hierarchy = (hierarchyType: string, createdTime?: number): BoundaryHierarchy => ({
  tenantId: 'ke',
  hierarchyType,
  boundaryHierarchy: [{ boundaryType: 'County', active: true }],
  ...(createdTime === undefined
    ? {}
    : { auditDetails: { createdBy: 'u', createdTime, lastModifiedBy: 'u', lastModifiedTime: createdTime } }),
});
const stubs = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => hierarchy(`PW_${String(from + i).padStart(3, '0')}`));
const searchedOffsets = () =>
  post.mock.calls.map(([, body]) => body.BoundaryTypeHierarchySearchCriteria as { tenantId: string; limit: number; offset: number });

describe('boundaryService.getHierarchies', () => {
  beforeEach(() => post.mockReset());

  // #1915: boundary-service lists newest first, so a tenant the test suite has
  // run against has 300+ PW_* stubs ahead of ADMIN. One page never reached it.
  it('walks every page so a hierarchy behind 200 newer ones is still listed', async () => {
    post
      .mockResolvedValueOnce({ BoundaryHierarchy: stubs(0, 100) })
      .mockResolvedValueOnce({ BoundaryHierarchy: stubs(100, 100) })
      .mockResolvedValueOnce({ BoundaryHierarchy: [...stubs(200, 19), hierarchy('ADMIN')] });

    const hierarchies = await boundaryService.getHierarchies('ke');

    expect(hierarchies).toHaveLength(220);
    expect(hierarchies.map((h) => h.hierarchyType)).toContain('ADMIN');
    expect(searchedOffsets()).toEqual([
      { tenantId: 'ke', limit: 100, offset: 0 },
      { tenantId: 'ke', limit: 100, offset: 100 },
      { tenantId: 'ke', limit: 100, offset: 200 },
    ]);
  });

  it('asks for one more page after an exactly full one and stops on the empty reply', async () => {
    post
      .mockResolvedValueOnce({ BoundaryHierarchy: stubs(0, 100) })
      .mockResolvedValueOnce({ BoundaryHierarchy: [] });

    expect(await boundaryService.getHierarchies('ke')).toHaveLength(100);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('lists a hierarchy once when a create during the walk repeats it on the next page', async () => {
    const first = stubs(0, 100);
    post
      .mockResolvedValueOnce({ BoundaryHierarchy: first })
      .mockResolvedValueOnce({ BoundaryHierarchy: [first[99], hierarchy('ADMIN')] });

    const types = (await boundaryService.getHierarchies('ke')).map((h) => h.hierarchyType);

    expect(types).toHaveLength(101);
    expect(new Set(types).size).toBe(101);
  });

  it('refuses to return a partial list when the service never sends a short page', async () => {
    post.mockResolvedValue({ BoundaryHierarchy: stubs(0, 100) });

    await expect(boundaryService.getHierarchies('ke')).rejects.toThrow(/partial list/);
  });

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

describe('pickDefaultHierarchy', () => {
  // Newest first, as boundary-service returns them.
  const listed = [hierarchy('PW_NEW', 3000), hierarchy('ZONES', 2000), hierarchy('ADMIN', 1000)];

  it("prefers the tenant's recorded hierarchy over ADMIN", () => {
    expect(pickDefaultHierarchy(listed, 'ZONES')?.hierarchyType).toBe('ZONES');
  });

  it('falls back to ADMIN, not the newest, when nothing is recorded', () => {
    expect(pickDefaultHierarchy(listed)?.hierarchyType).toBe('ADMIN');
  });

  it('ignores a recorded hierarchy the tenant does not have', () => {
    expect(pickDefaultHierarchy(listed, 'GONE')?.hierarchyType).toBe('ADMIN');
  });

  it('takes the oldest when there is no recorded hierarchy and no ADMIN', () => {
    const noAdmin = [hierarchy('PW_NEW', 3000), hierarchy('Divisao', 1000), hierarchy('PW_OLDER', 2000)];

    expect(pickDefaultHierarchy(noAdmin)?.hierarchyType).toBe('Divisao');
  });

  it('orders hierarchies without audit details by name, after dated ones', () => {
    expect(pickDefaultHierarchy([hierarchy('B'), hierarchy('A')])?.hierarchyType).toBe('A');
    expect(pickDefaultHierarchy([hierarchy('A'), hierarchy('Z', 5)])?.hierarchyType).toBe('Z');
  });

  it('returns nothing for a tenant with no hierarchies', () => {
    expect(pickDefaultHierarchy([], 'ADMIN')).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
vi.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    buildRequestInfo: () => ({ apiId: 'test' }),
  },
}));

import { boundaryService, getConfiguredHierarchyType, pickDefaultHierarchy } from './boundary';
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
  beforeEach(() => {
    post.mockReset();
    // Past the pages a test lays out, the service has nothing more to return.
    post.mockResolvedValue({ BoundaryHierarchy: [] });
  });

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
      { tenantId: 'ke', limit: 100, offset: 220 },
    ]);
  });

  it('stops only on an empty reply, after an exactly full page too', async () => {
    post.mockResolvedValueOnce({ BoundaryHierarchy: stubs(0, 100) });

    expect(await boundaryService.getHierarchies('ke')).toHaveLength(100);
    expect(post).toHaveBeenCalledTimes(2);
  });

  // boundary.max.default.limit can sit below the 100 asked for; a page cut
  // short by it is not the last page.
  it('keeps walking when the service clamps each page below the size asked for', async () => {
    const all = [...stubs(0, 219), hierarchy('ADMIN')];
    post.mockImplementation(async (_url: string, body: { BoundaryTypeHierarchySearchCriteria: { limit: number; offset: number } }) => {
      const { limit, offset } = body.BoundaryTypeHierarchySearchCriteria;
      return { BoundaryHierarchy: all.slice(offset, offset + Math.min(limit, 50)) };
    });

    const hierarchies = await boundaryService.getHierarchies('ke');

    expect(hierarchies).toHaveLength(220);
    expect(hierarchies.map((h) => h.hierarchyType)).toContain('ADMIN');
    expect(searchedOffsets().map((c) => c.offset)).toEqual([0, 50, 100, 150, 200, 220]);
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

  it('refuses to return a partial list when the service never sends an empty page', async () => {
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

  // digit-ui and PGR fall back to globalConfigs HIERARCHY_TYPE, not ADMIN.
  it("falls back to the deployment's HIERARCHY_TYPE before ADMIN", () => {
    const bomet = [hierarchy('PW_NEW', 3000), hierarchy('BOMET-Hierarchy', 2000), hierarchy('ADMIN', 1000)];

    expect(pickDefaultHierarchy(bomet, undefined, 'BOMET-Hierarchy')?.hierarchyType).toBe('BOMET-Hierarchy');
    expect(pickDefaultHierarchy(bomet, 'ADMIN', 'BOMET-Hierarchy')?.hierarchyType).toBe('ADMIN');
    expect(pickDefaultHierarchy(listed, undefined, 'BOMET-Hierarchy')?.hierarchyType).toBe('ADMIN');
  });

  it('reads HIERARCHY_TYPE from the served globalConfigs when not given one', () => {
    const bomet = [hierarchy('BOMET-Hierarchy', 2000), hierarchy('ADMIN', 1000)];
    const w = window as unknown as { globalConfigs?: { getConfig: (k: string) => unknown } };
    w.globalConfigs = { getConfig: (k) => (k === 'HIERARCHY_TYPE' ? 'BOMET-Hierarchy' : undefined) };
    try {
      expect(pickDefaultHierarchy(bomet)?.hierarchyType).toBe('BOMET-Hierarchy');
    } finally {
      delete w.globalConfigs;
    }
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

describe('getConfiguredHierarchyType', () => {
  const w = window as unknown as { globalConfigs?: { getConfig: (k: string) => unknown } };
  beforeEach(() => {
    delete w.globalConfigs;
  });

  it("is ADMIN, DIGIT's default, without globalConfigs or with a blank value", () => {
    expect(getConfiguredHierarchyType()).toBe('ADMIN');
    w.globalConfigs = { getConfig: () => '' };
    expect(getConfiguredHierarchyType()).toBe('ADMIN');
    delete w.globalConfigs;
  });

  it('is the HIERARCHY_TYPE the deployment configured', () => {
    w.globalConfigs = { getConfig: (k) => (k === 'HIERARCHY_TYPE' ? 'BOMET-Hierarchy' : undefined) };
    expect(getConfiguredHierarchyType()).toBe('BOMET-Hierarchy');
    delete w.globalConfigs;
  });
});

describe('boundaryService.createBoundaries', () => {
  beforeEach(() => post.mockReset());

  it('writes nothing when two boundaries share a code (#2456)', async () => {
    const row = (code: string, name: string): Boundary =>
      ({ tenantId: 'ke', code, name, boundaryType: 'Emirate', hierarchyType: 'ADMIN', parent: 'COUNTRY_001' }) as Boundary;

    await expect(boundaryService.createBoundaries([row('EMIRATE_001', 'Dubai'), row('EMIRATE_001', 'Abudhabi')])).rejects.toThrow(
      'Each boundary needs its own code. Used more than once: EMIRATE_001',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('reports each write as it goes: an entity, then a relationship, per boundary', async () => {
    const row = (code: string, boundaryType: string, parent?: string): Boundary =>
      ({ tenantId: 'ke', code, name: code, boundaryType, hierarchyType: 'ADMIN', parent }) as Boundary;
    const rows = [row('C1', 'County'), row('W1', 'Ward', 'C1'), row('W2', 'Ward', 'C1')];
    const spies = [
      vi.spyOn(boundaryService, 'createBoundaryEntity').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'waitForEntityVisibility').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'createBoundaryRelationship').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'searchBoundaries').mockResolvedValue(rows),
    ];
    try {
      const progress: [number, number][] = [];
      const result = await boundaryService.createBoundaries(rows, (done, total) => progress.push([done, total]));
      expect(progress).toEqual([1, 2, 3, 4, 5, 6].map((done) => [done, 6]));
      expect(result.success).toHaveLength(3);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it("says why an area never landed: the server's message and code, not only that it's absent (#2795)", async () => {
    vi.useFakeTimers();
    const row = (code: string, boundaryType: string, parent?: string): Boundary =>
      ({ tenantId: 'ke', code, name: code, boundaryType, hierarchyType: 'ADMIN', parent }) as Boundary;
    const rows = [row('C1', 'County'), row('W1', 'Village', 'C1')];
    const refusal = Object.assign(new Error('Boundary type Village is not part of hierarchy ADMIN'), {
      errors: [{ code: 'BOUNDARY_TYPE_ERROR', message: 'Boundary type Village is not part of hierarchy ADMIN' }],
    });
    const spies = [
      vi.spyOn(boundaryService, 'createBoundaryEntity').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'waitForEntityVisibility').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'createBoundaryRelationship').mockImplementation(async (_t, _h, code) => {
        if (code === 'W1') throw refusal;
        return true;
      }),
      vi.spyOn(boundaryService, 'searchBoundaries').mockResolvedValue([rows[0]]),
    ];
    try {
      const pending = boundaryService.createBoundaries(rows);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.success.map((b) => b.code)).toEqual(['C1']);
      expect(result.failed).toEqual([
        { boundary: rows[1], error: 'Boundary type Village is not part of hierarchy ADMIN', code: 'BOUNDARY_TYPE_ERROR' },
      ]);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      vi.useRealTimers();
    }
  });

  it.each(['BOUNDARY_TYPE_ERROR', 'HIERARCHY_ERROR'])('reports a %s refusal straight away: no retry can change it', async (code) => {
    vi.useFakeTimers();
    const row = (c: string, boundaryType: string, parent?: string): Boundary =>
      ({ tenantId: 'ke', code: c, name: c, boundaryType, hierarchyType: 'ADMIN', parent }) as Boundary;
    const rows = [row('C1', 'County'), row('W1', 'Village', 'C1')];
    const refusal = Object.assign(new Error('Refused'), { errors: [{ code, message: 'Refused' }] });
    const writes: string[] = [];
    const spies = [
      vi.spyOn(boundaryService, 'createBoundaryEntity').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'waitForEntityVisibility').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'createBoundaryRelationship').mockImplementation(async (_t, _h, c) => {
        writes.push(c);
        if (c === 'W1') throw refusal;
        return true;
      }),
      vi.spyOn(boundaryService, 'searchBoundaries').mockResolvedValue([rows[0]]),
    ];
    try {
      const start = Date.now();
      const pending = boundaryService.createBoundaries(rows);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(writes.filter((c) => c === 'W1')).toHaveLength(1);
      // No back-off waits before it's reported.
      expect(Date.now() - start).toBe(0);
      expect(result.failed).toEqual([{ boundary: rows[1], error: 'Refused', code }]);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      vi.useRealTimers();
    }
  });

  it("drops an area's refusal once a retry is accepted, so a slow write isn't blamed on it", async () => {
    vi.useFakeTimers();
    const row = (code: string, boundaryType: string, parent?: string): Boundary =>
      ({ tenantId: 'ke', code, name: code, boundaryType, hierarchyType: 'ADMIN', parent }) as Boundary;
    const rows = [row('C1', 'County'), row('W1', 'Ward', 'C1')];
    const notYet = Object.assign(new Error('Parent entity for current boundary relationship does not exist.'), {
      errors: [{ code: 'PARENT_NOT_FOUND', message: 'Parent entity for current boundary relationship does not exist.' }],
    });
    let w1Tries = 0;
    const spies = [
      vi.spyOn(boundaryService, 'createBoundaryEntity').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'waitForEntityVisibility').mockResolvedValue(undefined as never),
      // W1's first write comes before its parent is readable; every retry is accepted.
      vi.spyOn(boundaryService, 'createBoundaryRelationship').mockImplementation(async (_t, _h, code) => {
        if (code === 'W1' && ++w1Tries === 1) throw notYet;
        return true;
      }),
      // ...but it never shows up before the checks end.
      vi.spyOn(boundaryService, 'searchBoundaries').mockResolvedValue([rows[0]]),
    ];
    try {
      const pending = boundaryService.createBoundaries(rows);
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(w1Tries).toBeGreaterThan(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).not.toContain('Parent entity');
      expect(result.failed[0].code).toBeUndefined();
      expect(result.failed[0].unconfirmed).toBe(true);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
      vi.useRealTimers();
    }
  });
});

// #2803: boundary-service answers 200 for a level name its persister can't store (varchar(64)), and
// the persister's retries then hold up every tenant. The client sends names tidied, spelled as the
// hierarchy spells them, and checks the string it sends.
describe('boundaryService level names, as sent', () => {
  beforeEach(() => post.mockReset());
  const row = (code: string, boundaryType: string, parent?: string): Boundary =>
    ({ tenantId: 'ke', code, name: code, boundaryType, hierarchyType: 'ADMIN', parent }) as Boundary;

  it('creates a hierarchy with its level names tidied, parents included', async () => {
    post.mockResolvedValue({ BoundaryHierarchy: [{ hierarchyType: 'ADMIN' }] });
    await boundaryService.createHierarchyFromLevels('ke', 'ADMIN', [' County ', 'Sub  county', 'Munici\u0301pio']);
    expect(post.mock.calls[0][1].BoundaryHierarchy.boundaryHierarchy).toEqual([
      { boundaryType: 'County', parentBoundaryType: undefined, active: true },
      { boundaryType: 'Sub county', parentBoundaryType: 'County', active: true },
      { boundaryType: 'Munic\u00edpio', parentBoundaryType: 'Sub county', active: true },
    ]);
  });

  it('creates no hierarchy whose level names or type can\'t be stored, or whose levels repeat', async () => {
    await expect(boundaryService.createHierarchyFromLevels('ke', 'ADMIN', ['County', 'w'.repeat(65)])).rejects.toThrow(
      /^Level 2 \("w{40}…"\): This name is 65 characters long\. Use 64 characters or fewer\.$/,
    );
    await expect(boundaryService.createHierarchyFromLevels('ke', 'ADMIN', ['Ward', 'ward'])).rejects.toThrow(/already has this name/);
    await expect(boundaryService.createHierarchyFromLevels('ke', 'H'.repeat(65), ['County', 'Ward'])).rejects.toThrow(
      'The hierarchy type is 65 characters long. Use 64 characters or fewer.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('sends each area under its level as the hierarchy spells it, or tidied', async () => {
    const rows = [row('C1', ' County'), row('S1', 'Sub County', 'C1'), row('W1', 'Ward  One', 'S1')];
    const spies = [
      vi.spyOn(boundaryService, 'createBoundaryEntity').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'waitForEntityVisibility').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'createBoundaryRelationship').mockResolvedValue(undefined as never),
      vi.spyOn(boundaryService, 'searchBoundaries').mockResolvedValue(rows),
    ];
    try {
      // Saved before names were tidied: "Sub  County", two spaces. boundary-service matches it exactly.
      await boundaryService.createBoundaries(rows, undefined, ['County', 'Sub  County', 'Ward One']);
      expect(vi.mocked(boundaryService.createBoundaryRelationship).mock.calls.map((call) => [call[2], call[3]])).toEqual([
        ['C1', 'County'],
        ['S1', 'Sub  County'],
        ['W1', 'Ward One'],
      ]);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });

  it('writes nothing under a level the database can\'t store, as sent', async () => {
    const entity = vi.spyOn(boundaryService, 'createBoundaryEntity').mockResolvedValue(undefined as never);
    try {
      // Tidied, the saved level is 64 characters; as the hierarchy spells it (and as it is sent), 66.
      const saved = `Sub   ${'x'.repeat(60)}`;
      await expect(
        boundaryService.createBoundaries([row('C1', 'County'), row('S1', `Sub ${'x'.repeat(60)}`, 'C1')], undefined, ['County', saved]),
      ).rejects.toThrow(/^Nothing was saved\. S1 goes under the level "Sub x{36}…", which is 66 characters long; a level name can have at most 64\.$/);
      expect(entity).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    } finally {
      entity.mockRestore();
    }
  });
});

describe('boundaryService.existingBoundaries', () => {
  // Braces: a function returned from beforeEach runs as cleanup, and mockReset returns the mock.
  beforeEach(() => {
    post.mockReset();
  });

  it('reads each parent from the tree and the en_IN name under either key an upload writes (#2456)', async () => {
    post.mockImplementation(async (url: string) =>
      url.startsWith('/boundary-service/boundary-relationships/_search')
        ? { TenantBoundary: [{ tenantId: 'ke', hierarchyType: 'ADMIN', boundary: [{ code: 'C1', boundaryType: 'Country', children: [{ code: 'E1', boundaryType: 'Emirate' }, { code: 'E2', boundaryType: 'Emirate' }] }] }] }
        : { messages: [{ code: 'C1', message: 'UAE' }, { code: 'KE_ADMIN_E1', message: 'Dubai' }] },
    );

    expect(await boundaryService.existingBoundaries('ke', 'ADMIN')).toEqual([
      { code: 'C1', parent: undefined, name: 'UAE' },
      { code: 'E1', parent: 'C1', name: 'Dubai' },
      { code: 'E2', parent: 'C1', name: undefined },
    ]);
    const localization = post.mock.calls.map(([url]) => String(url)).find((url) => url.startsWith('/localization/'));
    expect(localization).toContain('locale=en_IN');
    expect(localization).toContain('module=rainmaker-boundary-admin');
  });
});

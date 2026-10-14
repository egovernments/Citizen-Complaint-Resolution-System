import { describe, it, expect, vi, beforeEach } from 'vitest';

// The tenant's PGR hierarchy is written once, by the Geography step, and never
// rewritten from there (#2260).
const post = vi.fn();
vi.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    buildRequestInfo: () => ({ apiId: 'test' }),
  },
}));

import { mdmsService } from './mdms';

const SCHEMA = 'CMS-BOUNDARY.HierarchySchema';
const LEVELS = { hierarchy: 'NEWTOWN', highestHierarchy: 'District', lowestHierarchy: 'Ward' };

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ mdms: [{}] });
});

describe('ensureHierarchySchema', () => {
  it('creates the CMS row at the tenant when none is visible', async () => {
    post.mockResolvedValueOnce({ mdms: [] });

    await mdmsService.ensureHierarchySchema('newtown', LEVELS);

    expect(post).toHaveBeenCalledTimes(2);
    const [url, body] = post.mock.calls[1];
    expect(url).toBe(`/mdms-v2/v2/_create/${SCHEMA}`);
    expect(body.Mdms).toMatchObject({ tenantId: 'newtown', schemaCode: SCHEMA, uniqueIdentifier: 'CMS.All' });
    expect(body.Mdms.data).toEqual({ moduleName: 'CMS', department: 'All', ...LEVELS });
  });

  it('leaves an existing CMS row alone, including one inherited from the state', async () => {
    post.mockResolvedValueOnce({
      mdms: [{ tenantId: 'ke', schemaCode: SCHEMA, isActive: true, data: { moduleName: 'CMS', hierarchy: 'ADMIN' } }],
    });

    expect(await mdmsService.ensureHierarchySchema('ke.bomet', LEVELS)).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('ignores HRMS and soft-deleted rows', async () => {
    post.mockResolvedValueOnce({
      mdms: [
        { tenantId: 'newtown', isActive: true, data: { moduleName: 'HRMS', hierarchy: 'ADMIN' } },
        { tenantId: 'newtown', isActive: false, data: { moduleName: 'CMS', hierarchy: 'ADMIN' } },
      ],
    });

    await mdmsService.ensureHierarchySchema('newtown', LEVELS);

    expect(post.mock.calls[1][0]).toContain('_create');
  });

  it('refuses to record the reserved WORKSPACE hierarchy', async () => {
    await expect(
      mdmsService.ensureHierarchySchema('newtown', { ...LEVELS, hierarchy: 'WORKSPACE' }),
    ).rejects.toThrow(/reserved/);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('getRecordedHierarchyType', () => {
  it("names the CMS row's hierarchy, including one inherited from the state", async () => {
    post.mockResolvedValueOnce({
      mdms: [{ tenantId: 'ke', schemaCode: SCHEMA, isActive: true, data: { moduleName: 'CMS', hierarchy: 'ADMIN' } }],
    });

    expect(await mdmsService.getRecordedHierarchyType('ke.bomet')).toBe('ADMIN');
    expect(post.mock.calls[0][1].MdmsCriteria).toMatchObject({ tenantId: 'ke.bomet', schemaCode: SCHEMA });
  });

  it("prefers the city's own row to the one it inherits from the state, whichever comes first", async () => {
    const own = { tenantId: 'ke.bomet', schemaCode: SCHEMA, isActive: true, data: { moduleName: 'CMS', hierarchy: 'BOMET-Hierarchy' } };
    const state = { tenantId: 'ke', schemaCode: SCHEMA, isActive: true, data: { moduleName: 'CMS', hierarchy: 'ADMIN' } };
    post.mockResolvedValueOnce({ mdms: [state, own] }).mockResolvedValueOnce({ mdms: [own, state] });

    expect(await mdmsService.getRecordedHierarchyType('ke.bomet')).toBe('BOMET-Hierarchy');
    expect(await mdmsService.getRecordedHierarchyType('ke.bomet')).toBe('BOMET-Hierarchy');
  });

  it('ignores HRMS and soft-deleted rows', async () => {
    post.mockResolvedValueOnce({
      mdms: [
        { tenantId: 'newtown', isActive: true, data: { moduleName: 'HRMS', hierarchy: 'HRMS_ONLY' } },
        { tenantId: 'newtown', isActive: false, data: { moduleName: 'CMS', hierarchy: 'RETIRED' } },
      ],
    });

    expect(await mdmsService.getRecordedHierarchyType('newtown')).toBeUndefined();
  });
});

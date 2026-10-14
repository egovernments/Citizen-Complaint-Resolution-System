import { beforeEach, describe, expect, it, vi } from 'vitest';

// The real boundary and MDMS services run against a fake HTTP client, routed by endpoint.
const post = vi.fn();
vi.mock('../client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
    buildRequestInfo: () => ({ apiId: 'test' }),
  },
}));

import { loadTenantHierarchies } from './tenantHierarchy';

const HIERARCHY_SEARCH = '/boundary-service/boundary-hierarchy-definition/_search';
const MDMS_SEARCH = '/mdms-v2/v2/_search';

const hierarchy = (hierarchyType: string, createdTime: number) => ({
  tenantId: 'ke',
  hierarchyType,
  boundaryHierarchy: [{ boundaryType: 'County', active: true }],
  auditDetails: { createdBy: 'u', createdTime, lastModifiedBy: 'u', lastModifiedTime: createdTime },
});
const cmsRow = (hierarchyName: string) => ({
  tenantId: 'ke',
  schemaCode: 'CMS-BOUNDARY.HierarchySchema',
  isActive: true,
  data: { moduleName: 'CMS', hierarchy: hierarchyName },
});

/** Serves `listed` from the hierarchy search (or fails it with `listFailure`) and `recorded` from MDMS. */
function serve({ listed = [], listFailure, recorded = [] }: {
  listed?: unknown[];
  listFailure?: Error;
  recorded?: unknown[];
}) {
  post.mockImplementation(async (url: string, body: { BoundaryTypeHierarchySearchCriteria?: { offset: number } }) => {
    if (url === HIERARCHY_SEARCH) {
      if (listFailure) throw listFailure;
      return { BoundaryHierarchy: body.BoundaryTypeHierarchySearchCriteria?.offset ? [] : listed };
    }
    if (url === MDMS_SEARCH) return { mdms: recorded };
    throw new Error(`unexpected request ${url}`);
  });
}

beforeEach(() => {
  post.mockReset();
  delete (window as unknown as { globalConfigs?: unknown }).globalConfigs;
});

describe('loadTenantHierarchies', () => {
  it("starts on the tenant's recorded hierarchy rather than the newest", async () => {
    serve({ listed: [hierarchy('PW_NEW', 3000), hierarchy('ZONES', 2000), hierarchy('ADMIN', 1000)], recorded: [cmsRow('ZONES')] });

    const result = await loadTenantHierarchies('ke');

    expect(result.hierarchyType).toBe('ZONES');
    expect(result.hierarchies.map((h) => h.hierarchyType)).toEqual(['PW_NEW', 'ZONES', 'ADMIN']);
    expect(result.listError).toBeUndefined();
  });

  it('falls back to ADMIN when nothing is recorded', async () => {
    serve({ listed: [hierarchy('PW_NEW', 3000), hierarchy('ADMIN', 1000)] });

    expect((await loadTenantHierarchies('ke')).hierarchyType).toBe('ADMIN');
  });

  it('keeps the recorded hierarchy when the list fails to load, and says why', async () => {
    serve({ listFailure: new Error('502 on page 3'), recorded: [cmsRow('BOMET-Hierarchy')] });

    const result = await loadTenantHierarchies('ke');

    expect(result.hierarchyType).toBe('BOMET-Hierarchy');
    expect(result.hierarchies).toEqual([]);
    expect(result.listError?.message).toBe('502 on page 3');
  });

  it("uses the deployment's HIERARCHY_TYPE when neither the list nor MDMS answers", async () => {
    post.mockRejectedValue(new Error('offline'));
    (window as unknown as { globalConfigs?: { getConfig: (k: string) => unknown } }).globalConfigs = {
      getConfig: (k) => (k === 'HIERARCHY_TYPE' ? 'BOMET-Hierarchy' : undefined),
    };

    const result = await loadTenantHierarchies('ke');

    expect(result.hierarchyType).toBe('BOMET-Hierarchy');
    expect(result.listError?.message).toBe('offline');
  });

  it('has no hierarchy to start on when the tenant has none, whatever MDMS records', async () => {
    serve({ listed: [], recorded: [cmsRow('ADMIN')] });

    const result = await loadTenantHierarchies('ke');

    expect(result.hierarchyType).toBeUndefined();
    expect(result.listError).toBeUndefined();
  });
});

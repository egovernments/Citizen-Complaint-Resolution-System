import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boundaryService, localizationService, mdmsService } from '@/api';
import { listMasters } from '../departments/mastersApi';
import { loadEmployeeOptions } from './employeesApi';

vi.mock('@/api', () => ({
  mdmsService: { getRoles: vi.fn(), getMobileValidation: vi.fn() },
  boundaryService: { getHierarchies: vi.fn(), searchBoundaries: vi.fn() },
  localizationService: { searchMessages: vi.fn() },
  hrmsService: {},
}));
vi.mock('../departments/mastersApi', () => ({
  listMasters: vi.fn(),
  recordName: (record: { uniqueIdentifier: string }) => record.uniqueIdentifier,
  recordDepartments: () => [],
}));
vi.mock('../labelLocales', () => ({ readLocales: () => ['en_IN'] }));

const hierarchy = (hierarchyType: string, levels: string[]) => ({
  hierarchyType,
  boundaryHierarchy: levels.map((boundaryType) => ({ boundaryType })),
});

/** A promise the test settles by hand, to hold a load in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(mdmsService.getRoles).mockResolvedValue([]);
  vi.mocked(mdmsService.getMobileValidation).mockResolvedValue(null);
  vi.mocked(localizationService.searchMessages).mockResolvedValue([]);
});

describe('loadEmployeeOptions', () => {
  it('loads every hierarchy’s boundaries at once, without waiting on the departments', async () => {
    const departments = deferred<never[]>();
    vi.mocked(listMasters).mockReturnValue(departments.promise);
    vi.mocked(boundaryService.getHierarchies).mockResolvedValue([
      hierarchy('ADMIN', ['County', 'Ward']),
      hierarchy('REVENUE', ['Zone']),
    ] as never);
    const admin = deferred<unknown[]>();
    const revenue = deferred<unknown[]>();
    vi.mocked(boundaryService.searchBoundaries).mockImplementation(((_tenant: string, { hierarchyType }: { hierarchyType: string }) =>
      hierarchyType === 'ADMIN' ? admin.promise : revenue.promise) as never);

    const loading = loadEmployeeOptions('acme');
    // Both hierarchies are being searched while the departments are still loading.
    await vi.waitFor(() => expect(boundaryService.searchBoundaries).toHaveBeenCalledTimes(2));

    revenue.resolve([{ code: 'Z1', name: 'Zone 1', boundaryType: 'Zone' }]);
    admin.resolve([
      { code: 'W2', name: 'Ward B', boundaryType: 'Ward' },
      { code: 'C1', name: 'County', boundaryType: 'County' },
      { code: 'W1', name: 'Ward A', boundaryType: 'Ward' },
    ]);
    departments.resolve([]);

    const { boundaries } = await loading;
    // Shallowest level first, then by name, across hierarchies.
    expect(boundaries.map((boundary) => `${boundary.hierarchyType}:${boundary.code}:${boundary.depth}`)).toEqual([
      'ADMIN:C1:0',
      'REVENUE:Z1:0',
      'ADMIN:W1:1',
      'ADMIN:W2:1',
    ]);
  });

  it('names a boundary from its label when the search has no name', async () => {
    vi.mocked(listMasters).mockResolvedValue([]);
    vi.mocked(boundaryService.getHierarchies).mockResolvedValue([hierarchy('ADMIN', ['Ward'])] as never);
    vi.mocked(boundaryService.searchBoundaries).mockResolvedValue([{ code: 'W1', boundaryType: 'Ward' }] as never);
    vi.mocked(localizationService.searchMessages).mockResolvedValue([{ code: 'W1', message: 'Kilimani' }] as never);

    const { boundaries } = await loadEmployeeOptions('acme');
    expect(boundaries.map((boundary) => boundary.name)).toEqual(['Kilimani']);
    expect(localizationService.searchMessages).toHaveBeenCalledWith('acme', 'en_IN', 'rainmaker-boundary-admin');
  });

  it('still loads with no hierarchies when the hierarchy search fails', async () => {
    vi.mocked(listMasters).mockResolvedValue([]);
    vi.mocked(boundaryService.getHierarchies).mockRejectedValue(new Error('down'));

    const { boundaries } = await loadEmployeeOptions('acme');
    expect(boundaries).toEqual([]);
    expect(boundaryService.searchBoundaries).not.toHaveBeenCalled();
  });
});

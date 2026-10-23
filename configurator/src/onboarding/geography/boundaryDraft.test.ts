import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { boundaryService, localizationService, mdmsService } from '@/api';
import type { Boundary } from '@/api/types';
import {
  addSelection,
  areasInside,
  listHierarchy,
  removeSelection,
  saveBoundaryDraft,
  setBoundaryDraft,
  useBoundaryDraft,
  type BoundaryDraft,
  type NewSelection,
} from './boundaryDraft';

vi.mock('@/api', () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiClient: { getAuth: () => ({ token: null }) },
  boundaryService: {
    createHierarchyFromLevels: vi.fn(),
    getHierarchies: vi.fn(),
    createBoundaries: vi.fn(),
  },
  mdmsService: { ensureHierarchySchema: vi.fn(async () => undefined), upsertMapConfig: vi.fn(async () => undefined) },
  localizationService: {
    uploadBoundaryLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    uploadHierarchyLevelLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    cacheBust: vi.fn(async () => undefined),
  },
}));
vi.mock('../labelLocales', () => ({ labelLocales: vi.fn(async () => ['en_IN']) }));
vi.mock('../telemetry', () => ({ trackImport: vi.fn(), reportStepError: vi.fn() }));

const createHierarchy = vi.mocked(boundaryService.createHierarchyFromLevels);
const getHierarchies = vi.mocked(boundaryService.getHierarchies);
const createBoundaries = vi.mocked(boundaryService.createBoundaries);
const ensureSchema = vi.mocked(mdmsService.ensureHierarchySchema);
const boundaryLabels = vi.mocked(localizationService.uploadBoundaryLocalizations);

const TENANT = 'ke.nairobi';
const area = (code: string, boundaryType: string, parent?: string): Boundary => ({
  tenantId: TENANT,
  code,
  name: code,
  boundaryType,
  parent,
  hierarchyType: 'ADMIN',
});
const NAIROBI = [area('NBI', 'County'), area('NBI_W1', 'Ward', 'NBI'), area('NBI_W2', 'Ward', 'NBI')];
const MOMBASA = [area('MSA', 'County'), area('MSA_W1', 'Ward', 'MSA')];

const selection = (boundaries: Boundary[], over: Partial<NewSelection> = {}): NewSelection => ({
  source: 'osm',
  method: 'fetch',
  hierarchyType: 'ADMIN',
  levels: ['County', 'Ward'],
  hierarchyExists: false,
  boundaries,
  unnamed: [],
  alreadyThere: 0,
  sourceText: 'the official boundaries for Kenya (OCHA COD-AB)',
  skipped: 0,
  attribution: null,
  preconfigured: null,
  resume: {
    kind: 'osm',
    searchTerm: 'Nairobi',
    pickedSuggestion: null,
    turbopassSource: 'official',
    fetchedPlace: { id: 'p1', name: 'Nairobi', label: 'Nairobi, Kenya', country: 'Kenya' },
    adminLevels: [],
    attribution: null,
    officialSet: null,
  },
  ...over,
});

const current = (): BoundaryDraft => renderHook(() => useBoundaryDraft(TENANT)).result.current as BoundaryDraft;
const codes = () => current().selections.flatMap((s) => s.boundaries.map((b) => b.code));

beforeEach(() => {
  vi.clearAllMocks();
  act(() => setBoundaryDraft(TENANT, null));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  createHierarchy.mockResolvedValue({ tenantId: TENANT, hierarchyType: 'ADMIN', boundaryHierarchy: [] });
  createBoundaries.mockImplementation(async (boundaries) => ({ success: boundaries, failed: [] }));
});

describe('the unsaved list', () => {
  it('keeps adding selections, one list per workspace', () => {
    const other = renderHook(() => useBoundaryDraft('mz.maputo'));
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
      addSelection(TENANT, selection(MOMBASA, { source: 'excel', method: 'excel' }));
    });
    expect(codes()).toEqual(['NBI', 'NBI_W1', 'NBI_W2', 'MSA', 'MSA_W1']);
    expect(other.result.current).toBeNull();
  });

  it('leaves out codes already in the list', () => {
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
    });
    let result;
    act(() => {
      result = addSelection(TENANT, selection([...NAIROBI.slice(0, 1), ...MOMBASA]));
    });
    expect(result).toEqual({ added: 2, duplicates: 1, error: null });
    expect(codes()).toEqual(['NBI', 'NBI_W1', 'NBI_W2', 'MSA', 'MSA_W1']);
  });

  it('refuses a selection whose levels are named differently, and keeps the list as it was', () => {
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
    });
    const result = addSelection(TENANT, selection(MOMBASA, { levels: ['Province', 'Ward'] }));
    expect(result.error).toBe('Your list uses the levels County → Ward. Name these levels the same way, starting from the top, to add them to it.');
    expect(codes()).toHaveLength(3);
    expect(addSelection(TENANT, selection(MOMBASA, { hierarchyType: 'REVENUE' })).error).toMatch(/"ADMIN" hierarchy/);
  });

  it('takes levels named the same way from the top, and the hierarchy grows to the deepest', () => {
    act(() => {
      addSelection(TENANT, selection([area('NBI', 'County')], { levels: ['County'] }));
      addSelection(TENANT, selection([area('MSA', 'County'), area('MSA_S1', 'Sub-county', 'MSA')], { levels: ['County', 'Sub-county'] }));
    });
    expect(listHierarchy(current())?.levels).toEqual(['County', 'Sub-county']);
  });

  it('puts an edited selection in place of the one it reopened', () => {
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
      addSelection(TENANT, selection(MOMBASA));
    });
    const reopened = current().selections[0];
    act(() => {
      addSelection(TENANT, selection(NAIROBI.slice(0, 2)), undefined, reopened.id);
    });
    expect(codes()).toEqual(['NBI', 'NBI_W1', 'MSA', 'MSA_W1']);
    expect(current().selections[0].id).toBe(reopened.id);
  });

  it("removes a whole selection, unless another selection's areas sit inside it", () => {
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
      // A sheet adding a ward to the fetched county: its parent is in the first selection.
      addSelection(TENANT, selection([area('NBI_W9', 'Ward', 'NBI')], { source: 'excel', method: 'excel' }));
      addSelection(TENANT, selection(MOMBASA));
    });
    const [nairobi, sheet, mombasa] = current().selections;
    expect(areasInside(current(), nairobi.id)).toBe(1);
    expect(removeSelection(TENANT, nairobi.id)).toBe(false);
    act(() => {
      expect(removeSelection(TENANT, mombasa.id)).toBe(true);
      expect(removeSelection(TENANT, sheet.id)).toBe(true);
      expect(removeSelection(TENANT, nairobi.id)).toBe(true);
    });
    expect(renderHook(() => useBoundaryDraft(TENANT)).result.current).toBeNull();
  });
});

describe('saveBoundaryDraft', () => {
  const twoCounties = (): BoundaryDraft => {
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
      addSelection(TENANT, selection(MOMBASA, { source: 'excel', method: 'excel', unnamed: [{ code: 'OLD', name: 'Old ward' }] }));
    });
    return current();
  };

  it('writes the hierarchy once, then every area in the list, then the hierarchy record', async () => {
    const result = await saveBoundaryDraft(TENANT, twoCounties());
    expect(createHierarchy).toHaveBeenCalledOnce();
    expect(createHierarchy).toHaveBeenCalledWith(TENANT, 'ADMIN', ['County', 'Ward']);
    expect(createBoundaries).toHaveBeenCalledWith([...NAIROBI, ...MOMBASA], expect.any(Function));
    expect(ensureSchema).toHaveBeenCalledWith(TENANT, { hierarchy: 'ADMIN', highestHierarchy: 'County', lowestHierarchy: 'Ward' });
    expect(boundaryLabels.mock.calls[0][1].map((b) => b.code)).toEqual(['NBI', 'NBI_W1', 'NBI_W2', 'MSA', 'MSA_W1', 'OLD']);
    expect(result).toEqual({ created: [...NAIROBI, ...MOMBASA], failed: [], schemaError: null });
  });

  it('reports progress that only rises, ending at 100', async () => {
    createBoundaries.mockImplementation(async (boundaries, onProgress) => {
      for (let done = 1; done <= boundaries.length * 2; done++) onProgress?.(done, boundaries.length * 2);
      return { success: boundaries, failed: [] };
    });
    const progress: number[] = [];
    await saveBoundaryDraft(TENANT, twoCounties(), undefined, (percent) => progress.push(percent));
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((percent, i) => i === 0 || percent >= progress[i - 1])).toBe(true);
    expect(progress.length).toBeGreaterThan(10);
  });

  it('nothing is written before it is called', () => {
    twoCounties();
    expect(createHierarchy).not.toHaveBeenCalled();
    expect(createBoundaries).not.toHaveBeenCalled();
  });

  it('uses a hierarchy already defined with the same levels', async () => {
    createHierarchy.mockRejectedValue(new Error('Hierarchy definition already exists'));
    getHierarchies.mockResolvedValue([
      { tenantId: TENANT, hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'County', active: true }, { boundaryType: 'Ward', active: true }] },
    ]);
    await saveBoundaryDraft(TENANT, twoCounties());
    expect(createBoundaries).toHaveBeenCalledOnce();
  });

  it('writes no area when the hierarchy already there has other levels', async () => {
    createHierarchy.mockRejectedValue(new Error('DUPLICATE_RECORD'));
    getHierarchies.mockResolvedValue([
      { tenantId: TENANT, hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'Province', active: true }, { boundaryType: 'Ward', active: true }] },
    ]);
    await expect(saveBoundaryDraft(TENANT, twoCounties())).rejects.toThrow(/\[Province → Ward\], which do not match your mapped levels \[County → Ward\]/);
    expect(createBoundaries).not.toHaveBeenCalled();
  });

  it('writes nothing alongside the areas when none of them landed', async () => {
    createBoundaries.mockImplementation(async (boundaries) => ({ success: [], failed: boundaries.map((boundary) => ({ boundary, error: 'refused' })) }));
    const result = await saveBoundaryDraft(TENANT, twoCounties());
    expect(result.created).toEqual([]);
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(boundaryLabels).not.toHaveBeenCalled();
  });
});

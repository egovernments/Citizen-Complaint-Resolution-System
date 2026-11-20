import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { apiClient, boundaryService, localizationService, mdmsService } from '@/api';
import { runSignOutHooks } from '@/lib/signOutHooks';
import type { Boundary } from '@/api/types';
import {
  addSelection,
  areasInside,
  keepUnsaved,
  listHierarchy,
  retryHierarchyRecord,
  saveProgressOf,
  usePendingHierarchyRecord,
  removeSelection,
  restoreLeftovers,
  saveBoundaryDraft,
  setBoundaryDraft,
  useBoundaryDraft,
  useLeftoversNotKept,
  useSaveLeftovers,
  type BoundaryDraft,
  type NewSelection,
} from './boundaryDraft';

vi.mock('@/api', () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiClient: { getAuth: vi.fn(() => ({ token: null })) },
  boundaryService: {
    createHierarchyFromLevels: vi.fn(),
    getHierarchies: vi.fn(),
    createBoundaries: vi.fn(),
  },
  mdmsService: {
    ensureHierarchySchema: vi.fn(async () => undefined),
    upsertMapConfig: vi.fn(async () => undefined),
    searchRecords: vi.fn(async () => []),
  },
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
  window.localStorage.clear();
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
    expect(result).toEqual({ added: 2, alreadySaved: 0, duplicates: 1, error: null });
    expect(codes()).toEqual(['NBI', 'NBI_W1', 'NBI_W2', 'MSA', 'MSA_W1']);
  });

  it('gives a different area with a taken code the next free one, and moves its children with it', () => {
    act(() => {
      addSelection(TENANT, selection([area('NBI', 'County'), area('CENTRAL', 'Ward', 'NBI')]));
    });
    let result;
    act(() => {
      // Another county's "Central": same code, other parent.
      result = addSelection(TENANT, selection([area('MSA', 'County'), area('CENTRAL', 'Ward', 'MSA')]));
    });
    expect(result).toEqual({ added: 2, alreadySaved: 0, duplicates: 0, error: null });
    const second = current().selections[1].boundaries;
    expect(second.map((b) => [b.code, b.parent])).toEqual([['MSA', undefined], ['CENTRAL_2', 'MSA']]);
  });

  it('follows a renamed parent down to its children', () => {
    act(() => {
      addSelection(TENANT, selection([area('NBI', 'County'), area('CENTRAL', 'Ward', 'NBI')], { levels: ['County', 'Ward'] }));
    });
    act(() => {
      // A different county that happens to be coded NBI too, with a ward of its own.
      addSelection(TENANT, selection([{ ...area('NBI', 'County'), name: 'Nairobi North' }, area('NBI_W7', 'Ward', 'NBI')]));
    });
    expect(current().selections[1].boundaries.map((b) => [b.code, b.parent])).toEqual([['NBI_2', undefined], ['NBI_W7', 'NBI_2']]);
  });

  it('checks a fetch against the areas already saved in the hierarchy', () => {
    let result;
    act(() => {
      result = addSelection(
        TENANT,
        selection([area('NBI', 'County'), area('CENTRAL', 'Ward', 'NBI')]),
        undefined,
        undefined,
        // Saved earlier: Nairobi itself, and two other counties' Centrals.
        [{ code: 'NBI', name: 'NBI' }, { code: 'CENTRAL', name: 'Central', parent: 'MSA' }, { code: 'CENTRAL_2', name: 'Central', parent: 'KSM' }],
      );
    });
    expect(result).toEqual({ added: 1, alreadySaved: 1, duplicates: 0, error: null });
    // Nairobi is left out as saved; its Central skips the saved CENTRAL_2 too.
    expect(current().selections[0].boundaries.map((b) => [b.code, b.parent])).toEqual([['CENTRAL_3', 'NBI']]);
  });

  it('refuses a sheet whose codes are taken by other areas: its codes are the operator\'s', () => {
    act(() => {
      addSelection(TENANT, selection([area('NBI', 'County'), area('CENTRAL', 'Ward', 'NBI')]));
    });
    const result = addSelection(TENANT, selection([area('MSA', 'County'), area('CENTRAL', 'Ward', 'MSA')], { source: 'excel', method: 'excel' }));
    expect(result.error).toBe('These codes are already in your list for other areas: CENTRAL. Give them their own codes in the sheet.');
    expect(current().selections).toHaveLength(1);
  });

  it('takes a sheet that only names areas already saved', () => {
    let result;
    act(() => {
      result = addSelection(TENANT, selection([], { source: 'excel', method: 'excel', unnamed: [{ code: 'OLD', name: 'Old ward' }] }));
    });
    expect(result).toEqual({ added: 0, alreadySaved: 0, duplicates: 0, error: null });
    expect(current().selections[0].unnamed).toEqual([{ code: 'OLD', name: 'Old ward' }]);
  });

  it('keeps what a save left behind, now in a hierarchy that exists', () => {
    act(() => {
      addSelection(TENANT, selection(NAIROBI, { unnamed: [{ code: 'OLD', name: 'Old ward' }] }));
      addSelection(TENANT, selection(MOMBASA));
    });
    act(() => keepUnsaved(TENANT, [...NAIROBI, MOMBASA[0]]));
    expect(current().selections).toHaveLength(1);
    expect(current().selections[0].boundaries.map((b) => b.code)).toEqual(['MSA_W1']);
    expect(current().selections[0].hierarchyExists).toBe(true);
    expect(current().selections[0].unnamed).toEqual([]);
    act(() => keepUnsaved(TENANT, MOMBASA));
    expect(renderHook(() => useBoundaryDraft(TENANT)).result.current).toBeNull();
  });

  it('gives what a save left behind the hierarchy\'s levels, not its own shorter ones', () => {
    act(() => {
      addSelection(TENANT, selection([area('NBI', 'County'), area('NBI_S1', 'Sub-county', 'NBI')], { levels: ['County', 'Sub-county'] }));
      addSelection(TENANT, selection([area('MSA', 'County')], { levels: ['County', 'Sub-county', 'Ward'] }));
    });
    act(() => keepUnsaved(TENANT, [area('MSA', 'County')]));
    expect(current().selections[0].levels).toEqual(['County', 'Sub-county', 'Ward']);
    expect(listHierarchy(current())?.levels).toEqual(['County', 'Sub-county', 'Ward']);
  });

  it('takes an area saved under the same code and parent as already saved, whatever its label now says', () => {
    let result;
    act(() => {
      result = addSelection(TENANT, selection([area('NBI', 'County'), area('NBI_W1', 'Ward', 'NBI')]), undefined, undefined, [
        { code: 'NBI', name: 'Nairobi City County' },
      ]);
    });
    expect(result).toEqual({ added: 1, alreadySaved: 1, duplicates: 0, error: null });
    expect(current().selections[0].boundaries.map((b) => [b.code, b.parent])).toEqual([['NBI_W1', 'NBI']]);
  });

  it('says so when an Edit brings nothing new, and leaves the item as it was', () => {
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
      addSelection(TENANT, selection(MOMBASA));
    });
    const reopened = current().selections[1];
    const result = addSelection(TENANT, selection([NAIROBI[0]]), undefined, reopened.id);
    expect(result.error).toBe('Everything in this selection is already in your list or saved, so nothing changed.');
    expect(current().selections[1].boundaries).toEqual(MOMBASA);
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

describe('what a save left unsaved, across a reload (#2795)', () => {
  const refused = { boundary: NAIROBI[2], error: 'Boundary type is not in the hierarchy', code: 'BOUNDARY_TYPE_ERROR' };
  const sheet = (boundaries: Boundary[]) =>
    selection(boundaries, {
      source: 'excel',
      method: 'excel',
      resume: {
        kind: 'excel',
        hierarchy: { tenantId: TENANT, hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'County', active: true }, { boundaryType: 'Ward', active: true }] },
        file: new File(['rows'], 'wards.xlsx'),
        parsed: [],
        valid: [],
        invalid: [],
        polygonFile: null,
        polygonSidecar: null,
      },
    });
  /** A reload: this tab's memory goes, the browser's storage stays. */
  const reload = () => {
    const kept = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i) as string).map(
      (key) => [key, window.localStorage.getItem(key) as string] as const,
    );
    act(() => setBoundaryDraft(TENANT, null));
    for (const [key, value] of kept) window.localStorage.setItem(key, value);
  };
  const restore = (hierarchyTypes = ['ADMIN']) => {
    let failures: ReturnType<typeof restoreLeftovers> = null;
    act(() => {
      failures = restoreLeftovers(TENANT, hierarchyTypes);
    });
    return failures;
  };

  it('brings them back with the save’s reasons, into the hierarchy the server has', () => {
    act(() => void addSelection(TENANT, sheet(NAIROBI)));
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
    reload();
    expect(renderHook(() => useBoundaryDraft(TENANT)).result.current).toBeNull();
    expect(restore(['OTHER'])).toBeNull();
    expect(restore()).toEqual([refused]);
    expect(codes()).toEqual(['NBI_W2']);
    const [back] = current().selections;
    expect(back.hierarchyExists).toBe(true);
    // The upload is named as before; only its name was kept.
    expect(back.resume.kind === 'excel' && back.resume.file?.name).toBe('wards.xlsx');
    // A list already there is left alone.
    expect(restore()).toBeNull();
  });

  it('reads them back without writing them again', () => {
    act(() => void addSelection(TENANT, sheet(NAIROBI)));
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
    reload();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    try {
      expect(restore()).toEqual([refused]);
      expect(writes).not.toHaveBeenCalled();
    } finally {
      writes.mockRestore();
    }
    // The next change is still written.
    act(() => keepUnsaved(TENANT, [NAIROBI[2]]));
    expect(window.localStorage.length).toBe(0);
  });

  it('forgets them once they are all saved, or removed', () => {
    act(() => void addSelection(TENANT, selection(NAIROBI)));
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
    act(() => keepUnsaved(TENANT, [NAIROBI[2]]));
    reload();
    expect(restore()).toBeNull();

    act(() => void addSelection(TENANT, selection(NAIROBI)));
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
    const { id } = current().selections[0];
    act(() => void removeSelection(TENANT, id));
    reload();
    expect(restore()).toBeNull();
  });

  it('remembers which areas the server never confirmed, rather than refused', () => {
    const unconfirmed = { boundary: NAIROBI[2], error: 'Relationship still absent after verify retries', unconfirmed: true };
    act(() => void addSelection(TENANT, sheet(NAIROBI)));
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [unconfirmed]));
    reload();
    expect(restore()).toEqual([unconfirmed]);
  });

  it('keeps an edited list, without the reasons the page no longer shows', () => {
    act(() => void addSelection(TENANT, sheet(NAIROBI)));
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
    const { id } = current().selections[0];
    act(() => void addSelection(TENANT, sheet([area('NBI_W2', 'Ward', 'NBI')]), undefined, id));
    reload();
    expect(restore()).toEqual([]);
    expect(codes()).toEqual(['NBI_W2']);
  });

  it('keeps a list nothing was saved from in this tab only', () => {
    act(() => void addSelection(TENANT, selection(NAIROBI)));
    expect(window.localStorage.length).toBe(0);
  });

  it('stores the areas without a fetch’s outlines when the whole list doesn’t fit', () => {
    const fetched = selection(NAIROBI);
    if (fetched.resume.kind === 'osm') fetched.resume.adminLevels = [{ level: 6, features: [{}], examples: [], mappedName: 'Ward', selected: true }];
    act(() => void addSelection(TENANT, fetched));
    const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
    full.mockRestore();
    reload();
    expect(restore()).toEqual([refused]);
    expect(codes()).toEqual(['NBI_W2']);
    const { resume } = current().selections[0];
    expect(resume.kind === 'osm' && resume.adminLevels).toEqual([]);
  });

  describe('on a browser more than one admin signs in to', () => {
    const signedIn = (uuid: string) =>
      vi.mocked(apiClient.getAuth).mockReturnValue({ token: 't', user: { uuid, userName: uuid, name: uuid, tenantId: TENANT }, tenantId: TENANT });
    afterEach(() => {
      vi.mocked(apiClient.getAuth).mockReturnValue({ token: null } as never);
    });

    it('keeps what a save left out for the admin whose save it was', () => {
      signedIn('admin-a');
      act(() => void addSelection(TENANT, sheet(NAIROBI)));
      act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
      expect(Object.keys(window.localStorage)).toEqual([`ccrs-geography-unsaved:${TENANT}:ADMIN:admin-a`]);
      reload();
      signedIn('admin-b');
      expect(restore()).toBeNull();
      signedIn('admin-a');
      expect(restore()).toEqual([refused]);
    });

    it('forgets this tab’s list on sign-out, and leaves the stored one to its admin', () => {
      signedIn('admin-a');
      act(() => void addSelection(TENANT, sheet(NAIROBI)));
      act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
      act(() => runSignOutHooks());
      expect(renderHook(() => useBoundaryDraft(TENANT)).result.current).toBeNull();
      expect(renderHook(() => useSaveLeftovers(TENANT)).result.current).toBeNull();
      expect(Object.keys(window.localStorage)).toEqual([`ccrs-geography-unsaved:${TENANT}:ADMIN:admin-a`]);
    });
  });

  describe('a list too big for this site’s storage', () => {
    const OUTLINE = { type: 'Polygon' as const, coordinates: [[[36.8, -1.3], [36.9, -1.3], [36.9, -1.2], [36.8, -1.3]]] };
    const outlined = NAIROBI.map((b) => ({ ...b, geometry: OUTLINE }));
    const bigSheet = () => {
      const s = sheet(outlined);
      if (s.resume.kind === 'excel') s.resume.parsed = s.resume.valid = outlined.map((b, i) => ({ row: i + 2, code: b.code, name: b.name, boundaryType: b.boundaryType, parentCode: b.parent }));
      return s;
    };
    const stored = () => JSON.parse(window.localStorage.getItem(`ccrs-geography-unsaved:${TENANT}:ADMIN`) as string);
    const notKept = () => renderHook(() => useLeftoversNotKept(TENANT)).result.current;

    it('never stores what only Edit reads: Edit is off for a save’s leftovers', () => {
      act(() => void addSelection(TENANT, bigSheet()));
      act(() => keepUnsaved(TENANT, outlined.slice(0, 2), [refused]));
      const [kept] = stored().selections;
      expect(kept.resume.parsed).toEqual([]);
      expect(kept.resume.valid).toEqual([]);
      // Retry writes each area's outline, so that stays.
      expect(kept.boundaries[0].geometry).toEqual(OUTLINE);
      expect(notKept()).toBe(false);
    });

    it('keeps the areas without their outlines when even that doesn’t fit, and says so', () => {
      act(() => void addSelection(TENANT, bigSheet()));
      const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      act(() => keepUnsaved(TENANT, outlined.slice(0, 2), [refused]));
      full.mockRestore();
      // NBI_W2 as listed, with no outline.
      expect(stored().selections[0].boundaries).toEqual([NAIROBI[2]]);
      expect(notKept()).toBe(true);
      reload();
      expect(restore()).toEqual([refused]);
      expect(codes()).toEqual(['NBI_W2']);
    });

    it('says so when nothing could be kept', () => {
      act(() => void addSelection(TENANT, bigSheet()));
      const full = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
      act(() => keepUnsaved(TENANT, outlined.slice(0, 2), [refused]));
      full.mockRestore();
      expect(notKept()).toBe(true);
      // Once they're saved there's nothing left to warn about.
      act(() => keepUnsaved(TENANT, [outlined[2]]));
      expect(notKept()).toBe(false);
    });
  });

  it('carries on without storage, and ignores what it can’t read', () => {
    act(() => void addSelection(TENANT, selection(NAIROBI)));
    const broken = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    act(() => keepUnsaved(TENANT, NAIROBI.slice(0, 2), [refused]));
    broken.mockRestore();
    expect(codes()).toEqual(['NBI_W2']);
    act(() => setBoundaryDraft(TENANT, null));
    window.localStorage.setItem(`ccrs-geography-unsaved:${TENANT}:ADMIN`, '{not json');
    expect(restore()).toBeNull();
    window.localStorage.setItem(`ccrs-geography-unsaved:${TENANT}:ADMIN`, JSON.stringify({ selections: [], failed: [] }));
    expect(restore()).toBeNull();
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

  it('shows its progress while it runs, rising, and none once it\'s done', async () => {
    const progress: (number | null)[] = [];
    createBoundaries.mockImplementation(async (boundaries, onProgress) => {
      progress.push(saveProgressOf(TENANT));
      for (let done = 1; done <= boundaries.length * 2; done++) {
        onProgress?.(done, boundaries.length * 2);
        progress.push(saveProgressOf(TENANT));
      }
      return { success: boundaries, failed: [] };
    });
    await saveBoundaryDraft(TENANT, twoCounties());
    expect(progress[0]).toBe(2);
    expect(progress.at(-1)).toBe(90);
    expect(progress.every((percent, i) => i === 0 || (percent ?? 0) >= (progress[i - 1] ?? 0))).toBe(true);
    expect(saveProgressOf(TENANT)).toBeNull();
  });

  it('keeps a hierarchy record that didn\'t save, and writes it on retry', async () => {
    ensureSchema.mockRejectedValueOnce(new Error('MDMS down'));
    const pending = renderHook(() => usePendingHierarchyRecord(TENANT));
    const result = await saveBoundaryDraft(TENANT, twoCounties());
    expect(result.schemaError).toMatch(/MDMS down/);
    pending.rerender();
    expect(pending.result.current).toBe(true);
    ensureSchema.mockRejectedValueOnce(new Error('still down'));
    expect(await retryHierarchyRecord(TENANT)).toBe("The hierarchy record didn't save: still down Save and continue tries it again.");
    expect(await retryHierarchyRecord(TENANT)).toBeNull();
    pending.rerender();
    expect(pending.result.current).toBe(false);
    expect(ensureSchema).toHaveBeenLastCalledWith(TENANT, { hierarchy: 'ADMIN', highestHierarchy: 'County', lowestHierarchy: 'Ward' });
  });

  it('keeps the map covering areas saved before when it saves more', async () => {
    const upsertMap = vi.mocked(mdmsService.upsertMapConfig);
    const searchRecords = vi.mocked(mdmsService.searchRecords);
    searchRecords.mockResolvedValue([
      { tenantId: TENANT, isActive: true, data: { searchViewbox: { minLon: 30, minLat: -2, maxLon: 32, maxLat: 0 } } } as never,
    ]);
    act(() => {
      addSelection(TENANT, selection([{ ...area('MSA', 'County'), geometry: { type: 'Polygon', coordinates: [[[39, -5], [40, -5], [40, -4], [39, -4], [39, -5]]] } }]));
    });
    await saveBoundaryDraft(TENANT, current(), undefined, true);
    const box = (upsertMap.mock.calls[0][1] as { searchViewbox: { minLon: number; maxLon: number } }).searchViewbox;
    expect(box.minLon).toBe(30);
    expect(box.maxLon).toBeGreaterThan(40);
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

  it('uploads the names of a names-only sheet, though it creates nothing', async () => {
    act(() => {
      addSelection(TENANT, selection([], { source: 'excel', method: 'excel', hierarchyExists: true, unnamed: [{ code: 'OLD', name: 'Old ward' }] }));
    });
    await saveBoundaryDraft(TENANT, current());
    expect(createHierarchy).not.toHaveBeenCalled();
    expect(boundaryLabels.mock.calls[0][1]).toEqual([{ code: 'OLD', name: 'Old ward' }]);
  });

  it('writes nothing alongside the areas when none of them landed', async () => {
    createBoundaries.mockImplementation(async (boundaries) => ({ success: [], failed: boundaries.map((boundary) => ({ boundary, error: 'refused' })) }));
    act(() => {
      addSelection(TENANT, selection(NAIROBI));
    });
    const result = await saveBoundaryDraft(TENANT, current());
    expect(result.created).toEqual([]);
    expect(ensureSchema).not.toHaveBeenCalled();
    expect(boundaryLabels).not.toHaveBeenCalled();
  });
});

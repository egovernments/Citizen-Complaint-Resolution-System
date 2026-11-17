import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundaryService, mdmsService } from '@/api';
import type { Boundary } from '@/api/types';
import GeographyStep from './GeographyStep';
import { addSelection, retryHierarchyRecord, setBoundaryDraft, type NewSelection } from './boundaryDraft';

const flags = vi.hoisted(() => ({ multiple: false }));
vi.mock('@/config/featureFlags', () => ({
  get GEOGRAPHY_MULTIPLE_SELECTIONS_ENABLED() {
    return flags.multiple;
  },
}));

const app = { state: { tenant: 'ke', targetTenant: 'ke', completedPhases: [] as number[] }, completePhase: vi.fn(async () => true), addUndo: vi.fn() };
vi.mock('@/App', () => ({ useApp: () => app }));

// What the server holds: hierarchies, and the areas in them.
const server = vi.hoisted(() => ({ hierarchies: [] as object[], areas: [] as object[], recorded: undefined as string | undefined }));
vi.mock('@/api', () => ({
  ApiClientError: class ApiClientError extends Error {},
  apiClient: { getAuth: () => ({ token: null }) },
  boundaryService: {
    getHierarchies: vi.fn(async () => server.hierarchies),
    searchBoundaries: vi.fn(async () => server.areas),
    createHierarchyFromLevels: vi.fn(async () => ({})),
    createBoundaries: vi.fn(),
    existingBoundaries: vi.fn(async () => []),
  },
  mdmsService: {
    ensureHierarchySchema: vi.fn(async () => null),
    upsertMapConfig: vi.fn(async () => undefined),
    searchRecords: vi.fn(async () => []),
    getRecordedHierarchyType: vi.fn(async () => server.recorded),
  },
  localizationService: {
    uploadBoundaryLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    uploadHierarchyLevelLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    cacheBust: vi.fn(async () => undefined),
  },
}));
vi.mock('../labelLocales', () => ({ labelLocales: vi.fn(async () => ['en_IN']) }));
vi.mock('../stepProbe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stepProbe')>()),
  useStepProbe: () => ({ probe: { status: 'known', passed: true, legacy: false }, recheck: vi.fn() }),
}));
vi.mock('@/hooks/useTurbopassSources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useTurbopassSources')>()),
  useTurbopassHealth: () => ({ sources: ['official'], officialCountries: [] }),
}));
vi.mock('@/hooks/usePreconfiguredBoundaries', async () => {
  const sets = (await import('@/utils/__fixtures__/officialSets.json')).default as Record<string, unknown>;
  return {
    usePreconfiguredBoundaries: () => ({ state: { status: 'ready', country: 'KE', set: sets.KE }, retry: vi.fn(), workspaceName: null }),
  };
});

const createBoundaries = vi.mocked(boundaryService.createBoundaries);
const createHierarchy = vi.mocked(boundaryService.createHierarchyFromLevels);
const ensureSchema = vi.mocked(mdmsService.ensureHierarchySchema);

const area = (code: string, boundaryType: string, parent?: string): Boundary => ({
  tenantId: 'ke',
  code,
  name: code,
  boundaryType,
  parent,
  hierarchyType: 'ADMIN',
});
const NAIROBI = [area('NBI', 'County'), area('NBI_W1', 'Ward', 'NBI'), area('NBI_W2', 'Ward', 'NBI')];
const selection = (boundaries: Boundary[]): NewSelection => ({
  source: 'osm',
  method: 'preconfigured',
  hierarchyType: 'ADMIN',
  levels: ['County', 'Ward'],
  hierarchyExists: false,
  boundaries,
  unnamed: [],
  alreadyThere: 0,
  sourceText: 'the official boundaries for Kenya',
  skipped: 0,
  attribution: null,
  preconfigured: null,
  resume: {
    kind: 'osm',
    searchTerm: 'Nairobi',
    pickedSuggestion: null,
    turbopassSource: 'official',
    fetchedPlace: { id: 'p1', name: 'Nairobi', label: 'Nairobi — County', country: 'KE' },
    adminLevels: [],
    attribution: null,
    officialSet: null,
  },
});

const renderStep = () =>
  render(
    <MemoryRouter>
      <GeographyStep />
    </MemoryRouter>,
  );
/** The server once a save has landed `saved`. */
const landed = (saved: Boundary[]) => {
  server.hierarchies = [{ tenantId: 'ke', hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'County' }, { boundaryType: 'Ward' }] }];
  server.areas = saved;
};
const saveAndConfirm = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save and continue' }));
};
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
/** Edit and Remove on a list item, and the sources: what changes the list. */
const expectListLocked = (item: string) => {
  expect(button(`Edit ${item}`).disabled).toBe(true);
  expect(button(`Remove ${item}`).disabled).toBe(true);
  expect(screen.getAllByText('Some areas weren’t saved. Retry them first.')).toHaveLength(3);
};

beforeEach(() => {
  vi.clearAllMocks();
  flags.multiple = false;
  server.hierarchies = [];
  server.areas = [];
  server.recorded = undefined;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
  createBoundaries.mockImplementation(async (boundaries) => {
    landed(boundaries);
    return { success: boundaries, failed: [] };
  });
  act(() => setBoundaryDraft('ke', null));
  window.localStorage.clear();
});

afterEach(async () => {
  // Clear a hierarchy record a test left pending.
  ensureSchema.mockResolvedValue(null);
  await retryHierarchyRecord('ke');
});

describe('GeographyStep', () => {
  it('asks before saving; Cancel writes nothing', async () => {
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Save these boundaries?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(createBoundaries).not.toHaveBeenCalled();
    expect(screen.getByTestId('boundary-list-item')).toBeTruthy();
  });

  it('saves the list on confirm, then completes the step', async () => {
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    await waitFor(() => expect(app.completePhase).toHaveBeenCalled());
    expect(createBoundaries).toHaveBeenCalledWith(NAIROBI, expect.any(Function));
    expect(screen.queryByTestId('boundary-list-item')).toBeNull();
  });

  it('locks the list, the sources and Save and continue while it saves, and keeps the list for a reload from the start', async () => {
    let finish = () => {};
    createBoundaries.mockImplementation(
      (boundaries) =>
        new Promise((resolve) => {
          finish = () => {
            landed(boundaries);
            resolve({ success: boundaries, failed: [] });
          };
        }),
    );
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    await screen.findByTestId('geography-saving');
    expect(button('Edit Nairobi — County').disabled).toBe(true);
    expect(button('Remove Nairobi — County').disabled).toBe(true);
    expect(screen.getAllByText('Saving your boundaries…').length).toBeGreaterThan(1);
    expect(button('Save and continue').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    // The hierarchy is on the server now: a tab closed here comes back to the list, locked for Retry.
    expect(Object.keys(window.localStorage)).toEqual(['ccrs-geography-unsaved:ke:ADMIN']);
    await act(async () => finish());
    await waitFor(() => expect(app.completePhase).toHaveBeenCalled());
    expect(window.localStorage.length).toBe(0);
  });

  it('keeps the areas a partial save missed, locked, for Retry; Save and continue goes on without them (#2795)', async () => {
    createBoundaries.mockImplementationOnce(async (boundaries) => {
      landed(boundaries.slice(0, 2));
      return { success: boundaries.slice(0, 2), failed: [{ boundary: boundaries[2], error: 'refused' }] };
    });
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    // The message sits under the list, so it points up to it.
    expect(await screen.findByText('1 area wasn’t saved. It’s in the list above: select Retry to try it again.')).toBeTruthy();
    expect(app.completePhase).not.toHaveBeenCalled();
    expect(screen.getByTestId('boundary-list-item').textContent).toContain('1 ward');
    expectListLocked('Nairobi — County');
    expect(button('Retry').disabled).toBe(false);

    // What landed passes the step's check, so Save and continue goes on, without asking to save again.
    await waitFor(() => expect(button('Save and continue').disabled).toBe(false));
    fireEvent.click(button('Save and continue'));
    await waitFor(() => expect(app.completePhase).toHaveBeenCalled());
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(createBoundaries).toHaveBeenCalledTimes(1);
  });

  it('when nothing landed, Retry writes the areas into the hierarchy the save defined, and Save and continue waits for it', async () => {
    createBoundaries.mockImplementationOnce(async (boundaries) => {
      landed([]);
      return { success: [], failed: boundaries.map((boundary) => ({ boundary, error: 'Request failed with status code 500' })) };
    });
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    expect(await screen.findByText('3 areas weren’t saved. They’re in the list above: select Retry to try them again.')).toBeTruthy();
    expect(await screen.findByText('Retry the areas that weren’t saved to continue.')).toBeTruthy();
    expect(button('Save and continue').disabled).toBe(true);
    expectListLocked('Nairobi — County');

    fireEvent.click(button('Retry'));
    await waitFor(() => expect(screen.queryByTestId('boundary-list-item')).toBeNull());
    expect(createBoundaries).toHaveBeenCalledTimes(2);
    expect(createBoundaries).toHaveBeenLastCalledWith(NAIROBI, expect.any(Function));
    // The hierarchy is defined once; Retry doesn't try again (it would refuse other level names).
    expect(createHierarchy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/weren’t saved/)).toBeNull();
    // Retry only saves: the step completes on Save and continue.
    expect(app.completePhase).not.toHaveBeenCalled();
    await waitFor(() => expect(button('Save and continue').disabled).toBe(false));
    fireEvent.click(button('Save and continue'));
    await waitFor(() => expect(app.completePhase).toHaveBeenCalled());
  });

  it('a save that stops partway after defining the hierarchy leaves the whole list locked for Retry', async () => {
    createBoundaries.mockRejectedValueOnce(new Error('Network Error'));
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    expect(await screen.findByText('3 areas weren’t saved. They’re in the list above: select Retry to try them again. Network Error')).toBeTruthy();
    expectListLocked('Nairobi — County');
    fireEvent.click(button('Retry'));
    await waitFor(() => expect(screen.queryByTestId('boundary-list-item')).toBeNull());
    expect(createHierarchy).toHaveBeenCalledTimes(1);
  });

  it('a save that fails before defining the hierarchy leaves the list as it was', async () => {
    createHierarchy.mockRejectedValueOnce(new Error('Network Error'));
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    expect(await screen.findByText('Network Error')).toBeTruthy();
    expect(button('Edit Nairobi — County').disabled).toBe(false);
    expect(button('Remove Nairobi — County').disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('G-9: names each area a save missed, with the server’s reason, and leaves the step open (#2795)', async () => {
    createBoundaries.mockImplementation(async (boundaries) => {
      landed(boundaries.slice(0, 1));
      return {
        success: boundaries.slice(0, 1),
        failed: [
          { boundary: boundaries[1], error: 'Boundary type is not in the hierarchy', code: 'BOUNDARY_TYPE_ERROR' },
          { boundary: boundaries[2], error: 'Relationship still absent after verify retries' },
        ],
      };
    });
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    expect(await screen.findByText(/2 areas weren’t saved. They’re in the list above: select Retry/)).toBeTruthy();
    const failures = screen.getByTestId('geography-save-failures').querySelectorAll('li');
    expect([...failures].map((li) => li.textContent)).toEqual([
      'NBI_W1: Boundary type is not in the hierarchy(BOUNDARY_TYPE_ERROR)',
      // No server reason: plain words, not the internal one.
      'NBI_W2: The server didn’t confirm it was saved.',
    ]);
    expect(app.completePhase).not.toHaveBeenCalled();
    // Still in the list for Retry, and the sources stay closed while it is.
    expect(screen.getByTestId('boundary-list-item').textContent).toContain('2 wards');
    expectListLocked('Nairobi — County');
  });

  describe('after a reload, the areas a save missed (#2795)', () => {
    // The browser test: an Excel sheet, County → Ward, where only PW2 is refused.
    const PAGE = [area('PC1', 'County'), area('PW1', 'Ward', 'PC1'), area('PW2', 'Ward', 'PC1')];
    const sheet: NewSelection = {
      ...selection(PAGE),
      source: 'excel',
      method: 'excel',
      sourceText: 'your Excel upload',
      resume: {
        kind: 'excel',
        hierarchy: { tenantId: 'ke', hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'County', active: true }, { boundaryType: 'Ward', active: true }] },
        file: new File(['rows'], 'wards.xlsx'),
        parsed: [],
        valid: [],
        invalid: [],
        polygonFile: null,
        polygonSidecar: null,
      },
    };
    const NOT_SAVED = '1 area wasn’t saved. It’s in the list above: select Retry to try it again.';
    /** Saves the sheet with PW2 refused, then reloads: this tab's memory goes, the browser's storage stays. */
    const saveThenReload = async () => {
      createBoundaries.mockImplementationOnce(async (boundaries) => {
        landed(boundaries.slice(0, 2));
        return {
          success: boundaries.slice(0, 2),
          failed: [{ boundary: boundaries[2], error: 'Boundary type is not in the hierarchy', code: 'BOUNDARY_TYPE_ERROR' }],
        };
      });
      server.recorded = 'ADMIN';
      act(() => void addSelection('ke', sheet));
      const page = renderStep();
      await saveAndConfirm();
      expect(await screen.findByText(NOT_SAVED)).toBeTruthy();
      page.unmount();
      const kept = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i) as string).map(
        (key) => [key, window.localStorage.getItem(key) as string] as const,
      );
      act(() => setBoundaryDraft('ke', null));
      for (const [key, value] of kept) window.localStorage.setItem(key, value);
      return renderStep();
    };

    it('come back locked with the server’s reason, and Retry writes only them', async () => {
      await saveThenReload();
      const item = await screen.findByTestId('boundary-list-item');
      expect(item.textContent).toContain('wards.xlsx');
      expect(item.textContent).toContain('1 ward');
      expect(screen.getByText(NOT_SAVED)).toBeTruthy();
      expect([...screen.getByTestId('geography-save-failures').querySelectorAll('li')].map((li) => li.textContent)).toEqual([
        'PW2: Boundary type is not in the hierarchy(BOUNDARY_TYPE_ERROR)',
      ]);
      // PW2 is still to be added, so the sources don't say nothing more can be, and nothing else can be added.
      expect(screen.queryByText('Your boundaries are saved, so no more can be added.')).toBeNull();
      expectListLocked('wards.xlsx');
      expect(app.completePhase).not.toHaveBeenCalled();

      fireEvent.click(button('Retry'));
      await waitFor(() => expect(screen.queryByTestId('boundary-list-item')).toBeNull());
      expect(createBoundaries).toHaveBeenLastCalledWith([expect.objectContaining({ code: 'PW2', parent: 'PC1' })], expect.any(Function));
      expect(screen.queryByText(NOT_SAVED)).toBeNull();
      // All saved: nothing is kept for the next reload.
      expect(window.localStorage.length).toBe(0);
      expect(app.completePhase).not.toHaveBeenCalled();
    });

    it('don’t hold the step up: Save and continue goes on, and they wait for Retry', async () => {
      await saveThenReload();
      await screen.findByTestId('boundary-list-item');
      await waitFor(() => expect(button('Save and continue').disabled).toBe(false));
      fireEvent.click(button('Save and continue'));
      await waitFor(() => expect(app.completePhase).toHaveBeenCalled());
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(createBoundaries).toHaveBeenCalledTimes(1);
      // Still there for Retry when the step is opened again.
      expect(window.localStorage.length).toBe(1);
      expect(screen.getByTestId('boundary-list-item').textContent).toContain('1 ward');
    });
  });

  it('reopens Upload from Excel, and only it, for a saved hierarchy with one level (#2795)', async () => {
    // A partly refused save, after a reload: the county landed, its wards didn't.
    landed([area('C1', 'County')]);
    server.recorded = 'ADMIN';
    renderStep();
    const notice = await screen.findByTestId('geography-unfinished');
    expect(notice.textContent).toBe(
      'Your boundaries were only partly saved. ADMIN has 1 county but nothing on the level below, so this step can’t be completed yet. Use Upload from Excel to add the missing areas.',
    );
    expect(screen.queryByText('Your boundaries are saved, so no more can be added.')).toBeNull();
    // Fetch and Preconfigured would write into another hierarchy, which never completes the step.
    expect(screen.getAllByText('To finish your saved boundaries, use Upload from Excel.')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /Upload a file/ }));
    // Straight to the saved hierarchy, with no way to start another.
    expect(await screen.findByText(/Your saved boundaries are in ADMIN, so the missing areas go there too/)).toBeTruthy();
    expect(screen.queryByText('Create a new hierarchy')).toBeNull();
  });

  it('keeps the sources closed for a saved hierarchy with two levels', async () => {
    landed(NAIROBI);
    server.recorded = 'ADMIN';
    renderStep();
    await waitFor(() => expect(screen.getAllByText('Your boundaries are saved, so no more can be added.')).toHaveLength(3));
    expect(screen.queryByTestId('geography-unfinished')).toBeNull();
  });

  it('writes a hierarchy record that failed on the next Save and continue', async () => {
    ensureSchema.mockRejectedValueOnce(new Error('MDMS down'));
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await saveAndConfirm();
    expect(await screen.findByText(/hierarchy record didn't save: MDMS down Save and continue tries it again/)).toBeTruthy();
    expect(app.completePhase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(app.completePhase).toHaveBeenCalled());
    expect(ensureSchema).toHaveBeenCalledTimes(2);
  });

  it('closes the sources with the flag off: while an item waits, and once boundaries are saved', async () => {
    act(() => void addSelection('ke', selection(NAIROBI)));
    const { unmount } = renderStep();
    await waitFor(() => expect(screen.getAllByText('Remove the boundaries below to choose different ones.')).toHaveLength(3));
    unmount();
    act(() => setBoundaryDraft('ke', null));
    landed(NAIROBI);
    renderStep();
    await waitFor(() => expect(screen.getAllByText('Your boundaries are saved, so no more can be added.')).toHaveLength(3));
  });

  it('leaves the sources open with the flag on', async () => {
    flags.multiple = true;
    act(() => void addSelection('ke', selection(NAIROBI)));
    renderStep();
    await screen.findByTestId('boundary-list-item');
    expect(screen.queryByText('Remove the boundaries below to choose different ones.')).toBeNull();
    expect(screen.getByRole('button', { name: /Search boundaries/ })).toBeTruthy();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BoundaryHierarchy } from '@/api/types';
import type { TenantHierarchies } from '@/api/services/tenantHierarchy';
import { boundaryService } from '@/api';
import type { ImportResume, NewSelection } from './boundaryDraft';

// "Use an existing hierarchy" (Excel path): a list that failed to load must not
// read as a tenant with no hierarchies (#1915 review).
const loadTenantHierarchies = vi.fn<(tenantId: string) => Promise<TenantHierarchies>>();
vi.mock('@/api/services/tenantHierarchy', () => ({
  loadTenantHierarchies: (tenantId: string) => loadTenantHierarchies(tenantId),
}));
vi.mock('../../App', () => ({
  useApp: () => ({ addUndo: vi.fn(), state: { tenant: 'ke', targetTenant: 'ke' } }),
}));
vi.mock('@/hooks/useMapProviderConfig', () => ({
  useMapProviderConfig: () => ({ provider: 'leaflet', googleMapsApiKey: '', loading: false, reload: vi.fn() }),
}));

import BoundaryImport from './BoundaryImport';

const hierarchy = (hierarchyType: string): BoundaryHierarchy => ({
  tenantId: 'ke',
  hierarchyType,
  boundaryHierarchy: [{ boundaryType: 'County', active: true }, { boundaryType: 'Ward', parentBoundaryType: 'County', active: true }],
});

async function openSelectStep() {
  render(<BoundaryImport source="excel" hasHierarchies sourceChoices={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
  const useExisting = await screen.findByRole('button', { name: /use an existing hierarchy/i });
  await waitFor(() => expect((useExisting as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(useExisting);
}

beforeEach(() => loadTenantHierarchies.mockReset());

describe('BoundaryImport: select an existing hierarchy', () => {
  it('says the list failed to load, offers a retry and does not steer to "create new"', async () => {
    loadTenantHierarchies.mockResolvedValueOnce({ hierarchies: [], hierarchyType: 'ADMIN', listError: new Error('502 on page 3') });

    await openSelectStep();

    expect(screen.getByText('Couldn’t load your hierarchies. 502 on page 3')).toBeTruthy();
    expect(screen.queryByText('No hierarchies found for this tenant.')).toBeNull();
    expect(screen.queryByRole('button', { name: /create new hierarchy/i })).toBeNull();

    loadTenantHierarchies.mockResolvedValueOnce({ hierarchies: [hierarchy('PW_NEW'), hierarchy('ADMIN')], hierarchyType: 'ADMIN' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('ADMIN')).toBeTruthy();
    expect(screen.queryByText(/Couldn’t load your hierarchies/)).toBeNull();
    expect(loadTenantHierarchies).toHaveBeenCalledTimes(2);
  });

  it('preselects the hierarchy the loader picked, not the newest one listed', async () => {
    loadTenantHierarchies.mockResolvedValueOnce({ hierarchies: [hierarchy('PW_NEW'), hierarchy('ADMIN')], hierarchyType: 'ADMIN' });

    await openSelectStep();

    const selected = screen.getAllByRole('button').filter((b) => b.className.includes('border-primary bg-primary/5'));
    expect(selected.map((b) => b.textContent)).toEqual([expect.stringContaining('ADMIN')]);
  });

  it('still offers to create one when the tenant really has none', async () => {
    loadTenantHierarchies.mockResolvedValueOnce({ hierarchies: [] });

    await openSelectStep();

    expect(screen.getByText('No hierarchies found for this tenant.')).toBeTruthy();
    expect(screen.queryByText(/Couldn’t load your hierarchies/)).toBeNull();
  });
});

describe('BoundaryImport: create a hierarchy', () => {
  it('marks the hierarchy name and its levels as required', async () => {
    loadTenantHierarchies.mockResolvedValue({ hierarchies: [] });
    render(<BoundaryImport source="excel" hasHierarchies={false} sourceChoices={[]} onDone={vi.fn()} onCancel={vi.fn()} />);

    const name = await screen.findByText(/Hierarchy Type Name/);
    expect(name.querySelector('[data-required-mark]')).not.toBeNull();
    expect(document.getElementById('hierarchyType')?.getAttribute('aria-required')).toBe('true');
    // At least two named levels.
    expect(screen.getByText(/Define Levels/).querySelector('[data-required-mark]')).not.toBeNull();
  });

  // #2803: the type is checked and saved as one trimmed value; boundary-service stores it in 64 characters.
  const createWithType = async (typed: string) => {
    render(<BoundaryImport source="excel" hasHierarchies={false} sourceChoices={[]} onDone={vi.fn()} onCancel={vi.fn()} />);
    const create = await screen.findByRole('button', { name: 'Create Hierarchy' });
    await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(document.getElementById('hierarchyType')!, { target: { value: typed } });
    fireEvent.click(create);
  };

  it('saves the hierarchy type trimmed, as it was checked', async () => {
    loadTenantHierarchies.mockResolvedValue({ hierarchies: [] });
    const sixtyFour = 'H'.repeat(64);
    await createWithType(`${sixtyFour}  `);
    expect(await screen.findByText(`Boundary_Template_${sixtyFour}.xlsx`)).toBeTruthy();
  });

  it('finds a type already there when only surrounding spaces differ', async () => {
    loadTenantHierarchies.mockResolvedValue({ hierarchies: [hierarchy('REVENUE')], hierarchyType: 'REVENUE' });
    await createWithType(' REVENUE ');
    expect(
      await screen.findByText('A "REVENUE" hierarchy already exists. Choose it under "Use an existing hierarchy", or pick another name.'),
    ).toBeTruthy();
  });
});

// #2803: Fetch into a hierarchy saved before level names were tidied ("Sub  County", two spaces).
// The same names typed again still match it, and the list takes the hierarchy's own spelling,
// which boundary-service matches each area's level against exactly.
describe('BoundaryImport: Fetch into a saved hierarchy', () => {
  const square = (x: number, y: number, size: number) => ({
    type: 'Polygon',
    coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]],
  });
  const feature = (name: string, id: string, geometry: unknown) => ({ type: 'Feature', properties: { name, place_id: id }, geometry });
  const resume: ImportResume = {
    kind: 'osm',
    searchTerm: 'Nairobi',
    pickedSuggestion: null,
    turbopassSource: 'official',
    fetchedPlace: { id: 'p1', name: 'Nairobi', label: 'Nairobi, Kenya', country: 'Kenya' },
    adminLevels: [
      { level: 1, features: [feature('Nairobi', 'c1', square(0, 0, 10))], examples: [], mappedName: 'County', selected: true },
      { level: 2, features: [feature('Westlands', 's1', square(1, 1, 2))], examples: [], mappedName: 'Sub County', selected: true },
    ],
    attribution: null,
    officialSet: null,
  };

  it('matches the saved names typed tidied, and lists them as the hierarchy spells them', async () => {
    const saved: BoundaryHierarchy = {
      tenantId: 'ke',
      hierarchyType: 'ADMIN',
      boundaryHierarchy: [{ boundaryType: 'County', active: true }, { boundaryType: 'Sub  County', parentBoundaryType: 'County', active: true }],
    };
    loadTenantHierarchies.mockResolvedValue({ hierarchies: [saved], hierarchyType: 'ADMIN' });
    const existing = vi.spyOn(boundaryService, 'existingBoundaries').mockResolvedValue([]);
    const onDone = vi.fn<(selection: NewSelection) => string | null>(() => null);
    try {
      render(<BoundaryImport source="osm" hasHierarchies sourceChoices={[]} resume={resume} onDone={onDone} onCancel={vi.fn()} />);
      const create = await screen.findByRole('button', { name: 'Create Hierarchy & Boundaries' });
      await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(create);
      await waitFor(() => expect(onDone).toHaveBeenCalled());
      expect(screen.queryByText(/do not match your mapped levels/)).toBeNull();
      expect(onDone.mock.calls[0][0]).toMatchObject({ hierarchyExists: true, levels: ['County', 'Sub  County'] });
    } finally {
      existing.mockRestore();
    }
  });
});

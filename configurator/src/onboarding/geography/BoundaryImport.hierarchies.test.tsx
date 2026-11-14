import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BoundaryHierarchy } from '@/api/types';
import type { TenantHierarchies } from '@/api/services/tenantHierarchy';

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

// The sheet a test "uploads": parsing is stubbed, the preview's checks are real.
const sheetRows = vi.hoisted(() => ({ rows: [] as BoundaryExcelRow[] }));
vi.mock('@/utils/excelParser', () => ({
  parseExcelFile: vi.fn(async () => ({})),
  parseBoundaryExcel: () => ({ data: sheetRows.rows, hierarchyLevels: [], validation: { valid: true, errors: [], warnings: [] } }),
}));

import BoundaryImport from './BoundaryImport';
import type { BoundaryExcelRow } from '@/api/types';

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

describe('BoundaryImport: the Excel preview checks rows against the chosen hierarchy', () => {
  it('G-9/G-10: refuses a type that is not a level and a ward without a county, and counts them as errors (#2795, #2796)', async () => {
    loadTenantHierarchies.mockResolvedValue({ hierarchies: [hierarchy('ADMIN')], hierarchyType: 'ADMIN' });
    sheetRows.rows = [
      { code: 'C1', name: 'Alpha County', boundaryType: 'County', row: 2 },
      { code: 'W1', name: 'Ward One', boundaryType: 'Village', parentCode: 'C1', row: 3 },
      { code: 'W2', name: 'Ward Two', boundaryType: 'Ward', row: 4 },
    ];
    await openSelectStep();
    fireEvent.click(screen.getByRole('button', { name: /use selected hierarchy/i }));
    const input = document.getElementById('boundary-file-upload') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'sheet.xlsx')] } });

    expect(await screen.findByText(/Row 3: "Village" isn’t a level of this hierarchy\. Use one of: County, Ward\./)).toBeTruthy();
    expect(screen.getByText(/Row 4: A Ward needs a parent County in parentCode/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Errors (2)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Upload 1 Boundaries/ })).toBeTruthy();
  });
});

describe('BoundaryImport: finishing a saved hierarchy', () => {
  it('offers only that hierarchy, and no way to start a new one (#2795)', async () => {
    loadTenantHierarchies.mockResolvedValue({ hierarchies: [hierarchy('PW_NEW'), hierarchy('ADMIN')], hierarchyType: 'PW_NEW' });
    const onCancel = vi.fn();
    render(<BoundaryImport source="excel" hasHierarchies addTo="ADMIN" sourceChoices={[]} onDone={vi.fn()} onCancel={onCancel} />);

    expect(await screen.findByText('ADMIN')).toBeTruthy();
    expect(screen.queryByText('PW_NEW')).toBeNull();
    expect(screen.queryByText('Create a new hierarchy')).toBeNull();
    const selected = screen.getAllByRole('button').filter((b) => b.className.includes('border-primary bg-primary/5'));
    expect(selected.map((b) => b.textContent)).toEqual([expect.stringContaining('ADMIN')]);
    // Back leaves the import rather than offering the new-or-existing choice.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onCancel).toHaveBeenCalled();
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
});

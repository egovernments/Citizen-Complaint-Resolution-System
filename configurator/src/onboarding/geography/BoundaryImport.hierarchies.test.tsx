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

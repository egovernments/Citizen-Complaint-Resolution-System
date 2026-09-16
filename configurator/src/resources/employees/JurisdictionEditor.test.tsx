// @vitest-environment jsdom
//
// Regression coverage for CCRS #1923 — "Duplicate records rendered in
// dropdown/select fields on the configurator".
//
// The reported screen is the employee create/edit form's Jurisdiction block.
// `boundary-hierarchies` aggregates the state tenant's hierarchy definitions
// with every city tenant's, and DIGIT does not require a `hierarchyType` to be
// unique across tenants — on bomet (`ke`) SEVEN tenants define one called
// "ADMIN" and three define "KE-ADMIN". Radix renders one SelectItem per choice
// and treats items sharing a `value` as the same selection, so the operator saw
// seven "ADMIN" rows all ticked and a trigger reading
// "ADMINADMINADMINADMINAD…".
//
// The same holds one level down: boundary codes are unique per tenant, not
// globally (`ke.mycitynew` and `ke.hajbvfg` both seed CITY_001 / WARD_001).

import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CoreAdminContext, Form, TestMemoryRouter, type DataProvider } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { JurisdictionEditor } from './JurisdictionEditor';

// The bomet shape, trimmed: one hierarchy name defined by several tenants.
const HIERARCHIES = [
  { id: 'ADMIN', hierarchyType: 'ADMIN', tenantId: 'ke', boundaryHierarchy: [
    { boundaryType: 'County', parentBoundaryType: null, active: true },
    { boundaryType: 'Ward', parentBoundaryType: 'County', active: true },
  ] },
  { id: 'ADMIN', hierarchyType: 'ADMIN', tenantId: 'ke.mycitynew', boundaryHierarchy: [
    { boundaryType: 'County', parentBoundaryType: null, active: true },
  ] },
  { id: 'ADMIN', hierarchyType: 'ADMIN', tenantId: 'ke.hajbvfg', boundaryHierarchy: [
    { boundaryType: 'County', parentBoundaryType: null, active: true },
  ] },
  { id: 'KE-ADMIN', hierarchyType: 'KE-ADMIN', tenantId: 'ke.india', boundaryHierarchy: [
    { boundaryType: 'State', parentBoundaryType: null, active: true },
  ] },
  { id: 'KE-ADMIN', hierarchyType: 'KE-ADMIN', tenantId: 'ke.etoebeta', boundaryHierarchy: [
    { boundaryType: 'State', parentBoundaryType: null, active: true },
  ] },
];

// CITY_001 exists under two tenants — same code, same hierarchy, same level.
const BOUNDARIES = [
  { id: 'BOMET', code: 'BOMET', name: 'Bomet', boundaryType: 'County', hierarchyType: 'ADMIN', tenantId: 'ke' },
  { id: 'CITY_001', code: 'CITY_001', name: 'City One', boundaryType: 'County', hierarchyType: 'ADMIN', tenantId: 'ke.mycitynew' },
  { id: 'CITY_001', code: 'CITY_001', name: 'City One', boundaryType: 'County', hierarchyType: 'ADMIN', tenantId: 'ke.hajbvfg' },
];

function makeDataProvider(): DataProvider {
  return {
    getList: async (resource: string) => {
      if (resource === 'boundary-hierarchies') return { data: HIERARCHIES, total: HIERARCHIES.length };
      if (resource === 'boundaries') return { data: BOUNDARIES, total: BOUNDARIES.length };
      return { data: [], total: 0 };
    },
    getOne: async (_r: string, params: { id: unknown }) => ({ data: { id: params.id } }),
    getMany: async () => ({ data: [] }),
    getManyReference: async () => ({ data: [], total: 0 }),
    create: async (_r: string, params: { data: unknown }) => ({ data: params.data }),
    update: async (_r: string, params: { id: unknown; data: unknown }) => ({ data: params.data }),
    updateMany: async () => ({ data: [] }),
    delete: async (_r: string, params: { id: unknown }) => ({ data: { id: params.id } }),
    deleteMany: async () => ({ data: [] }),
  } as unknown as DataProvider;
}

function renderEditor(record: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext dataProvider={makeDataProvider()} queryClient={queryClient}>
        <Form record={record} onSubmit={() => {}}>
          <JurisdictionEditor tenantId="ke" />
        </Form>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

/** The row renders its selects in a fixed order — Hierarchy, then one per
 *  hierarchy level (County, Ward, …) — and the <Label>s above them are not
 *  wired to the triggers, so position is the only stable handle. */
const HIERARCHY_SELECT = 0;
const FIRST_LEVEL_SELECT = 1;

/** Open the Nth select. Waits for it to be enabled first: the control is
 *  `disabled` while its query is in flight, and Radix opens on pointerdown
 *  (not click), which a disabled trigger simply ignores. */
async function openSelect(index: number): Promise<void> {
  let trigger: HTMLElement | undefined;
  await waitFor(() => {
    const all = screen.getAllByRole('combobox');
    expect(all.length).toBeGreaterThan(index);
    expect(all[index]).not.toBeDisabled();
    trigger = all[index];
  });
  fireEvent.pointerDown(trigger!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
}

beforeAll(() => {
  // Radix Select touches these on some jsdom code paths; polyfill defensively.
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false;
  if (typeof proto.setPointerCapture !== 'function') proto.setPointerCapture = () => {};
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {};
  if (typeof proto.scrollIntoView !== 'function') proto.scrollIntoView = () => {};
  // src/test/setup.ts installs ResizeObserver as `vi.fn().mockImplementation(…)`,
  // which vitest 4 refuses to `new` — and @floating-ui (under Radix's popper)
  // constructs one the moment the dropdown content mounts, so every option
  // would vanish into an error boundary. Install a real class for this file.
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = TestResizeObserver;
});

describe('JurisdictionEditor — #1923 duplicate dropdown options', () => {
  it('lists each hierarchyType ONCE even when several tenants define it', async () => {
    renderEditor({ jurisdictions: [{ hierarchyType: 'ADMIN', boundaryType: 'County', boundary: 'BOMET' }] });

    await openSelect(HIERARCHY_SELECT);

    // 3 ADMIN + 2 KE-ADMIN records in, 1 + 1 options out.
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(screen.getAllByRole('option', { name: 'ADMIN' })).toHaveLength(1);
    expect(screen.getAllByRole('option', { name: 'KE-ADMIN' })).toHaveLength(1);
  });

  it('lists each boundary code ONCE even when two tenants seed the same code', async () => {
    renderEditor({ jurisdictions: [{ hierarchyType: 'ADMIN', boundaryType: 'County', boundary: 'BOMET' }] });

    // The first level of ke's ADMIN hierarchy is County.
    await openSelect(FIRST_LEVEL_SELECT);

    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    // BOMET + CITY_001 (x2 in the source data) => 2 options, not 3.
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: /City One/ })).toHaveLength(1);
  });

  it('a hierarchy collapsed from duplicates is still selectable and drives the cascade', async () => {
    // Guards the real risk of deduping: the survivor must still be a working
    // choice, not an inert label. Picking "ADMIN" must expose its levels.
    renderEditor({ jurisdictions: [{}] });

    await openSelect(HIERARCHY_SELECT);
    fireEvent.click(await screen.findByRole('option', { name: 'ADMIN' }));

    // ke's ADMIN defines County -> Ward, so picking it must add BOTH level
    // selects next to the hierarchy one (3 comboboxes in total).
    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3));
    expect(screen.getByText('County')).toBeInTheDocument();
    expect(screen.getByText('Ward')).toBeInTheDocument();
  });
});

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

import { describe, it, expect, beforeAll, vi } from 'vitest';
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

function renderEditor(
  record: Record<string, unknown>,
  onSubmit: (values: unknown) => void = () => {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext dataProvider={makeDataProvider()} queryClient={queryClient}>
        <Form record={record} onSubmit={onSubmit}>
          <JurisdictionEditor tenantId="ke" />
          <button type="submit">Save</button>
        </Form>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

/** The jurisdictions array as the form would hand it to egov-hrms/_update. */
function submittedJurisdictions(onSubmit: ReturnType<typeof vi.fn>) {
  const values = onSubmit.mock.calls[0][0] as { jurisdictions?: Record<string, unknown>[] };
  return values.jurisdictions ?? [];
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

// Regression coverage for CCRS #1957 — "User is unable to revoke the access of
// a particular jurisdiction/department that was already assigned to user".
//
// egov-hrms treats jurisdictions as append-only: EmployeeValidator's
// validateConsistencyJurisdiction fails the WHOLE update with
// ERR_HRMS_UPDATE_JURISDICTION_INCOSISTENT ("Jurisdiction data in an update
// request should contain all previously entered data.") unless every id it has
// already stored comes back in the payload. This editor used to splice the row
// straight out of the form value, so on bomet an admin trying to take Bomet
// Central away from HR_CSR could not save the employee at all.
//
// The supported revoke is the isActive flag: the row stays in the payload
// switched off, egov-hrms's EmployeeRowMapper stops returning it from _search,
// and pgr-services' PolicyDrivenScopeResolver stops unioning its boundary into
// the employee's scope.
const SAVED_JURISDICTIONS = [
  {
    id: 'jur-bomet',
    hierarchyType: 'ADMIN',
    boundaryType: 'County',
    boundary: 'BOMET',
    isActive: true,
    tenantId: 'ke',
  },
  {
    id: 'jur-city-one',
    hierarchyType: 'ADMIN',
    boundaryType: 'County',
    boundary: 'CITY_001',
    isActive: true,
    tenantId: 'ke.mycitynew',
  },
];

describe('JurisdictionEditor — #1957 revoking an assigned jurisdiction', () => {
  it('keeps a saved jurisdiction in the payload as isActive:false rather than dropping it', async () => {
    const onSubmit = vi.fn();
    renderEditor({ jurisdictions: SAVED_JURISDICTIONS }, onSubmit);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove jurisdiction 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const sent = submittedJurisdictions(onSubmit);
    // Both ids still travel — that is what keeps HRMS's consistency check happy.
    expect(sent.map((j) => j.id)).toEqual(['jur-bomet', 'jur-city-one']);
    expect(sent.find((j) => j.id === 'jur-bomet')?.isActive).toBe(true);
    expect(sent.find((j) => j.id === 'jur-city-one')?.isActive).toBe(false);
  });

  it('drops the revoked row from the editor and offers it back under "Revoked on save"', async () => {
    renderEditor({ jurisdictions: SAVED_JURISDICTIONS });

    fireEvent.click(await screen.findByRole('button', { name: 'Remove jurisdiction 2' }));

    // One live row left, and the revoked one is listed as pending with an undo.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove jurisdiction 2' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Remove jurisdiction 1' })).toBeInTheDocument();
    expect(screen.getByText('Revoked on save')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore/ })).toBeInTheDocument();
  });

  it('Restore puts the row back before the save goes out', async () => {
    const onSubmit = vi.fn();
    renderEditor({ jurisdictions: SAVED_JURISDICTIONS }, onSubmit);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove jurisdiction 2' }));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submittedJurisdictions(onSubmit).every((j) => j.isActive === true)).toBe(true);
    expect(screen.queryByText('Revoked on save')).not.toBeInTheDocument();
  });

  it('editing another row does not silently re-grant a revoked one', async () => {
    // writeRows used to stamp `isActive: true` onto every row it wrote back, so
    // any later keystroke resurrected the jurisdiction the operator had just
    // revoked — the revoke looked applied but never reached HRMS.
    const onSubmit = vi.fn();
    renderEditor({ jurisdictions: SAVED_JURISDICTIONS }, onSubmit);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove jurisdiction 2' }));
    await openSelect(FIRST_LEVEL_SELECT);
    fireEvent.click(await screen.findByRole('option', { name: /City One/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submittedJurisdictions(onSubmit).find((j) => j.id === 'jur-city-one')?.isActive).toBe(
      false,
    );
  });

  it('a row the operator added but never saved is removed outright', async () => {
    // No id means HRMS has never seen it, so there is nothing for the
    // consistency check to miss and no reason to keep a dead row around.
    const onSubmit = vi.fn();
    renderEditor({ jurisdictions: [SAVED_JURISDICTIONS[0]] }, onSubmit);

    fireEvent.click(await screen.findByRole('button', { name: 'Add jurisdiction' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove jurisdiction 2' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove jurisdiction 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submittedJurisdictions(onSubmit)).toHaveLength(1);
    expect(screen.queryByText('Revoked on save')).not.toBeInTheDocument();
  });
});

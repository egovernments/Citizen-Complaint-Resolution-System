import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, MdmsRecord } from '@/api/types';
import ComplaintsStep from './ComplaintsStep';
import { loadComplaints, removeSheetComplaints, type LoadedComplaints } from './complaints/complaintsApi';
import { listMasters } from './departments/mastersApi';
import { listEmployees } from './employees/employeesApi';

const app = { state: { tenant: 'acme', completedPhases: [] as number[] }, completePhase: vi.fn(async () => true) };
vi.mock('@/App', () => ({ useApp: () => app }));

vi.mock('./complaints/complaintsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./complaints/complaintsApi')>()),
  loadComplaints: vi.fn(),
  removeSheetComplaints: vi.fn(async () => undefined),
}));
vi.mock('./departments/mastersApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./departments/mastersApi')>()),
  listMasters: vi.fn(),
}));
vi.mock('./employees/employeesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./employees/employeesApi')>()),
  listEmployees: vi.fn(),
}));

const department = (code: string, name: string): MdmsRecord => ({
  id: code,
  tenantId: 'acme',
  schemaCode: 'common-masters.Department',
  uniqueIdentifier: code,
  isActive: true,
  data: { code, name },
});
const gro = (dept: string) =>
  ({
    code: 'S001',
    isActive: true,
    user: { active: true, roles: [{ code: 'GRO', tenantId: 'acme' }] },
    assignments: [{ department: dept, isCurrentAssignment: true }],
  }) as unknown as Employee;

// C-5: three levels, one row whose department was typed as the name.
const stuckSheet: LoadedComplaints = {
  editable: false,
  leafCount: 1,
  levels: ['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'],
  departments: ['Sanitation Services'],
  routes: [{ name: 'Uncollected waste', department: 'Sanitation Services' }],
};

const load = vi.mocked(loadComplaints);

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(listMasters).mockResolvedValue([department('SANIT', 'Sanitation Services'), department('ROADS', 'Roads')]);
  vi.mocked(listEmployees).mockResolvedValue({ active: [gro('SANIT')], codes: ['S001'] });
});

const renderStep = () =>
  render(
    <MemoryRouter>
      <ComplaintsStep />
    </MemoryRouter>,
  );

describe('ComplaintsStep: a spreadsheet hierarchy that blocks Finish (#2806)', () => {
  it('names the unknown department and its category, not a missing GRO', async () => {
    load.mockResolvedValue(stuckSheet);
    renderStep();

    const notice = await screen.findByTestId('complaints-unknown-department');
    expect(notice.textContent).toContain(
      'Some complaint categories go to a department this workspace doesn’t have: Uncollected waste (“Sanitation Services”).',
    );
    expect(notice.textContent).toContain('Use “Remove and upload again”');
    expect(screen.queryByTestId('complaints-no-gro')).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeDisabled();
  });

  it('names the categories a department without a GRO holds up', async () => {
    load.mockResolvedValue({ ...stuckSheet, departments: ['ROADS'], routes: [{ name: 'Pothole', department: 'ROADS' }, { name: 'Broken kerb', department: 'ROADS' }] });
    renderStep();

    const notice = await screen.findByTestId('complaints-no-gro');
    expect(notice.textContent).toContain('No one can assign complaints for Roads.');
    expect(notice.textContent).toContain('Complaint categories affected: Pothole, Broken kerb.');
    expect(screen.queryByTestId('complaints-unknown-department')).toBeNull();
  });

  it('removes the sheet after a confirm and opens the upload again', async () => {
    load.mockResolvedValueOnce(stuckSheet).mockResolvedValue({
      editable: true,
      draft: { types: [], slaHours: 72 },
      records: [],
      hasDefinition: false,
    });
    renderStep();

    fireEvent.click(await screen.findByTestId('complaints-remove-sheet'));
    expect(removeSheetComplaints).not.toHaveBeenCalled();
    expect(await screen.findByText('Remove the complaint categories from the spreadsheet?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(removeSheetComplaints).toHaveBeenCalledWith('acme'));
    expect(await screen.findByTestId('complaint-hierarchy-setup')).toBeTruthy();
  });

  it('tells a hand-built category with an unknown department to pick one from the list (C-3)', async () => {
    load.mockResolvedValue({
      editable: true,
      draft: { types: [{ code: 'Garbage', name: 'Garbage', department: 'Sanitation Services', subtypes: [] }], slaHours: 72 },
      records: [],
      hasDefinition: true,
    });
    renderStep();

    const notice = await screen.findByTestId('complaints-unknown-department');
    expect(notice.textContent).toContain('Garbage (“Sanitation Services”)');
    expect(notice.textContent).toContain('Edit each one and pick its department from the list.');
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeDisabled();
  });
});

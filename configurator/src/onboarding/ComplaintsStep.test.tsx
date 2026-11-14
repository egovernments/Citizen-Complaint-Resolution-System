import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, MdmsRecord } from '@/api/types';
import ComplaintsStep from './ComplaintsStep';
import { loadComplaints, type LoadedComplaints } from './complaints/complaintsApi';
import { listMasters } from './departments/mastersApi';
import { listEmployees } from './employees/employeesApi';

const app = { state: { tenant: 'acme', completedPhases: [] as number[] }, completePhase: vi.fn(async () => true) };
vi.mock('@/App', () => ({ useApp: () => app }));
vi.mock('@/components/ComplaintHierarchySetup', () => ({ ComplaintHierarchySetup: () => null }));
vi.mock('./complaints/complaintsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./complaints/complaintsApi')>()),
  loadComplaints: vi.fn(),
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
  data: { code, name, active: true },
  isActive: true,
});

/** E002, a GRO whose one assignment is in ROADS. */
const e002 = {
  code: 'E002',
  tenantId: 'acme',
  user: { name: 'E002', active: true, roles: [{ code: 'GRO', tenantId: 'acme' }] },
  assignments: [{ department: 'ROADS', designation: 'GRO_OFF', isCurrentAssignment: true }],
} as unknown as Employee;

const potholes: LoadedComplaints = {
  editable: true,
  hasDefinition: true,
  records: [],
  draft: { slaHours: 72, types: [{ code: 'Potholes', name: 'Potholes', department: 'ROADS', subtypes: [] }] },
};

const page = () =>
  render(
    <MemoryRouter>
      <ComplaintsStep />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(loadComplaints).mockResolvedValue(potholes);
  vi.mocked(listEmployees).mockResolvedValue({ active: [e002], codes: ['E002'] });
});

describe('ComplaintsStep with a removed department (#2797)', () => {
  it('names what still uses it and keeps Finish setup off', async () => {
    vi.mocked(listMasters).mockResolvedValue([department('WATER', 'Water')]);
    page();
    expect(
      await screen.findByText(/Setup can’t finish yet\. A department that was removed \(ROADS\) is still used by 1 employee \(E002\) and 1 complaint category \(Potholes\)\./),
    ).toBeTruthy();
    expect(screen.getByText(/add it again in Departments with the same code/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finish setup' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Fix the removed department above to finish.')).toBeTruthy();
  });

  it('finishes normally once the department is back', async () => {
    vi.mocked(listMasters).mockResolvedValue([department('ROADS', 'Roads')]);
    page();
    expect(await screen.findByText('Handled by Roads')).toBeTruthy();
    expect(screen.queryByText(/A department that was removed/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish setup' })).toHaveProperty('disabled', false);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { Employee } from '@/api/types';
import { hrmsService } from '@/api';
import { employeesByCode, type EmployeeRecord } from '@/onboarding/employees/employeesApi';
import { EmployeeBulkImport } from './EmployeeBulkImport';

vi.mock('@/App', () => ({ useApp: () => ({ state: { tenant: 'acme' } }) }));
vi.mock('ra-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ra-core')>()),
  useGetList: () => ({ data: [] }),
}));
vi.mock('@/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api')>();
  return {
    ...actual,
    mdmsService: {
      getDepartments: vi.fn(async () => [{ code: 'ROADS', name: 'Roads' }, { code: 'WATER', name: 'Water' }]),
      getDesignations: vi.fn(async () => [{ code: 'ENGINEER', name: 'Engineer' }]),
      getRoles: vi.fn(async () => [{ code: 'EMPLOYEE', name: 'Employee' }, { code: 'GRO', name: 'GRO' }]),
      getMobileValidation: vi.fn(async () => null),
    },
    boundaryService: {
      searchBoundaries: vi.fn(async () => [{ code: 'WARD_1', name: 'Ward 1', boundaryType: 'Ward', hierarchyType: 'ADMIN' }]),
    },
    hrmsService: { ...actual.hrmsService, createEmployee: vi.fn(async (employee: Employee) => employee) },
  };
});
vi.mock('@/api/services/tenantHierarchy', () => ({ loadTenantHierarchies: vi.fn(async () => ({ hierarchyType: 'ADMIN' })) }));
vi.mock('@/onboarding/employees/employeesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/onboarding/employees/employeesApi')>()),
  employeesByCode: vi.fn(),
}));

const create = vi.mocked(hrmsService.createEmployee);
const existing = vi.mocked(employeesByCode);

const HEADER = ['employeeCode', 'name', 'mobileNumber', 'emailId', 'department', 'designation', 'roles', 'jurisdictions'];
const ROWS = [
  ['E001', 'Jane Kamau', '712345678', 'jane@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 2: new
  ['EMP_001', 'Sample Person', '', 'sample@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 3: no mobile
  ['E002', 'John Otieno', '712345677', 'grace@example.org', 'WATER', 'ENGINEER', 'EMPLOYEE,GRO', 'WARD_1'], // row 4: Grace's code and email
  ['E003', 'Peter Mwangi', '712345676', 'peter@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 5: added on an earlier run
  ['', 'Lucy Njeri', '712000004', 'lucy@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 6: the same, without a code
];

const record = (code: string, name: string, mobileNumber: string, emailId: string): EmployeeRecord =>
  ({
    code,
    tenantId: 'acme',
    isActive: true,
    user: { name, mobileNumber, emailId, roles: [{ code: 'EMPLOYEE' }, { code: 'CSR' }] },
    assignments: [{ department: 'ROADS', designation: 'ENGINEER', isCurrentAssignment: true }],
    jurisdictions: [{ boundary: 'WARD_1', isActive: true }],
  }) as unknown as EmployeeRecord;

const page = async () => {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <EmployeeBulkImport />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  // The reference counts show "…" until departments, roles and boundaries are in.
  await waitFor(() => expect(screen.queryByText('…')).toBeNull());
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...ROWS]), 'Employee');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const file = new File([bytes], 'staff.xlsx');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes });
  fireEvent.change(document.getElementById('bulk-file-input') as HTMLInputElement, { target: { files: [file] } });
};

beforeEach(() => {
  vi.clearAllMocks();
  existing.mockResolvedValue(
    new Map([
      ['E002', record('E002', 'Grace Wanjiru', '711000002', 'grace@example.org')],
      ['E003', record('E003', 'Peter Mwangi', '712345676', 'peter@example.org')],
      ['EMP_0004', record('EMP_0004', 'Lucy Njeri', '712000004', 'lucy@example.org')],
    ]),
  );
});

describe('management bulk employee import, as onboarding’s (#2798, #2799, #2800)', () => {
  it('shows every sheet row: refused rows by row with their reasons, employees already added as such', async () => {
    await page();
    await screen.findByText('Total: 5');
    expect(screen.getByText('1 valid')).toBeTruthy();
    expect(screen.getByText('2 already added')).toBeTruthy();
    expect(screen.getAllByText('Already added')).toHaveLength(2);
    expect(screen.getByText('2 with errors')).toBeTruthy();
    expect(screen.getByText('Row 3 (Sample Person): Mobile number is required')).toBeTruthy();
    expect(screen.getByText('Row 4 (John Otieno): E002 already exists. Edit them in the employee list, or remove this row.')).toBeTruthy();
  });

  it('creates only the new row and says how many were already added', async () => {
    await page();
    fireEvent.click(await screen.findByRole('button', { name: 'Create 1 employee' }));
    await screen.findByText('Created 1 employees');
    expect(create.mock.calls.map(([employee]) => employee.code)).toEqual(['E001']);
    expect(screen.getByText(/2 row\(s\) already added, so skipped\. 2 row\(s\) skipped for validation errors\./)).toBeTruthy();
  });

  it('stops when it can’t tell who is already added, rather than checking against nobody (#2798)', async () => {
    existing.mockRejectedValue(new Error('network'));
    await page();
    await screen.findByText(/Couldn’t check which employees you’ve already added/);
    expect(screen.queryByText(/Total:/)).toBeNull();
  });
});

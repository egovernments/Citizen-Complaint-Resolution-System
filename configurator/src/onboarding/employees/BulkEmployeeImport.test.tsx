import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { Employee } from '@/api/types';
import { hrmsService } from '@/api';
import BulkEmployeeImport from './BulkEmployeeImport';
import { employeesByCode, type EmployeeRecord } from './employeesApi';

const app = { state: { tenant: 'acme', targetTenant: 'acme' }, addUndo: vi.fn() };
vi.mock('@/App', () => ({ useApp: () => app }));

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
    hrmsService: { ...actual.hrmsService, createEmployee: vi.fn() },
  };
});
vi.mock('@/api/services/tenantHierarchy', () => ({ loadTenantHierarchies: vi.fn(async () => ({ hierarchyType: 'ADMIN' })) }));
vi.mock('./employeesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./employeesApi')>()),
  employeesByCode: vi.fn(),
}));
vi.mock('../telemetry', () => ({ reportStepError: vi.fn(), trackImport: vi.fn(), trackTemplateDownload: vi.fn(), trackUploadRefused: vi.fn() }));

const create = vi.mocked(hrmsService.createEmployee);
const existing = vi.mocked(employeesByCode);

const HEADER = ['employeeCode', 'name', 'mobileNumber', 'emailId', 'department', 'designation', 'roles', 'jurisdictions'];
const ROWS = [
  ['E001', 'Jane Kamau', '712345678', 'jane@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 2: new
  ['EMP_001', 'Sample Person', '', 'sample@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 3: the template's sample, no mobile (E-4)
  ['E004', 'Ali Hassan', '712345679', 'ali@example.org', '', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 4: no department (E-5)
  ['E002', 'John Otieno', '712345677', 'grace@example.org', 'WATER', 'ENGINEER', 'EMPLOYEE,GRO', 'WARD_1'], // row 5: Grace's code and email (E-2)
  ['E003', 'Peter Mwangi', '712345676', 'peter@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'Ward 1'], // row 6: added on an earlier run (E-3)
  ['E005', 'Mary Atieno', '712345680', 'mary@example.org', 'ROADS', 'ENGINEER', 'EMPLOYEE', 'WARD_1'], // row 7: mobile taken at create
];

const record = (code: string, name: string, mobileNumber: string, emailId: string, department: string): EmployeeRecord =>
  ({
    code,
    tenantId: 'acme',
    isActive: true,
    user: { name, mobileNumber, emailId, roles: [{ code: 'EMPLOYEE' }, { code: 'CSR' }] },
    assignments: [{ department, designation: 'ENGINEER', isCurrentAssignment: true }],
    jurisdictions: [{ boundary: 'WARD_1', isActive: true }],
  }) as unknown as EmployeeRecord;

const upload = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADER, ...ROWS]), 'Employee');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const input = document.getElementById('employee-file-upload') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([bytes], 'staff.xlsx')] } });
};

const page = async () => {
  render(<BulkEmployeeImport onDone={vi.fn()} onCancel={vi.fn()} />);
  await waitFor(() => expect((document.getElementById('employee-file-upload') as HTMLInputElement).disabled).toBe(false));
  upload();
  await screen.findByText(/Summary: 6 total/);
};

beforeEach(() => {
  vi.clearAllMocks();
  existing.mockResolvedValue(
    new Map([
      ['E002', record('E002', 'Grace Wanjiru', '711000002', 'grace@example.org', 'ROADS')],
      ['E003', record('E003', 'Peter Mwangi', '712345676', 'peter@example.org', 'ROADS')],
    ]),
  );
  create.mockImplementation(async (employee: Employee) => {
    if (employee.code === 'E005') throw new Error('Mobile "712345680" already exists on tenant acme');
    return employee;
  });
});

describe('employee sheet preview and results', () => {
  it('shows every sheet row: blank cells and existing codes as errors by row, an earlier run’s row as already added (#2798, #2799, #2800)', async () => {
    await page();
    expect(screen.getByText('Row 3: Mobile number is required')).toBeTruthy();
    expect(screen.getByText('Row 4: Department is required')).toBeTruthy();
    expect(screen.getByText('Row 5: E002 already exists. Edit them in the employee list, or remove this row.')).toBeTruthy();
    expect(screen.getByText('1 already added (skipped)')).toBeTruthy();
    expect(screen.getAllByText('Already added')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Create 2 Employees/ })).toBeTruthy();
  });

  it('creates only the valid rows and says what is left to fix, by row, in words (#2799)', async () => {
    await page();
    fireEvent.click(screen.getByRole('button', { name: /Create 2 Employees/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/1 row\(s\) are employees you’ve already added/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Create 2 Employees/ }));

    await screen.findByText('Created 1, 1 failed');
    expect(create.mock.calls.map(([employee]) => employee.code)).toEqual(['E001', 'E005']);
    const counts = (label: string) => screen.getByText(label).closest('tr')?.textContent;
    expect(counts('✓ Created')).toBe('✓ Created1');
    expect(counts('⏭️ Already added (skipped)')).toBe('⏭️ Already added (skipped)1');
    expect(counts('✗ Failed')).toBe('✗ Failed1');
    expect(screen.getByText('Rows still to fix:')).toBeTruthy();
    expect(
      screen.getByText('Row 7 (Mary Atieno): Mobile number 712345680 is already used by another employee. Use a different number.'),
    ).toBeTruthy();
    expect(screen.getByText('Row 3: Mobile number is required')).toBeTruthy();
    expect(screen.getByText('Row 5: E002 already exists. Edit them in the employee list, or remove this row.')).toBeTruthy();
  });

  it('stops when it can’t tell who is already added, rather than counting them as created (#2798)', async () => {
    existing.mockRejectedValue(new Error('network'));
    render(<BulkEmployeeImport onDone={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect((document.getElementById('employee-file-upload') as HTMLInputElement).disabled).toBe(false));
    upload();
    await screen.findByText(/Couldn’t check which employees you’ve already added/);
    expect(screen.queryByText(/Summary:/)).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hrmsService } from '@/api';
import type { Employee } from '@/api/types';
import { addEmployee, listEmployees, removeEmployee, suggestEmployeeCode, type EmployeeOptions } from './employeesApi';

vi.mock('@/api', () => ({
  mdmsService: {},
  boundaryService: {},
  hrmsService: {
    searchEmployees: vi.fn(),
    checkUsernameAvailable: vi.fn(),
    createEmployee: vi.fn(async (employee) => employee),
    updateEmployee: vi.fn(async (employee) => employee),
    // The real helpers, so the test covers the payload actually sent.
    generateEmployeeCode: (prefix: string, index: number) => `${prefix}_${String(index).padStart(4, '0')}`,
    generateUsername: (name: string) =>
      name.toLowerCase().replace(/[^a-z0-9]/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, ''),
    buildEmployee: vi.fn((data) => ({ built: true, ...data })),
  },
}));
vi.mock('../departments/mastersApi', () => ({ listMasters: vi.fn(), recordName: vi.fn(), recordDepartments: vi.fn() }));

const hrms = vi.mocked(hrmsService);

const options: EmployeeOptions = {
  departments: [{ code: 'ROADS', name: 'Roads' }],
  designations: [{ code: 'ENGINEER', name: 'Engineer', departments: [] }],
  roles: [
    { code: 'EMPLOYEE', name: 'Employee' },
    { code: 'GRO', name: 'Grievance Routing Officer' },
  ],
  boundaries: [{ code: 'WARD_1', name: 'Ward 1', boundaryType: 'Ward', hierarchyType: 'ADMIN', depth: 2 }],
  mobilePattern: /^\d{10}$/,
};

const employee = (code: string, extra: Partial<Employee> = {}) => ({ code, ...extra }) as Employee;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('suggestEmployeeCode', () => {
  it('suggests one past the highest EMP_ code', () => {
    expect(suggestEmployeeCode([])).toBe('EMP_0001');
    expect(suggestEmployeeCode(['ADMIN', 'EMP_0001'])).toBe('EMP_0002');
    // Never fills a gap: EMP_0002 may belong to someone removed
    expect(suggestEmployeeCode(['EMP_0001', 'EMP_0003'])).toBe('EMP_0004');
  });
});

describe('listEmployees', () => {
  it('lists active employees but keeps every code HRMS holds', async () => {
    hrms.searchEmployees.mockResolvedValue([employee('EMP_0001'), { ...employee('EMP_0003'), isActive: false } as Employee]);
    const list = await listEmployees('acme');
    expect(list.active.map((e) => e.code)).toEqual(['EMP_0001']);
    expect(list.codes).toEqual(['EMP_0001', 'EMP_0003']);
    // Removing the highest (EMP_0003) doesn't hand its code out again.
    expect(suggestEmployeeCode(list.codes)).toBe('EMP_0004');
  });
});

describe('addEmployee', () => {
  it('builds the HRMS payload from the dialog', async () => {
    hrms.checkUsernameAvailable.mockResolvedValue(true);
    await addEmployee(
      'acme',
      {
        code: 'EMP_0001',
        name: ' Anita Wanjiru ',
        mobileNumber: '9876543210',
        emailId: '',
        departments: ['ROADS', 'PARKS'],
        designation: 'ENGINEER',
        roles: ['EMPLOYEE', 'GRO'],
        jurisdictions: ['WARD_1'],
      },
      options,
    );
    expect(hrms.buildEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'acme',
        code: 'EMP_0001',
        name: 'Anita Wanjiru',
        userName: 'anita.wanjiru',
        emailId: undefined,
        department: 'ROADS,PARKS',
        designation: 'ENGINEER',
        roles: [
          { code: 'EMPLOYEE', name: 'Employee' },
          { code: 'GRO', name: 'Grievance Routing Officer' },
        ],
        jurisdictions: [{ boundary: 'WARD_1', boundaryType: 'Ward', hierarchyType: 'ADMIN' }],
      }),
    );
    expect(hrms.createEmployee).toHaveBeenCalled();
  });

  it('adds the code to a username someone already has', async () => {
    hrms.checkUsernameAvailable.mockResolvedValue(false);
    await addEmployee(
      'acme',
      { code: 'EMP_0007', name: 'Anita Wanjiru', mobileNumber: '9876543210', departments: ['ROADS'], designation: 'ENGINEER', roles: ['EMPLOYEE'], jurisdictions: ['WARD_1'] },
      options,
    );
    expect(hrms.buildEmployee).toHaveBeenCalledWith(expect.objectContaining({ userName: 'anita.wanjiru.emp_0007' }));
  });
});

describe('removeEmployee', () => {
  it('deactivates with a reason, as management does', async () => {
    await removeEmployee(employee('A'));
    expect(hrms.updateEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'A',
        isActive: false,
        deactivationDetails: [expect.objectContaining({ reasonForDeactivation: 'OTHERS' })],
      }),
    );
  });
});

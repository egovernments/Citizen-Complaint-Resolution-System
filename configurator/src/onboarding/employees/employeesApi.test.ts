vi.mock('@/identity/api', () => ({ removeMember: vi.fn(async () => ({})), updateMemberEmail: vi.fn(async () => ({ status: 'verification_sent' })) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hrmsService } from '@/api';
import type { Employee } from '@/api/types';
import { updateMemberEmail } from '@/identity/api';
import {
  addEmployee,
  applyEmployeeChanges,
  listEmployees,
  removeEmployee,
  suggestEmployeeCode,
  updateEmployeeDetails,
  type EmployeeChanges,
  type EmployeeOptions,
} from './employeesApi';

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

const employee = (code: string, extra: Partial<Employee> = {}) => ({ code, tenantId: 'acme', uuid: code, user: { uuid: code }, ...extra }) as Employee;

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
        emailId: 'anita@example.org',
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
        emailId: 'anita@example.org',
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
      { code: 'EMP_0007', name: 'Anita Wanjiru', emailId: 'anita@example.org', mobileNumber: '9876543210', departments: ['ROADS'], designation: 'ENGINEER', roles: ['EMPLOYEE'], jurisdictions: ['WARD_1'] },
      options,
    );
    expect(hrms.buildEmployee).toHaveBeenCalledWith(expect.objectContaining({ userName: 'anita.wanjiru.emp_0007' }));
  });
});

describe('removeEmployee', () => {
  it('deactivates with a reason, as management does', async () => {
    hrms.searchEmployees.mockResolvedValue([employee('A')]);
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

describe('editing an employee', () => {
  const fresh = (): Employee =>
    ({
      id: 41,
      code: 'EMP_0002',
      tenantId: 'acme',
      uuid: 'u-2',
      reActivateEmployee: null,
      user: {
        uuid: 'u-2',
        name: 'Anita',
        mobileNumber: '0700000001',
        emailId: 'anita@example.org',
        password: 'should-not-travel',
        roles: [
          { code: 'EMPLOYEE', name: 'Employee', tenantId: 'acme' },
          { code: 'DGRO', name: 'DGRO', tenantId: 'acme' },
          { code: 'ACCOUNT_ADMIN', name: 'Admin', tenantId: 'acme' },
          { code: 'GRO', name: 'GRO', tenantId: 'acme.city' },
        ],
      },
      assignments: [
        { id: 'a-old', department: 'WATER', designation: 'ENGINEER', fromDate: 1, toDate: 2, isCurrentAssignment: false },
        { id: 'a-now', department: 'WATER', designation: 'ENGINEER', fromDate: 3, isCurrentAssignment: true },
      ],
      jurisdictions: [
        { id: 'j-1', boundary: 'WARD_1', boundaryType: 'Ward', hierarchyType: 'ADMIN', isActive: true },
        { id: 'j-2', boundary: 'WARD_9', boundaryType: 'Ward', hierarchyType: 'ADMIN', isActive: true },
      ],
    }) as unknown as Employee;
  const changes: EmployeeChanges = {
    name: ' Anita W. ',
    mobileNumber: '0700000002',
    emailId: 'anita@example.org',
    department: 'ROADS',
    designation: 'ENGINEER',
    roles: ['EMPLOYEE', 'GRO'],
    jurisdictions: ['WARD_1', 'WARD_NEW'],
  };
  const withNewWard: EmployeeOptions = {
    ...options,
    boundaries: [...options.boundaries, { code: 'WARD_NEW', name: 'New ward', boundaryType: 'Ward', hierarchyType: 'ADMIN', depth: 2 }],
  };

  it('replaces only the roles the step offers and keeps the rest', () => {
    const roles = applyEmployeeChanges(fresh(), changes, options).user.roles.map((role) => `${role.code}@${role.tenantId}`);
    expect(roles).toEqual(['DGRO@acme', 'ACCOUNT_ADMIN@acme', 'GRO@acme.city', 'EMPLOYEE@acme', 'GRO@acme']);
  });

  it('moves the current assignment and leaves earlier ones as they were', () => {
    const { assignments } = applyEmployeeChanges(fresh(), changes, options);
    expect(assignments).toEqual([
      { id: 'a-old', department: 'WATER', designation: 'ENGINEER', fromDate: 1, toDate: 2, isCurrentAssignment: false },
      { id: 'a-now', department: 'ROADS', designation: 'ENGINEER', fromDate: 3, isCurrentAssignment: true },
    ]);
  });

  it('switches off a dropped jurisdiction and adds a new one', () => {
    const { jurisdictions } = applyEmployeeChanges(fresh(), changes, withNewWard);
    expect(jurisdictions.map((item) => [item.boundary, item.isActive])).toEqual([
      ['WARD_1', true],
      ['WARD_9', false],
      ['WARD_NEW', true],
    ]);
    expect(jurisdictions[2]).toMatchObject({ boundaryType: 'Ward', hierarchyType: 'ADMIN', hierarchy: 'ADMIN' });
  });

  it('keeps the record ids, trims the name and never sends the password', () => {
    const updated = applyEmployeeChanges(fresh(), changes, options) as Employee & { reActivateEmployee: boolean };
    expect(updated.id).toBe(41);
    expect(updated.user.name).toBe('Anita W.');
    expect(updated.user.mobileNumber).toBe('0700000002');
    expect('password' in updated.user).toBe(false);
    expect(updated.reActivateEmployee).toBe(false);
  });

  it('confirms a new email through the workspace members API, and not an unchanged one', async () => {
    hrms.searchEmployees.mockResolvedValue([fresh()]);
    expect(await updateEmployeeDetails(fresh(), changes, options)).toEqual({ emailChanged: false });
    expect(updateMemberEmail).not.toHaveBeenCalled();

    expect(await updateEmployeeDetails(fresh(), { ...changes, emailId: 'New@Example.org' }, options)).toEqual({ emailChanged: true });
    expect(updateMemberEmail).toHaveBeenCalledWith('acme', 'u-2', 'new@example.org');
    expect(hrms.updateEmployee).toHaveBeenCalledTimes(2);
  });
});

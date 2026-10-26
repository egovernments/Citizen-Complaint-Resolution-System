vi.mock('@/identity/api', () => ({
  removeMember: vi.fn(async () => ({})),
  linkMember: vi.fn(async () => ({ binding: { state: 'pending' } })),
  updateMemberEmail: vi.fn(async () => ({ status: 'verification_sent' })),
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { parseEmployeeExcel } from '@/utils/excelParser';
import { hrmsService } from '@/api';
import type { Employee } from '@/api/types';
import { linkMember, removeMember, updateMemberEmail } from '@/identity/api';
import {
  addEmployee,
  applyEmployeeChanges,
  codeProblem,
  listEmployees,
  removeEmployee,
  suggestEmployeeCode,
  updateEmployeeDetails,
  withEmployeeCodes,
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

describe('bulk import codes, through the real parser (#2456)', () => {
  const sheet = (rows: Record<string, string>[]) => {
    const wb = XLSX.utils.book_new();
    const base = { name: 'Jane Kamau', mobileNumber: '712345678', department: 'ROADS', designation: 'ENGINEER' };
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((row) => ({ ...base, ...row }))), 'Employee');
    const { data, validation } = parseEmployeeExcel(wb);
    expect(validation.errors).toEqual([]);
    return data;
  };
  // The founder holds EMP_0001; EMP_0007 belongs to someone removed.
  const hrms = new Map([
    ['EMP_0001', { ...employee('EMP_0001'), user: { name: 'Anita Wanjiru', emailId: 'Anita@Example.org' } } as unknown as Employee],
    ['EMP_0007', employee('EMP_0007', { isActive: false })],
  ]);
  const check = (rows: ReturnType<typeof sheet>) => {
    const planned = withEmployeeCodes(rows, hrms);
    return planned.map((row) => ({ code: row.employeeCode, problem: codeProblem(row, planned, hrms) }));
  };

  it('gives a code-less row the next free code past HRMS and the sheet', () => {
    expect(check(sheet([{ emailId: 'a@example.org' }, { employeeCode: 'EMP_0010', emailId: 'b@example.org' }, { emailId: 'c@example.org' }]))).toEqual([
      { code: 'EMP_0011', problem: null },
      { code: 'EMP_0010', problem: null },
      { code: 'EMP_0012', problem: null },
    ]);
  });

  it('flags a given code HRMS holds for someone else', () => {
    expect(check(sheet([{ employeeCode: 'EMP_0001', emailId: 'joseph@example.org' }]))).toEqual([
      { code: 'EMP_0001', problem: { takenBy: 'Anita Wanjiru' } },
    ]);
  });

  it('lets the same person through on their own code (email trimmed, any case)', () => {
    expect(check(sheet([{ employeeCode: 'EMP_0001', emailId: ' anita@example.ORG ' }]))).toEqual([{ code: 'EMP_0001', problem: null }]);
  });

  it('flags a code on two rows of the sheet', () => {
    expect(check(sheet([{ employeeCode: 'EMP_0020', emailId: 'a@example.org' }, { employeeCode: 'EMP_0020', emailId: 'b@example.org' }]))
      .map((row) => row.problem)).toEqual([{ repeated: true }, { repeated: true }]);
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
    await addEmployee(
      'acme',
      {
        code: 'EMP_0001',
        name: ' Anita Wanjiru ',
        mobileNumber: '9876543210',
        emailId: 'anita@example.org',
        department: 'ROADS',
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
        userName: 'EMP_0001',
        emailId: 'anita@example.org',
        department: 'ROADS',
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

  // One department, one current assignment: no comma list for buildEmployee to turn into one-day past rows (#2649).
  it('sends a single department, never a list', async () => {
    await addEmployee(
      'acme',
      { code: 'EMP_0002', name: 'Joy', emailId: 'joy@example.org', mobileNumber: '9876543210', department: 'PARKS', designation: 'ENGINEER', roles: ['EMPLOYEE'], jurisdictions: ['WARD_1'] },
      options,
    );
    expect(vi.mocked(hrms.buildEmployee).mock.calls.at(-1)?.[0].department).toBe('PARKS');
  });

  // HRMS makes every employee's username their code, so there is no name to check (#2456).
  it('sends the code as the username without a username look-up', async () => {
    await addEmployee(
      'acme',
      { code: 'EMP_0007', name: 'Anita Wanjiru', emailId: 'anita@example.org', mobileNumber: '9876543210', department: 'ROADS', designation: 'ENGINEER', roles: ['EMPLOYEE'], jurisdictions: ['WARD_1'] },
      options,
    );
    expect(hrms.buildEmployee).toHaveBeenCalledWith(expect.objectContaining({ userName: 'EMP_0007' }));
    expect(hrms.checkUsernameAvailable).not.toHaveBeenCalled();
  });
});

describe('removeEmployee', () => {
  it('never deactivates another workspace\'s employee with the same code (#2456)', async () => {
    hrms.searchEmployees.mockResolvedValue([employee('A', { tenantId: 'other', uuid: 'theirs' }), employee('A')]);
    await removeEmployee(employee('A'));
    expect(hrms.searchEmployees).toHaveBeenCalledWith('acme', { uuids: ['A'] });
    expect(hrms.updateEmployee).toHaveBeenCalledTimes(1);
    expect(hrms.updateEmployee).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'acme', uuid: 'A' }));
  });

  it('removes an employee that carries only the user\'s uuid', async () => {
    const userOnly = { code: 'A', tenantId: 'acme', user: { uuid: 'u-1' } } as Employee;
    hrms.searchEmployees.mockResolvedValue([userOnly]);
    await removeEmployee(userOnly);
    expect(hrms.searchEmployees).toHaveBeenCalledWith('acme', { uuids: ['u-1'] });
    expect(hrms.updateEmployee).toHaveBeenCalledWith(expect.objectContaining({ code: 'A', isActive: false }));
  });

  it('says so, and asks HRMS nothing, for an employee with no uuid', async () => {
    await expect(removeEmployee({ code: 'A', tenantId: 'acme', user: {} } as Employee)).rejects.toThrow(/account identifier/);
    expect(hrms.searchEmployees).not.toHaveBeenCalled();
    expect(hrms.updateEmployee).not.toHaveBeenCalled();
  });

  it('refuses when only another workspace has the code (#2456)', async () => {
    hrms.searchEmployees.mockResolvedValue([employee('A', { tenantId: 'other', uuid: 'theirs' })]);
    await expect(removeEmployee(employee('A'))).rejects.toThrow();
    expect(hrms.updateEmployee).not.toHaveBeenCalled();
  });

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

  it('never updates another workspace\'s employee with the same code (#2456)', async () => {
    const theirs = { ...fresh(), tenantId: 'other', uuid: 'theirs', user: { ...fresh().user, uuid: 'theirs' } } as Employee;
    hrms.searchEmployees.mockResolvedValue([theirs, fresh()]);
    await updateEmployeeDetails(fresh(), changes, options, { kind: 'active' });
    expect(hrms.updateEmployee).toHaveBeenCalledTimes(1);
    expect(hrms.updateEmployee).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'acme', uuid: 'u-2' }));

    hrms.searchEmployees.mockResolvedValue([theirs]);
    await expect(updateEmployeeDetails(fresh(), changes, options, { kind: 'active' })).rejects.toThrow();
    expect(hrms.updateEmployee).toHaveBeenCalledTimes(1);
  });

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

  const sentEmail = () => (hrms.updateEmployee.mock.lastCall![0] as Employee).user.emailId;
  const newEmail = { ...changes, emailId: 'New@Example.org' };

  it('confirms a joined member’s new email by a link and leaves HRMS on the old one', async () => {
    hrms.searchEmployees.mockResolvedValue([fresh()]);
    expect(await updateEmployeeDetails(fresh(), changes, options, { kind: 'active' })).toEqual({ email: 'unchanged' });
    expect(updateMemberEmail).not.toHaveBeenCalled();

    expect(await updateEmployeeDetails(fresh(), newEmail, options, { kind: 'active' })).toEqual({ email: 'verification_sent' });
    expect(updateMemberEmail).toHaveBeenCalledWith('acme', 'u-2', 'new@example.org');
    expect(sentEmail()).toBe('anita@example.org');
    expect(hrms.updateEmployee).toHaveBeenCalledTimes(2);
  });

  it('treats an unknown sign-in state as joined', async () => {
    hrms.searchEmployees.mockResolvedValue([fresh()]);
    expect(await updateEmployeeDetails(fresh(), newEmail, options, null)).toEqual({ email: 'verification_sent' });
    expect(updateMemberEmail).toHaveBeenCalledWith('acme', 'u-2', 'new@example.org');
  });

  it('moves a pending invitation to the new email: HRMS first, then withdraw and invite again', async () => {
    hrms.searchEmployees.mockResolvedValue([fresh()]);
    expect(await updateEmployeeDetails(fresh(), newEmail, options, { kind: 'invited' })).toEqual({ email: 'invited' });
    expect(sentEmail()).toBe('new@example.org');
    expect(removeMember).toHaveBeenCalledWith('acme', 'u-2');
    expect(linkMember).toHaveBeenCalledWith('acme', 'u-2', 'new@example.org', true);
    expect(hrms.updateEmployee.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(removeMember).mock.invocationCallOrder[0]);
    expect(vi.mocked(removeMember).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(linkMember).mock.invocationCallOrder[0]);
    expect(updateMemberEmail).not.toHaveBeenCalled();
  });

  it('still moves an invitation left at the old address when HRMS already has the new one', async () => {
    hrms.searchEmployees.mockResolvedValue([fresh()]);
    expect(await updateEmployeeDetails(fresh(), changes, options, { kind: 'invited', email: 'old@example.org' })).toEqual({ email: 'invited' });
    expect(linkMember).toHaveBeenCalledWith('acme', 'u-2', 'anita@example.org', true);
  });

  it('says what to do when the new invitation fails after the old one was withdrawn', async () => {
    hrms.searchEmployees.mockResolvedValue([fresh()]);
    vi.mocked(linkMember).mockRejectedValueOnce(new Error('Keycloak down'));
    await expect(updateEmployeeDetails(fresh(), newEmail, options, { kind: 'invited' })).rejects.toThrow(/Use Invite again.*Keycloak down/);
  });

  it.each(['none', 'expired', 'removed'] as const)('only saves the email on the record when the state is %s', async (kind) => {
    hrms.searchEmployees.mockResolvedValue([fresh()]);
    expect(await updateEmployeeDetails(fresh(), newEmail, options, { kind })).toEqual({ email: 'saved' });
    expect(sentEmail()).toBe('new@example.org');
    expect(updateMemberEmail).not.toHaveBeenCalled();
    expect(removeMember).not.toHaveBeenCalled();
    expect(linkMember).not.toHaveBeenCalled();
  });
});

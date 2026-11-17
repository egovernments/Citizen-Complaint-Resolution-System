import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, hrmsService, mdmsService } from '@/api';
import type { Employee, MdmsRecord } from '@/api/types';
import {
  categoryRoutes,
  checkRemovable,
  describeUses,
  findUses,
  hasUses,
  inUseMessage,
  loadDepartmentUses,
} from './departmentUsage';
import { EMPLOYEE_PAGE } from '../employees/employeesApi';
import { describeSaveError } from '../errors';
import { reportStepError } from '../telemetry';

vi.mock('@/api', () => ({
  MDMS_SCHEMAS: { DEPARTMENT: 'common-masters.Department', DESIGNATION: 'common-masters.Designation' },
  mdmsService: { searchRecords: vi.fn() },
  hrmsService: { searchEmployees: vi.fn() },
  localizationService: {},
  ApiClientError: class extends Error {
    errors: { code: string; message: string }[];
    statusCode: number;
    constructor(errors: { code: string; message: string }[], statusCode: number) {
      super(errors.map((error) => error.message).join(', '));
      this.errors = errors;
      this.statusCode = statusCode;
    }
  },
}));
vi.mock('../telemetry', () => ({ reportStepError: vi.fn() }));

const search = vi.mocked(mdmsService.searchRecords);
const employeesSearch = vi.mocked(hrmsService.searchEmployees);

const employee = (code: string, name: string, departments: [string, boolean][], over: Partial<Employee> = {}): Employee =>
  ({
    code,
    tenantId: 'acme',
    user: { name },
    assignments: departments.map(([department, isCurrentAssignment]) => ({ department, designation: 'GRO_OFF', isCurrentAssignment })),
    ...over,
  }) as unknown as Employee;

const record = (schemaCode: string, uniqueIdentifier: string, data: Record<string, unknown>, over: Partial<MdmsRecord> = {}): MdmsRecord => ({
  id: uniqueIdentifier,
  tenantId: 'acme',
  schemaCode,
  uniqueIdentifier,
  data,
  isActive: true,
  ...over,
});

describe('findUses', () => {
  const sources = {
    employees: [
      employee('E002', 'Amina', [['ROADS', true]]),
      employee('E003', 'Brian', [['WATER', true], ['ROADS', false]]),
      employee('E004', 'Chen', [['WATER', true]]),
    ],
    designations: [
      { name: 'Engineer', departments: ['ROADS', 'WATER'] },
      { name: 'Clerk', departments: ['WATER'] },
    ],
    categories: [
      { name: 'Potholes', department: 'ROADS' },
      { name: 'Leak', department: 'WATER' },
    ],
  };

  it('names every employee, designation and category on the department', () => {
    const uses = findUses((department) => department === 'ROADS', sources);
    // Brian's past assignment counts: HRMS checks it on each save.
    expect(uses).toEqual({ employees: ['Amina', 'Brian'], designations: ['Engineer'], categories: ['Potholes'], departments: ['ROADS'] });
    expect(hasUses(uses)).toBe(true);
  });

  it('finds nothing for a department no one uses', () => {
    const uses = findUses((department) => department === 'PARKS', sources);
    expect(hasUses(uses)).toBe(false);
    expect(uses.departments).toEqual([]);
  });

  it('reports which removed departments are still named', () => {
    const live = new Set(['WATER']);
    const uses = findUses((department) => !live.has(department), { ...sources, designations: [] });
    expect(uses.departments).toEqual(['ROADS']);
    expect(uses.categories).toEqual(['Potholes']);
  });
});

describe('the in-use message', () => {
  it('says what uses the department and what to do', () => {
    expect(inUseMessage('Roads', { employees: ['Amina'], designations: [], categories: ['Potholes'] })).toBe(
      'Roads can’t be removed: it’s used by 1 employee (Amina) and 1 complaint category (Potholes). Move them to another department first.',
    );
  });

  it('counts plurals and shortens long lists', () => {
    expect(
      describeUses({ employees: ['A', 'B', 'C', 'D', 'E'], designations: ['Engineer'], categories: ['Potholes', 'Cracks'] }),
    ).toBe('5 employees (A, B, C and 2 more), 1 designation (Engineer) and 2 complaint categories (Potholes, Cracks)');
  });
});

describe('categoryRoutes', () => {
  it("keeps the workspace's own active rows that route somewhere", () => {
    const rows = [
      record('h', 'PGR.Potholes', { code: 'Potholes', name: 'Potholes', department: 'ROADS' }),
      record('h', 'PGR.Roads', { code: 'Roads', name: 'Roads' }),
      record('h', 'PGR.Old', { code: 'Old', name: 'Old', department: 'ROADS' }, { isActive: false }),
      record('h', 'PGR.Off', { code: 'Off', department: 'ROADS', active: false }),
      record('h', 'PGR.State', { code: 'State', department: 'ROADS' }, { tenantId: 'ke' }),
      record('h', 'PGR.NoName', { code: 'NoName', department: 'ROADS' }),
    ];
    expect(categoryRoutes(rows, 'acme')).toEqual([
      { name: 'Potholes', department: 'ROADS' },
      { name: 'NoName', department: 'ROADS' },
    ]);
  });
});

describe('loadDepartmentUses', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads employees, the workspace designations and complaint categories', async () => {
    employeesSearch.mockResolvedValue([employee('E002', 'Amina', [['ROADS', true]])]);
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'common-masters.Designation'
        ? [record(schema, 'ENGINEER', { code: 'ENGINEER', name: 'Engineer', department: ['ROADS'] })]
        : [record(schema, 'PGR.Potholes', { code: 'Potholes', name: 'Potholes', department: 'ROADS' })],
    );
    expect(await loadDepartmentUses('acme', 'ROADS')).toEqual({ employees: ['Amina'], designations: ['Engineer'], categories: ['Potholes'] });
    expect(search).toHaveBeenCalledWith('acme', 'RAINMAKER-PGR.ComplaintHierarchy', { limit: 5000 });
  });

  it('reads every HRMS page through listEmployees, and leaves removed employees out (#2797)', async () => {
    const full = Array.from({ length: EMPLOYEE_PAGE }, (_, index) => employee(`E${index}`, `Clerk ${index}`, [['WATER', true]]));
    employeesSearch.mockImplementation(async (_tenant, options) =>
      options?.offset === 0
        ? full
        : [employee('E550', 'Amina', [['ROADS', true]]), employee('E551', 'Gone', [['ROADS', true]], { isActive: false })],
    );
    search.mockResolvedValue([]);
    expect(await loadDepartmentUses('acme', 'ROADS')).toEqual({ employees: ['Amina'], designations: [], categories: [] });
  });

  it('fails when any of it cannot be read, so nothing is removed unchecked', async () => {
    employeesSearch.mockRejectedValue(new Error('HRMS down'));
    search.mockResolvedValue([]);
    await expect(loadDepartmentUses('acme', 'ROADS')).rejects.toThrow('HRMS down');
  });
});

describe('checkRemovable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a department in use, saying what uses it (#2797)', async () => {
    employeesSearch.mockResolvedValue([employee('E002', 'E002', [['ROADS', true]])]);
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'common-masters.Designation' ? [] : [record(schema, 'PGR.Potholes', { code: 'Potholes', name: 'Potholes', department: 'ROADS' })],
    );
    await expect(checkRemovable('acme', 'ROADS', 'Roads')).rejects.toThrow(
      'Roads can’t be removed: it’s used by 1 employee (E002) and 1 complaint category (Potholes). Move them to another department first.',
    );
  });

  it('lets an unused department go', async () => {
    employeesSearch.mockResolvedValue([employee('E002', 'Amina', [['WATER', true]])]);
    search.mockResolvedValue([]);
    await expect(checkRemovable('acme', 'ROADS', 'Roads')).resolves.toBeUndefined();
  });

  it("refuses when what uses it can't be read", async () => {
    employeesSearch.mockResolvedValue([]);
    search.mockRejectedValue(new Error('MDMS down'));
    const err = await checkRemovable('acme', 'ROADS', 'Roads').catch((error: unknown) => error);
    expect(describeSaveError(err, 'fallback')).toBe('Couldn’t check what uses Roads, so it wasn’t removed. Try again.');
    expect(reportStepError).toHaveBeenCalledWith('departments', 'check_department_use', expect.any(Error), 'acme');
  });

  it('says a refusal as it is, not "Try again", and reports it', async () => {
    const denied = new ApiClientError([{ code: 'AccessDenied', message: 'Not allowed' }], 403);
    employeesSearch.mockRejectedValue(denied);
    search.mockResolvedValue([]);
    const err = await checkRemovable('acme', 'ROADS', 'Roads').catch((error: unknown) => error);
    expect(err).toBe(denied);
    expect(describeSaveError(err, 'fallback')).toBe('Your account doesn’t have permission to change this workspace yet, so nothing was saved.');
    expect(reportStepError).toHaveBeenCalledWith('departments', 'check_department_use', denied, 'acme');
  });

  it('still says "Try again" for a server error or a rate limit', async () => {
    for (const status of [503, 429]) {
      employeesSearch.mockRejectedValue(new ApiClientError([{ code: 'BUSY', message: 'Busy' }], status));
      search.mockResolvedValue([]);
      const err = await checkRemovable('acme', 'ROADS', 'Roads').catch((error: unknown) => error);
      expect(describeSaveError(err, 'fallback')).toBe('Couldn’t check what uses Roads, so it wasn’t removed. Try again.');
    }
  });
});


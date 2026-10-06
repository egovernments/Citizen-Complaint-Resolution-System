import { describe, expect, it } from 'vitest';
import type { Employee } from '@/api/types';
import { departmentsWithoutGro } from './groCoverage';

const TENANT = 'ke';

function employee(overrides: {
  roles?: { code: string; tenantId?: string }[];
  assignments?: { department: string; isCurrentAssignment?: boolean }[];
  isActive?: boolean;
  userActive?: boolean;
}): Employee {
  return {
    tenantId: TENANT,
    code: 'EMP_0001',
    isActive: overrides.isActive,
    user: { roles: overrides.roles ?? [], active: overrides.userActive },
    assignments: overrides.assignments ?? [],
  } as unknown as Employee;
}

const gro = (department: string, extra: Parameters<typeof employee>[0] = {}) =>
  employee({ roles: [{ code: 'GRO', tenantId: TENANT }], assignments: [{ department, isCurrentAssignment: true }], ...extra });

describe('departmentsWithoutGro', () => {
  it('lists every routed department no GRO is currently assigned to', () => {
    expect(departmentsWithoutGro(['WATER', 'ROADS'], [gro('WATER')], TENANT)).toEqual(['ROADS']);
  });

  it('is empty when each routed department has a GRO', () => {
    expect(departmentsWithoutGro(['WATER', 'ROADS', 'WATER'], [gro('WATER'), gro('ROADS')], TENANT)).toEqual([]);
  });

  it('does not count a DGRO, a GRO for another tenant, or a past assignment', () => {
    const employees = [
      employee({ roles: [{ code: 'DGRO', tenantId: TENANT }], assignments: [{ department: 'WATER', isCurrentAssignment: true }] }),
      employee({ roles: [{ code: 'GRO', tenantId: 'ke.other' }], assignments: [{ department: 'WATER', isCurrentAssignment: true }] }),
      employee({ roles: [{ code: 'GRO', tenantId: TENANT }], assignments: [{ department: 'WATER', isCurrentAssignment: false }] }),
    ];
    expect(departmentsWithoutGro(['WATER'], employees, TENANT)).toEqual(['WATER']);
  });

  it('does not count an inactive employee or a deactivated user', () => {
    expect(departmentsWithoutGro(['WATER'], [gro('WATER', { isActive: false })], TENANT)).toEqual(['WATER']);
    expect(departmentsWithoutGro(['WATER'], [gro('WATER', { userActive: false })], TENANT)).toEqual(['WATER']);
  });

  it('ignores a type with no department', () => {
    expect(departmentsWithoutGro(['', 'WATER'], [gro('WATER')], TENANT)).toEqual([]);
  });
});

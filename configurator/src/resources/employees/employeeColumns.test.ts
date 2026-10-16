import { describe, it, expect } from 'vitest';
import { employeeRoles, employeeStatus } from './employeeColumns';

// cfgreview F16 (#1562): one status column, and the roles a person holds.
describe('employee list cells', () => {
  it('one status: deactivated users read Inactive whatever HRMS says', () => {
    expect(employeeStatus({ employeeStatus: 'EMPLOYED', isActive: true })).toEqual({ active: true, label: 'Employed' });
    expect(employeeStatus({ employeeStatus: 'EMPLOYED', isActive: false })).toEqual({ active: false, label: 'Inactive' });
    expect(employeeStatus({ employeeStatus: 'EMPLOYED', user: { active: false } })).toEqual({ active: false, label: 'Inactive' });
    expect(employeeStatus({ employeeStatus: 'INACTIVE' })).toEqual({ active: false, label: 'Inactive' });
  });
  it('roles by name, EMPLOYEE left out, three shown', () => {
    const r = { user: { roles: [
      { code: 'EMPLOYEE', name: 'Employee' }, { code: 'GRO', name: 'Grievance Routing Officer' }, { code: 'PGR_LME' },
      { code: 'DGRO', name: 'DGRO' }, { code: 'CSR', name: 'Customer Support' }, { code: 'GRO', name: 'Grievance Routing Officer', tenantId: 'ke.x' },
    ] } };
    expect(employeeRoles(r)).toEqual({ all: ['Grievance Routing Officer', 'PGR_LME', 'DGRO', 'Customer Support'], shown: ['Grievance Routing Officer', 'PGR_LME', 'DGRO'], more: 1 });
    expect(employeeRoles({}).shown).toEqual([]);
  });
});

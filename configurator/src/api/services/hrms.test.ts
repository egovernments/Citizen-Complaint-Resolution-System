import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiClient } from '../client';
import { hrmsService } from './hrms';

describe('hrmsService.searchEmployees', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends search criteria as query params, not in the body (egov-hrms binds @ModelAttribute from the query string)', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ Employees: [] } as never);

    await hrmsService.searchEmployees('ke.bomet', { limit: 1000, offset: 0 });

    expect(postSpy).toHaveBeenCalledTimes(1);
    const [url, body] = postSpy.mock.calls[0];
    // tenantId + paging must be in the query string so the server can read them.
    expect(url).toContain('/egov-hrms/employees/_search?');
    expect(url).toContain('tenantId=ke.bomet');
    expect(url).toContain('limit=1000');
    expect(url).toContain('offset=0');
    // The body must NOT carry a `criteria` object — the server ignores it, and
    // sending tenantId only in the body triggers a NullPointerException.
    expect((body as Record<string, unknown>).criteria).toBeUndefined();
    expect((body as Record<string, unknown>).RequestInfo).toBeDefined();
  });

  it('passes codes as a comma-joined query param when provided', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ Employees: [] } as never);

    await hrmsService.searchEmployees('ke', { codes: ['EMP1', 'EMP2'] });

    const [url] = postSpy.mock.calls[0];
    expect(url).toContain('codes=EMP1%2CEMP2');
  });

  // egov-hrms drops its tenant filter on a code search unless someone in the tenant has the code as username (#2456).
  it('keeps only this tenant\'s rows (and its cities\') from a code search, reading every page', async () => {
    const row = (tenantId: string) => ({ code: 'EMP_0002', tenantId });
    const postSpy = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ Employees: [row('other'), row('acme.city'), row('acmeco')] } as never)
      .mockResolvedValueOnce({ Employees: [row('acme')] } as never);

    const rows = await hrmsService.searchEmployees('acme', { codes: ['EMP_0002'], limit: 3 });

    expect(rows.map((r) => r.tenantId)).toEqual(['acme.city', 'acme']);
    expect(postSpy).toHaveBeenCalledTimes(2);
    expect(postSpy.mock.calls[1][0]).toContain('offset=3');
  });

  it('reads one page when there is no code', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ Employees: [{ code: 'A', tenantId: 'other' }] } as never);
    expect(await hrmsService.searchEmployees('acme', { limit: 1 })).toHaveLength(1);
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});

describe('hrmsService.buildEmployee — dob / dateOfAppointment are optional (egovernments/CCRS#1949)', () => {
  const base = {
    tenantId: 'ke.bomet',
    code: 'EMP_001',
    name: 'Jane Kamau',
    userName: 'jane.kamau',
    mobileNumber: '0712345678',
    designation: 'DESIG_1004',
    roles: [{ code: 'PGR_LME', name: 'LME' }],
    jurisdictions: [],
  };

  it('omits both fields when the caller supplies neither', () => {
    const emp = hrmsService.buildEmployee({ ...base, department: 'DEPT_07' });

    expect(emp.user.dob).toBeUndefined();
    expect(emp.dateOfAppointment).toBeUndefined();
    // Assignment fromDate is non-nullable in the HRMS DTO, so it still gets a
    // value even though the appointment date is absent.
    expect(typeof emp.assignments[0].fromDate).toBe('number');
    // Nothing invented: an absent DOA must not survive JSON serialization.
    expect(Object.keys(JSON.parse(JSON.stringify(emp)))).not.toContain('dateOfAppointment');
  });

  it('keeps a supplied dateOfAppointment as the assignment anchor', () => {
    const doa = new Date('2020-01-15T00:00:00Z').getTime();
    const emp = hrmsService.buildEmployee({ ...base, department: 'DEPT_07', dateOfAppointment: doa });

    expect(emp.dateOfAppointment).toBe(doa);
    expect(emp.assignments[0].fromDate).toBe(doa);
  });

  it('backdates the anchor behind every historical window for a multi-department employee', () => {
    const doa = new Date('2020-01-15T00:00:00Z').getTime();
    const emp = hrmsService.buildEmployee({
      ...base,
      department: 'DEPT_07,DEPT_08',
      dateOfAppointment: doa,
    });

    expect(emp.assignments).toHaveLength(2);
    // Every assignment fromDate must be >= dateOfAppointment or egov-hrms
    // rejects with HRMS_INVALID_ASSIGNMENT_DATES_APPOINTMENT.
    for (const a of emp.assignments) {
      expect(a.fromDate).toBeGreaterThanOrEqual(emp.dateOfAppointment!);
    }
  });

  it('leaves the anchor absent for a multi-department employee with no DOA', () => {
    const emp = hrmsService.buildEmployee({ ...base, department: 'DEPT_07,DEPT_08' });

    expect(emp.dateOfAppointment).toBeUndefined();
    expect(emp.assignments).toHaveLength(2);
  });
});

describe('hrmsService.generateUsername', () => {
  it('joins the name with dots, trimming stray ones', () => {
    expect(hrmsService.generateUsername(' Anita  Wanjiru-Otieno ')).toBe('anita.wanjiru.otieno');
  });

  it('keeps the base letter of an accented one (#2456)', () => {
    expect(hrmsService.generateUsername('José Müller')).toBe('jose.muller');
    expect(hrmsService.generateUsername('Zoë Ñúñez')).toBe('zoe.nunez');
  });
});

describe('hrmsService.createEmployeeRecord — every new employee can file complaints (egovernments/CCRS#2239)', () => {
  afterEach(() => vi.restoreAllMocks());

  const employee = (roles: Array<{ code: string; name: string; tenantId?: string }>) =>
    ({ tenantId: 'ke', code: 'EMP_001', user: { name: 'Jane Kamau', tenantId: 'ke', roles } }) as never;

  const sentRoles = async (roles: Array<{ code: string; name: string; tenantId?: string }>) => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ Employees: [{}] } as never);
    await hrmsService.createEmployeeRecord(employee(roles));
    const [, body] = postSpy.mock.calls[0];
    return (body as { Employees: Array<{ user: { roles: Array<{ code: string; tenantId?: string }> } }> }).Employees[0].user.roles;
  };

  it('adds CSR to the roles the admin picked', async () => {
    const roles = await sentRoles([{ code: 'GRO', name: 'Complaint Assessor', tenantId: 'ke' }]);
    expect(roles.map((r) => r.code)).toEqual(['GRO', 'CSR']);
    expect(roles[1].tenantId).toBe('ke');
  });

  it('does not add CSR twice', async () => {
    const roles = await sentRoles([{ code: 'CSR', name: 'Complainant', tenantId: 'ke' }]);
    expect(roles.map((r) => r.code)).toEqual(['CSR']);
  });

  it('adds CSR on each tenant the roles use, matching code and tenant', async () => {
    const roles = await sentRoles([{ code: 'CSR', name: 'Complainant', tenantId: 'ke.cityb' }, { code: 'GRO', name: 'GRO', tenantId: 'ke.citya' }]);
    expect(roles.map((r) => `${r.code}@${r.tenantId}`)).toEqual(['CSR@ke.cityb', 'GRO@ke.citya', 'CSR@ke.citya']);
  });
});

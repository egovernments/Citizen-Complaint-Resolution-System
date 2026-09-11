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

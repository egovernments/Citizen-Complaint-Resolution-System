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

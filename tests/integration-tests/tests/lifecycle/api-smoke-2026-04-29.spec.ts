import { test, expect } from '@playwright/test';
import { loginEmployee, mdmsSearch, pgrSearch, hrmsSearch, workflowBusinessService } from '../utils/launch-fixes/api.js';

test.describe('00-smoke: API helpers reach naipepea', () => {
  test('login returns token', async () => {
    const auth = await loginEmployee();
    expect(auth.token).toBeTruthy();
  });

  test('mdms search returns Department schema records', async () => {
    const auth = await loginEmployee();
    const r = await mdmsSearch(auth, 'ke.nairobi', 'common-masters.Department');
    expect(Array.isArray(r.mdms)).toBe(true);
    expect(r.mdms.length).toBeGreaterThan(0);
  });

  test('pgr search round-trips a known CLOSEDAFTERRESOLUTION complaint', async () => {
    const auth = await loginEmployee();
    const r = await pgrSearch(auth, 'ke.nairobi', 'NCCG-PGR-2026-04-28-011862');
    const sw = r.ServiceWrappers?.[0];
    expect(sw?.service?.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
    expect(sw?.service?.rating).toBe(4);
  });

  test('hrms employee search returns >0 LMEs', async () => {
    const auth = await loginEmployee();
    const r = await hrmsSearch(auth, 'ke.nairobi', ['PGR_LME']);
    expect(r.Employees?.length).toBeGreaterThan(0);
  });

  test('PGR business service is present', async () => {
    const auth = await loginEmployee();
    const r = await workflowBusinessService(auth, 'ke.nairobi', 'PGR');
    expect(r.BusinessServices?.[0]?.businessService).toBe('PGR');
  });
});

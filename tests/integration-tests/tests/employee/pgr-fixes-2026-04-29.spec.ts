import { test, expect } from '@playwright/test';
import { loginEmployee, hrmsSearch, workflowBusinessService } from '../utils/launch-fixes/api.js';

test.describe('02-pgr-employee: assign + workflow guards (#479 + follow-ups)', () => {
  test('PGR business service: PENDINGFORASSIGNMENT.ASSIGN forward-state is PENDINGATLME, not a self-loop', async () => {
    const auth = await loginEmployee();
    const r = await workflowBusinessService(auth, 'ke.nairobi', 'PGR');
    const states: any[] = r.BusinessServices?.[0]?.states ?? [];
    const pfa = states.find(s => s.applicationStatus === 'PENDINGFORASSIGNMENT');
    const assign = pfa?.actions?.find((a: any) => a.action === 'ASSIGN');
    expect(assign?.nextState).toBeTruthy();
    expect(assign.nextState).not.toBe(pfa.uuid);
    const next = states.find(s => s.uuid === assign.nextState);
    expect(next?.applicationStatus).toBe('PENDINGATLME');
  });

  test('PGR_LME-only role filter returns LMEs (not all-of-HRMS)', async () => {
    // PR #68 narrows the assignee filter to next-state forward-action
    // roles. For ASSIGN→PENDINGATLME, that's [PGR_LME, PGR_VIEWER].
    // Sanity check: PGR_LME alone returns more than zero employees.
    const auth = await loginEmployee();
    const r = await hrmsSearch(auth, 'ke.nairobi', ['PGR_LME']);
    expect(r.Employees?.length).toBeGreaterThan(0);
  });

  test('REJECTED state advertises a non-empty rejection-reason mdms list', async () => {
    // The configurator seeds RAINMAKER-PGR.RejectionReasons. PR-B will
    // wire the form's reject-reason picker into the _update payload —
    // this test checks the upstream data exists. If MDMS doesn't have
    // any rejection reasons, the form is hopeless regardless of UI fix.
    const auth = await loginEmployee();
    const r = await fetch(`${process.env.NAIPEPEA_BASE ?? 'https://naipepea.digit.org'}/mdms-v2/v1/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { authToken: auth.token, apiId: 'Rainmaker' },
        MdmsCriteria: {
          tenantId: 'ke.nairobi',
          moduleDetails: [{ moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'RejectionReasons' }] }],
        },
      }),
    }).then(r => r.json());
    const reasons = r.MdmsRes?.['RAINMAKER-PGR']?.RejectionReasons ?? [];
    expect(reasons.length).toBeGreaterThan(0);
  });
});

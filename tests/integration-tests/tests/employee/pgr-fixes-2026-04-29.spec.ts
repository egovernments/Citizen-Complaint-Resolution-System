import { test, expect } from '@playwright/test';
import { loginEmployee, hrmsSearch, workflowBusinessService } from '../utils/launch-fixes/api.js';
import { TENANT, BASE_URL } from '../utils/env';

test.describe('02-pgr-employee: assign + workflow guards (#479 + follow-ups)', () => {
  test('PGR business service: PENDINGFORASSIGNMENT.ASSIGN forward-state is PENDINGATLME, not a self-loop', {
    annotation: {
      type: 'description',
      description: `Guards CCRS#479: the PGR workflow's ASSIGN action on PENDINGFORASSIGNMENT must transition to PENDINGATLME, not loop back on itself. A self-loop on ASSIGN would mean the GRO can "assign" but the complaint never moves out of the queue, breaking the LME's inbox.

Steps:
1. Log in as the test employee.
2. Call workflowBusinessService(auth, 'ke.nairobi', 'PGR').
3. Find the PENDINGFORASSIGNMENT state and its ASSIGN action.
4. Assert assign.nextState is truthy and NOT equal to pfa.uuid (so it's not a self-loop).
5. Look up the state with that nextState UUID and assert its applicationStatus === 'PENDINGATLME'.

Catches CCRS#479 regression directly at the workflow-config layer.`,
    },
    tag: ['@area:pgr', '@ccrs:479', '@kind:regression', '@layer:api', '@persona:employee'] }, async () => {
    const auth = await loginEmployee();
    const r = await workflowBusinessService(auth, TENANT, 'PGR');
    const states: any[] = r.BusinessServices?.[0]?.states ?? [];
    const pfa = states.find(s => s.applicationStatus === 'PENDINGFORASSIGNMENT');
    const assign = pfa?.actions?.find((a: any) => a.action === 'ASSIGN');
    expect(assign?.nextState).toBeTruthy();
    expect(assign.nextState).not.toBe(pfa.uuid);
    const next = states.find(s => s.uuid === assign.nextState);
    expect(next?.applicationStatus).toBe('PENDINGATLME');
  });

  test('PGR_LME-only role filter returns LMEs (not all-of-HRMS)', {
    annotation: {
      type: 'description',
      description: `Sanity-check for the assignee-filter narrowing landed in PR #68. The Assign modal limits the assignee dropdown to the next-state forward-action roles — for ASSIGN→PENDINGATLME that's [PGR_LME, PGR_VIEWER]. This test asserts that filtering HRMS by PGR_LME alone still returns at least one employee, otherwise the dropdown would be empty and the GRO couldn't assign anyone.

Steps:
1. Log in as the test employee.
2. hrmsSearch(auth, 'ke.nairobi', ['PGR_LME']).
3. Assert response.Employees.length > 0.

Pairs with the workflow nextState test — together they ensure both halves of the assign flow (workflow target and assignee list) are healthy.`,
    },
    tag: ['@area:pgr', '@ccrs:479', '@kind:regression', '@layer:api', '@persona:employee'] }, async () => {
    // PR #68 narrows the assignee filter to next-state forward-action
    // roles. For ASSIGN→PENDINGATLME, that's [PGR_LME, PGR_VIEWER].
    // Sanity check: PGR_LME alone returns more than zero employees.
    const auth = await loginEmployee();
    const r = await hrmsSearch(auth, TENANT, ['PGR_LME']);
    expect(r.Employees?.length).toBeGreaterThan(0);
  });

  test('REJECTED state advertises a non-empty rejection-reason mdms list', {
    annotation: {
      type: 'description',
      description: `Upstream-data check for the Reject flow: RAINMAKER-PGR.RejectionReasons MDMS records must exist on the deployment. PR-B will wire the reject-reason picker into the _update payload, but if MDMS has zero reasons the picker is hopeless regardless of UI fixes — this test fails fast and points to the configurator seed gap.

Steps:
1. Log in as the test employee.
2. POST to /mdms-v2/v1/_search for moduleName=RAINMAKER-PGR / masterDetails=[{ name: 'RejectionReasons' }] at tenant ke.nairobi.
3. Assert MdmsRes['RAINMAKER-PGR'].RejectionReasons array exists and has length > 0.

If this fails on a fresh deployment, the configurator seed needs to add at least one rejection reason.`,
    },
    tag: ['@area:pgr', '@ccrs:479', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:employee'] }, async () => {
    // The configurator seeds RAINMAKER-PGR.RejectionReasons. PR-B will
    // wire the form's reject-reason picker into the _update payload —
    // this test checks the upstream data exists. If MDMS doesn't have
    // any rejection reasons, the form is hopeless regardless of UI fix.
    const auth = await loginEmployee();
    const r = await fetch(`${BASE_URL}/mdms-v2/v1/_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { authToken: auth.token, apiId: 'Rainmaker' },
        MdmsCriteria: {
          tenantId: TENANT,
          moduleDetails: [{ moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'RejectionReasons' }] }],
        },
      }),
    }).then(r => r.json());
    const reasons = r.MdmsRes?.['RAINMAKER-PGR']?.RejectionReasons ?? [];
    expect(reasons.length).toBeGreaterThan(0);
  });
});

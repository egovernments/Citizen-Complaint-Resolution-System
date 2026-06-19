import { test, expect } from '@playwright/test';
import { loginEmployee, mdmsSearch, pgrSearch, hrmsSearch, workflowBusinessService } from '../utils/launch-fixes/api.js';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { TENANT } from '../utils/env';

// SRID precedence: explicit env → lifecycle.setup fixtures → naipepea default.
// The default pairs with TENANT's own default (ke.nairobi); on any other
// deployment the SRID resolves from a fixture seeded against TENANT, so the
// SRID and the tenant we search always come from the same source.
const KNOWN_RESOLVED_SRID =
  process.env.KNOWN_RESOLVED_SRID
  || readLifecycleFixtures()?.complaints?.terminal_rated
  || 'NCCG-PGR-2026-04-28-011862';

test.describe('00-smoke: API helpers reach the configured deployment', () => {
  test('login returns token', {
    annotation: {
      type: 'description',
      description: `Smoke test for the API helper that all other API specs depend on. If this fails, every downstream API assertion is meaningless because no token can be acquired from the deployment.

Steps:
1. Call loginEmployee() — POSTs to /user/oauth/token with ADMIN credentials and the configured tenant.
2. Assert the response carries a non-empty access_token.

If this test fails, check egov-user is up and credentials in env match the deployment.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@kind:smoke', '@layer:api', '@persona:cross'],
  }, async () => {
    const auth = await loginEmployee();
    expect(auth.token).toBeTruthy();
  });

  test('mdms search returns Department schema records', {
    annotation: {
      type: 'description',
      description: `MDMS round-trip smoke check. The PGR UI relies on common-masters.Department being populated so the assignment dropdown has options; if MDMS is unreachable or the schema is empty, employee-side flows visibly break. This test logs in and asks MDMS for that exact slice.

Steps:
1. Log in as the test employee to get a token + userInfo.
2. Call mdmsSearch(auth, TENANT, 'common-masters.Department').
3. Assert the response.mdms array exists and has length > 0.

If this fails, every PGR assignment flow downstream will fail too.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@kind:smoke', '@layer:api', '@persona:cross'] }, async () => {
    const auth = await loginEmployee();
    const r = await mdmsSearch(auth, TENANT, 'common-masters.Department');
    expect(Array.isArray(r.mdms)).toBe(true);
    expect(r.mdms.length).toBeGreaterThan(0);
  });

  test('pgr search round-trips a known CLOSEDAFTERRESOLUTION complaint', {
    annotation: {
      type: 'description',
      description: `Anchor smoke check against a fixed historical complaint (default NCCG-PGR-2026-04-28-011862, override via KNOWN_RESOLVED_SRID) in CLOSEDAFTERRESOLUTION state with rating 4. Confirms that pgr-services search is up, the DB still has this seeded record, and the persisted rating round-trips through the search API.

Steps:
1. Log in as the test employee.
2. pgrSearch for the configured serviceRequestId (KNOWN_RESOLVED_SRID) in TENANT.
3. Assert ServiceWrappers[0].service.applicationStatus === 'CLOSEDAFTERRESOLUTION'.
4. Assert ServiceWrappers[0].service.rating === 4.

If the seeded record gets purged or the ID format changes, override KNOWN_RESOLVED_SRID — the test isn't trying to validate a specific bug, just that PGR search works end-to-end.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@kind:smoke', '@layer:api', '@persona:cross'] }, async () => {
    const auth = await loginEmployee();
    const r = await pgrSearch(auth, TENANT, KNOWN_RESOLVED_SRID);
    const sw = r.ServiceWrappers?.[0];
    expect(sw?.service?.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
    expect(sw?.service?.rating).toBe(4);
  });

  test('hrms employee search returns >0 LMEs', {
    annotation: {
      type: 'description',
      description: `Confirms HRMS has at least one employee with the PGR_LME role in TENANT — without that, the GRO can't ASSIGN any complaint and the PGR workflow stalls at PENDINGFORASSIGNMENT.

Steps:
1. Log in as the test employee.
2. hrmsSearch for employees in TENANT filtered by role code PGR_LME.
3. Assert response.Employees array has length > 0.

A failure here predicts assignment flow failures throughout the rest of the suite.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@kind:smoke', '@layer:api', '@persona:cross'] }, async () => {
    const auth = await loginEmployee();
    const r = await hrmsSearch(auth, TENANT, ['PGR_LME']);
    expect(r.Employees?.length).toBeGreaterThan(0);
  });

  test('PGR business service is present', {
    annotation: {
      type: 'description',
      description: `Workflow-side smoke check: the egov-workflow-v2 businessservice _search must return a "PGR" entry for TENANT. Without it, every PGR transition (APPLY/ASSIGN/RESOLVE) fails because the workflow engine has no state machine to drive.

Steps:
1. Log in as the test employee.
2. workflowBusinessService(auth, TENANT, 'PGR').
3. Assert response.BusinessServices[0].businessService === 'PGR'.

Pairs with the other smoke tests to confirm the four backend services PGR depends on (user, mdms, hrms, workflow) are all responsive.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@kind:smoke', '@layer:api', '@persona:cross'] }, async () => {
    const auth = await loginEmployee();
    const r = await workflowBusinessService(auth, TENANT, 'PGR');
    expect(r.BusinessServices?.[0]?.businessService).toBe('PGR');
  });
});

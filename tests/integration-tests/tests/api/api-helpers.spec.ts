import { test, expect } from '@playwright/test';
import { loginEmployee, mdmsSearch, pgrSearch, hrmsSearch, workflowBusinessService } from '../utils/launch-fixes/api.js';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { TENANT } from '../utils/env';

// SRID precedence: explicit env → lifecycle.setup fixtures. No literal
// fallback: the old default ('NCCG-PGR-2026-04-28-011862') is a naipepea-only
// historical SRID that pairs with nothing on any other deployment — on bomet
// or maputo it would just 404, and worse, if a future deployment ever DID
// happen to seed a complaint with that exact id, the assertions below
// (CLOSEDAFTERRESOLUTION, rating 4) would pass by coincidence rather than by
// actually exercising this run's seed. lifecycle-fixtures.json is written
// fresh per run by lifecycle.setup.ts against THIS tenant; when it's missing
// or the setup itself skipped (status:'skipped' — e.g. no viable seed-plan
// triple), that's a real N/A and the test below says so instead of guessing.
const fixtures = readLifecycleFixtures();

// The fixture file is not guaranteed to be THIS tenant's. It is discovered by
// path (and can be pointed anywhere via LIFECYCLE_FIXTURES_FILE, which CI
// matrix runs use to share one file across shards), while the SRID it carries
// is searched below under TENANT. A leftover file from a maputo run consumed on
// bomet yields a valid-looking SRID that pgr-services simply cannot find, and
// the test fails asserting CLOSEDAFTERRESOLUTION against `undefined` — a
// stale-artifact problem wearing a broken-search costume. `tenant` is recorded
// in the file precisely so this is checkable; check it.
const fixtureTenantMismatch =
  fixtures && fixtures.tenant !== TENANT
    ? `lifecycle-fixtures.json was generated for ${fixtures.tenant}, not ${TENANT} — its SRIDs do not exist here. ` +
      'Re-run lifecycle.setup against this deployment, unset LIFECYCLE_FIXTURES_FILE if it points at another run, ' +
      'or set KNOWN_RESOLVED_SRID to a complaint that really is on this tenant.'
    : '';

// An explicit env override still wins: the operator named a complaint on the
// tenant they are pointing at, and no fixture file can contradict that.
const KNOWN_RESOLVED_SRID =
  process.env.KNOWN_RESOLVED_SRID || (fixtureTenantMismatch ? undefined : fixtures?.complaints?.terminal_rated);
const knownSridSkipReason = KNOWN_RESOLVED_SRID
  ? ''
  : fixtureTenantMismatch
    ? `no KNOWN_RESOLVED_SRID and ${fixtureTenantMismatch}`
    : !fixtures
      ? `no KNOWN_RESOLVED_SRID and lifecycle-fixtures.json not found for ${TENANT} — lifecycle.setup didn't run ` +
        "ahead of this project (it isn't one of 'api's dependencies); set KNOWN_RESOLVED_SRID or run the full suite " +
        'so lifecycle-setup executes first'
      : `no KNOWN_RESOLVED_SRID and lifecycle.setup on ${TENANT} wrote status:'skipped' — ${fixtures.skipped_reason ?? 'no reason recorded'}`;

test.describe('00-smoke: API helpers reach the configured deployment', () => {
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
      description: `Anchor smoke check against a complaint in CLOSEDAFTERRESOLUTION state with rating 4 — either KNOWN_RESOLVED_SRID or lifecycle.setup's own fresh terminal_rated fixture for TENANT (no historical-SRID literal: naipepea's old default pairs with no other deployment). Confirms that pgr-services search is up and the persisted rating round-trips through the search API.

Steps:
1. test.skip if neither KNOWN_RESOLVED_SRID nor a usable lifecycle-fixtures.json entry exists (with the precise cause: fixture missing vs. lifecycle.setup itself wrote status:'skipped').
2. Log in as the test employee.
3. pgrSearch for the resolved serviceRequestId in TENANT.
4. Assert ServiceWrappers[0].service.applicationStatus === 'CLOSEDAFTERRESOLUTION'.
5. Assert ServiceWrappers[0].service.rating === 4.

If the seeded record gets purged or the ID format changes, override KNOWN_RESOLVED_SRID — the test isn't trying to validate a specific bug, just that PGR search works end-to-end.`,
    },
    tag: ['@area:pgr', '@kind:lifecycle', '@kind:smoke', '@layer:api', '@persona:cross'] }, async () => {
    test.skip(!!knownSridSkipReason, knownSridSkipReason);
    const auth = await loginEmployee();
    const r = await pgrSearch(auth, TENANT, KNOWN_RESOLVED_SRID!);
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

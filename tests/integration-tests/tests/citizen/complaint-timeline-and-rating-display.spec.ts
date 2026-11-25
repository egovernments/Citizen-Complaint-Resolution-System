// Citizen timeline + rating display. UI test against the live digit-ui.
import { test, expect } from '@playwright/test';
import { loginEmployee, pgrSearch } from '../utils/launch-fixes/api.js';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { BASE_URL, ROOT_TENANT, TENANT, LOCALES } from '../utils/env';
import { requires } from '../utils/capabilities';
import { readProvisionedCitizen } from '../utils/citizen-provision';

// SRID precedence — no hardcoded location fallback:
//   1. PINNED_COMPLAINT_SRID env (operator-supplied)
//   2. lifecycle.setup.ts → terminal_rated (suite seeds it against the live
//      tenant, status=CLOSEDAFTERRESOLUTION, rating=4)
// If neither is present, the anchor test goes by the deployment's declared
// expectations: lifecycle.setup can only seed the rated complaint through
// ASSIGN, which needs the gro-with-department persona. Declared 'required'
// (bomet, default) and absent, that is a seed gap and FAILS; declared
// 'absent', it skips. With the persona present and still no rated complaint,
// the lifecycle walk itself broke, which is a failure too.
const SR_ID =
  process.env.PINNED_COMPLAINT_SRID
  || readLifecycleFixtures()?.complaints?.terminal_rated
  || '';

test.describe('04-citizen-timeline (#473 follow-up)', () => {
  test('PGR _search returns service.rating + workflow.action=RATE for the rated complaint', {
    annotation: {
      type: 'description',
      description: `Anchor regression for CCRS#473: a known-rated complaint (rating=4, status=CLOSEDAFTERRESOLUTION) must come back from PGR _search with both service.rating=4 AND workflow.action='RATE'. Catches a regression where the timeline render loses access to the rating because the service or workflow shape changes. The complaint id comes from PINNED_COMPLAINT_SRID or the lifecycle-seeded terminal_rated fixture — never a hardcoded tenant literal.

Steps:
1. If no rated complaint is available (PINNED_COMPLAINT_SRID unset AND lifecycle terminal_rated not seeded): requires personas.gro-with-department (FAIL when declared required, SKIP when declared absent), then FAIL with lifecycle.setup's skipped_reason.
2. Search as the complaint's owner: the suite citizen lifecycle.setup filed it as (v2.20 pgr-services returns nothing to an employee without a matching department and jurisdiction). A PINNED_COMPLAINT_SRID is searched as the test employee.
3. PGR _search for SR_ID.
4. Pull sw = response.ServiceWrappers[0]; assert it came back.
5. Assert sw.service.rating === 4.
6. Assert sw.workflow.action === 'RATE'.
7. Assert sw.service.applicationStatus === 'CLOSEDAFTERRESOLUTION'.`,
    },
    tag: ['@area:pgr', '@ccrs:473', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    if (!SR_ID) {
      requires(test, 'personas.gro-with-department', 'lifecycle.setup seeds the rated complaint through ASSIGN → RESOLVE → RATE');
      throw new Error(
        'no rated complaint: PINNED_COMPLAINT_SRID is unset and lifecycle.setup did not seed terminal_rated ' +
          `(${readLifecycleFixtures()?.skipped_reason ?? 'no lifecycle-fixtures.json'})`,
      );
    }
    // Whose search: since v2.20 pgr-services scopes an employee's _search to
    // their HRMS departments and exact jurisdictions and returns nothing to an
    // employee holding neither (the workspace admin, ADMIN_USER, on bomet),
    // so the admin search answered no rows. The seeded complaint belongs to
    // the suite citizen that lifecycle.setup filed it as (seed.ts), and its
    // owner always sees it: the person whose timeline renders the rating.
    // An operator-pinned SRID keeps the employee search.
    const citizen = process.env.PINNED_COMPLAINT_SRID ? null : readProvisionedCitizen();
    if (!process.env.PINNED_COMPLAINT_SRID && !citizen) throw new Error('citizen-fixture.json is missing: run the citizen-setup project first');
    const r = citizen
      ? await (await fetch(`${BASE_URL}/pgr-services/v2/request/_search?tenantId=${encodeURIComponent(TENANT)}&serviceRequestId=${encodeURIComponent(SR_ID)}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${citizen.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { apiId: 'Rainmaker', authToken: citizen.token,
            userInfo: { uuid: citizen.uuid, type: 'CITIZEN', tenantId: citizen.tenantId, userName: citizen.userName, mobileNumber: citizen.mobile } } }),
        })).json()
      : await pgrSearch(await loginEmployee(), TENANT, SR_ID);
    const sw = r.ServiceWrappers?.[0];
    expect(sw, `${SR_ID} must come back from PGR _search`).toBeTruthy();
    expect(sw?.service?.rating).toBe(4);
    expect(sw?.workflow?.action).toBe('RATE');
    expect(sw?.service?.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
  });

  test('Localization keys for the timeline rendering are seeded across the deployment locales (rainmaker-common + rainmaker-pgr)', {
    annotation: {
      type: 'description',
      description: `Localization seed-completeness check for the citizen timeline. The timeline render uses CS_COMMON_CLOSEDAFTERRESOLUTION + CS_COMMON_CLOSEDAFTERREJECTION (status labels) and CS_ADDCOMPLAINT_YOU_RATED. Searches both modules (rainmaker-common, rainmaker-pgr) across every locale the deployment seeds (LOCALES env — e.g. en_IN on mz.maputo, en_IN + sw_KE on Kenya) and asserts the union covers all three keys.

Steps:
1. Log in as the test employee.
2. For each (module, locale) pair across [rainmaker-common, rainmaker-pgr] × LOCALES:
   - POST /localization/messages/v1/_search with locale, tenantId=ROOT_TENANT, module.
   - Add every returned message.code to a Set.
3. For each required key ['CS_COMMON_CLOSEDAFTERRESOLUTION','CS_COMMON_CLOSEDAFTERREJECTION','CS_ADDCOMPLAINT_YOU_RATED'], expect.soft the Set contains it (with a clear message naming which key is missing).

Uses expect.soft so the test reports ALL missing keys in one run instead of failing fast on the first one. Catches a regression where a localization seed misses the tenant or one of its locales.`,
    },
    tag: ['@area:pgr', '@ccrs:473', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    // Timeline render uses CS_COMMON_* (status labels) and
    // CS_ADDCOMPLAINT_YOU_RATED. Query both modules across the deployment's
    // seeded locales and check the union.
    const auth = await loginEmployee();
    const codes = new Set<string>();
    for (const mod of ['rainmaker-common', 'rainmaker-pgr']) {
      for (const locale of LOCALES) {
        const url = `${BASE_URL}/localization/messages/v1/_search?locale=${locale}&tenantId=${ROOT_TENANT}&module=${mod}`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { authToken: auth.token, apiId: 'Rainmaker' } }),
        }).then(r => r.json());
        for (const m of r.messages ?? []) codes.add(m.code);
      }
    }
    for (const k of ['CS_COMMON_CLOSEDAFTERRESOLUTION', 'CS_COMMON_CLOSEDAFTERREJECTION', 'CS_ADDCOMPLAINT_YOU_RATED']) {
      expect.soft(codes.has(k), `${k} missing from PGR localization at ${ROOT_TENANT}`).toBe(true);
    }
  });
});

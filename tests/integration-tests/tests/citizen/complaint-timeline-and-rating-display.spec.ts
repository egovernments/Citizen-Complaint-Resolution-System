// Citizen timeline + rating display. UI test against the live digit-ui.
import { test, expect } from '@playwright/test';
import { loginEmployee, pgrSearch } from '../utils/launch-fixes/api.js';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';
import { BASE_URL, ROOT_TENANT, CITY_TENANT, LOCALES } from '../utils/env';

// SRID precedence — no hardcoded location fallback:
//   1. PINNED_COMPLAINT_SRID env (operator-supplied)
//   2. lifecycle.setup.ts → terminal_rated (suite seeds it against the live
//      tenant, status=CLOSEDAFTERRESOLUTION, rating=4)
// If neither is present, the anchor test self-skips (a rated complaint is an
// onboarding-data prerequisite, not something this spec creates).
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
1. Skip if no rated complaint is available for this deployment (PINNED_COMPLAINT_SRID unset AND lifecycle terminal_rated not seeded).
2. Log in as the test employee.
3. pgrSearch(auth, CITY_TENANT, SR_ID).
4. Pull sw = response.ServiceWrappers[0].
5. Assert sw.service.rating === 4.
6. Assert sw.workflow.action === 'RATE'.
7. Assert sw.service.applicationStatus === 'CLOSEDAFTERRESOLUTION'.`,
    },
    tag: ['@area:pgr', '@ccrs:473', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    test.skip(
      !SR_ID,
      'no rated complaint available (PINNED_COMPLAINT_SRID unset and lifecycle terminal_rated not seeded — onboarding-data prerequisite)',
    );
    const auth = await loginEmployee();
    const r = await pgrSearch(auth, CITY_TENANT, SR_ID);
    const sw = r.ServiceWrappers?.[0];
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

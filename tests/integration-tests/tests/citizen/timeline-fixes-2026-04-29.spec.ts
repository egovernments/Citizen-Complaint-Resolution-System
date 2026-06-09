// Citizen timeline + rating display. UI test against the live digit-ui.
import { test, expect } from '@playwright/test';
import { loginEmployee, pgrSearch } from '../utils/launch-fixes/api.js';
import { readLifecycleFixtures } from '../utils/lifecycle-fixtures';

// SRID precedence:
//   1. PINNED_COMPLAINT_SRID env (operator-supplied)
//   2. lifecycle.setup.ts → terminal_rated (suite seeds it against
//      the live tenant, status=CLOSEDAFTERRESOLUTION, rating=4)
//   3. naipepea historical fallback
const SR_ID =
  process.env.PINNED_COMPLAINT_SRID
  || readLifecycleFixtures()?.complaints.terminal_rated
  || 'NCCG-PGR-2026-04-28-011862';

test.describe('04-citizen-timeline (#473 follow-up)', () => {
  test('PGR _search returns service.rating + workflow.action=RATE for the rated complaint', {
    annotation: {
      type: 'description',
      description: `Anchor regression for CCRS#473: a known-rated complaint (NCCG-PGR-2026-04-28-011862, rating=4, status=CLOSEDAFTERRESOLUTION) must come back from PGR _search with both service.rating=4 AND workflow.action='RATE'. Catches a regression where the timeline render loses access to the rating because the service or workflow shape changes.

Steps:
1. Log in as the test employee.
2. pgrSearch(auth, 'ke.nairobi', 'NCCG-PGR-2026-04-28-011862').
3. Pull sw = response.ServiceWrappers[0].
4. Assert sw.service.rating === 4.
5. Assert sw.workflow.action === 'RATE'.
6. Assert sw.service.applicationStatus === 'CLOSEDAFTERRESOLUTION'.

If the seeded record gets purged, swap the constant — the test isn't tied to a specific bug, just that PGR search keeps surfacing the rating + workflow action together.`,
    },
    tag: ['@area:pgr', '@ccrs:473', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    const auth = await loginEmployee();
    const r = await pgrSearch(auth, 'ke.nairobi', SR_ID);
    const sw = r.ServiceWrappers?.[0];
    expect(sw?.service?.rating).toBe(4);
    expect(sw?.workflow?.action).toBe('RATE');
    expect(sw?.service?.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
  });

  test('Localization keys for the timeline rendering are seeded en_IN + sw_KE (across rainmaker-common + rainmaker-pgr)', {
    annotation: {
      type: 'description',
      description: `Localization seed-completeness check for the citizen timeline. The timeline render uses CS_COMMON_CLOSEDAFTERRESOLUTION + CS_COMMON_CLOSEDAFTERREJECTION (status labels) and CS_ADDCOMPLAINT_YOU_RATED. Searches both modules (rainmaker-common, rainmaker-pgr) across both locales (en_IN, sw_KE) and asserts the union covers all three keys.

Steps:
1. Log in as the test employee.
2. For each (module, locale) pair across [rainmaker-common, rainmaker-pgr] × [en_IN, sw_KE] (4 calls):
   - POST /localization/messages/v1/_search with locale, tenantId=ke, module.
   - Add every returned message.code to a Set.
3. For each required key ['CS_COMMON_CLOSEDAFTERRESOLUTION','CS_COMMON_CLOSEDAFTERREJECTION','CS_ADDCOMPLAINT_YOU_RATED'], expect.soft the Set contains it (with a clear message naming which key is missing).

Uses expect.soft so the test reports ALL missing keys in one run instead of failing fast on the first one. Catches a regression where a localization seed misses Kenya tenant or one of the two locales.`,
    },
    tag: ['@area:pgr', '@ccrs:473', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    // Timeline render uses CS_COMMON_* (status labels — seeded in
    // rainmaker-pgr at ke.nairobi) and CS_ADDCOMPLAINT_YOU_RATED. Query
    // both modules and check the union.
    const auth = await loginEmployee();
    const codes = new Set<string>();
    for (const mod of ['rainmaker-common', 'rainmaker-pgr']) {
      for (const locale of ['en_IN', 'sw_KE']) {
        const url = `${process.env.NAIPEPEA_BASE ?? 'https://naipepea.digit.org'}/localization/messages/v1/_search?locale=${locale}&tenantId=ke&module=${mod}`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ RequestInfo: { authToken: auth.token, apiId: 'Rainmaker' } }),
        }).then(r => r.json());
        for (const m of r.messages ?? []) codes.add(m.code);
      }
    }
    for (const k of ['CS_COMMON_CLOSEDAFTERRESOLUTION', 'CS_COMMON_CLOSEDAFTERREJECTION', 'CS_ADDCOMPLAINT_YOU_RATED']) {
      expect.soft(codes.has(k), `${k} missing from PGR localization at ke`).toBe(true);
    }
  });
});

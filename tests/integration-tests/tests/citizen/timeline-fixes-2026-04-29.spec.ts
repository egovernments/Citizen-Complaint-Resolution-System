// Citizen timeline + rating display. UI test against the live digit-ui.
import { test, expect } from '@playwright/test';
import { loginEmployee, pgrSearch } from '../utils/launch-fixes/api.js';

const SR_ID = 'NCCG-PGR-2026-04-28-011862'; // verified: CLOSEDAFTERRESOLUTION, rating=4

test.describe('04-citizen-timeline (#473 follow-up)', () => {
  test('PGR _search returns service.rating + workflow.action=RATE for the rated complaint', async () => {
    const auth = await loginEmployee();
    const r = await pgrSearch(auth, 'ke.nairobi', SR_ID);
    const sw = r.ServiceWrappers?.[0];
    expect(sw?.service?.rating).toBe(4);
    expect(sw?.workflow?.action).toBe('RATE');
    expect(sw?.service?.applicationStatus).toBe('CLOSEDAFTERRESOLUTION');
  });

  test('Localization keys for the timeline rendering are seeded en_IN + sw_KE (across rainmaker-common + rainmaker-pgr)', async () => {
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

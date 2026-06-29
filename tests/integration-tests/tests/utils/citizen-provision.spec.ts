/**
 * Contract test for provisionFreshCitizen — the suite-wide citizen
 * provisioning helper. The setup project at tests/fixtures/citizen.setup.ts
 * calls this helper once per `npx playwright test` invocation; this test
 * exists to verify the helper's contract independently against a live
 * deployment.
 */
import { test, expect } from '@playwright/test';
import { provisionFreshCitizen } from './citizen-provision';
import { getMobileValidationRule } from './mdms-mobile';
import { TENANT } from './env';

test('provisionFreshCitizen returns identity matching MDMS rule + working token', async () => {
  const citizen = await provisionFreshCitizen();

  // Shape: every consumer needs these fields
  expect(citizen.mobile).toMatch(/^\d+$/);
  expect(citizen.name).toBeTruthy();
  expect(citizen.token).toBeTruthy();
  expect(citizen.uuid).toBeTruthy();
  expect(citizen.tenantId).toBeTruthy();

  // MDMS prefix surfaced on the citizen if MDMS has a real rule. The
  // mobile-number-pattern check is best-effort only because some
  // deployments publish a UI-side rule via MDMS that disagrees with the
  // server-side regex enforced by user-service (Bomet: MDMS says ^[23],
  // server accepts ^[7]). The helper tries MDMS first and falls back to
  // CITIZEN_PHONE_PREFIX when the server rejects — its true contract is
  // "server accepts the citizen", checked via the round-trip below.
  const rule = await getMobileValidationRule(TENANT);
  if (rule.prefix) {
    expect(citizen.prefix).toBe(rule.prefix);
  }

  // Token works: a basic authenticated round-trip should succeed.
  const probe = await fetch(`${process.env.BASE_URL || 'https://naipepea.digit.org'}/user/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { authToken: citizen.token, apiId: 'Rainmaker' },
      uuid: [citizen.uuid],
    }),
  });
  expect(probe.ok, `authenticated /user/_search failed: HTTP ${probe.status}`).toBe(true);
});

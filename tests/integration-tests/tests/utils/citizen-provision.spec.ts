/**
 * Contract test for provisionFreshCitizen — the suite-wide citizen
 * provisioning helper. The setup project at tests/fixtures/citizen.setup.ts
 * calls this helper once per `npx playwright test` invocation and writes what
 * it returned to citizen-fixture.json; this test checks that return value
 * against the live deployment.
 *
 * It checks the citizen-setup result rather than signing another new number
 * in: each provisioning is one BFF OTP send, and the BFF allows 20 per client
 * IP per hour (IDENTITY_CITIZEN_OTP_IP_SEND_LIMIT), shared by every run from
 * that address. Run outside the project DAG (no fixture), it provisions one.
 */
import { test, expect } from '@playwright/test';
import { provisionFreshCitizen, readProvisionedCitizen } from './citizen-provision';
import { getMobileValidationRule } from './mdms-mobile';
import { BASE_URL, TENANT } from './env';

test('provisionFreshCitizen returns identity matching MDMS rule + working token', { tag: ['@persona:citizen'] }, async () => {
  const citizen = readProvisionedCitizen() ?? await provisionFreshCitizen();

  // Shape: every consumer needs these fields
  expect(citizen.mobile).toMatch(/^\d+$/);
  expect(citizen.name).toBeTruthy();
  expect(citizen.token).toBeTruthy();
  expect(citizen.uuid).toBeTruthy();
  expect(citizen.tenantId).toBeTruthy();
  // The BFF session every citizen spec reuses instead of sending another OTP.
  expect(citizen.sessionCookies?.length, 'provisioned citizen must carry its BFF session cookies').toBeGreaterThan(0);

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
  const probe = await fetch(`${BASE_URL}/user/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { authToken: citizen.token, apiId: 'Rainmaker' },
      uuid: [citizen.uuid],
    }),
  });
  expect(probe.ok, `authenticated /user/_search failed: HTTP ${probe.status}`).toBe(true);
});

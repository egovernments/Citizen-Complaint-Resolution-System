/**
 * Suite-wide citizen provisioning setup.
 *
 * Runs ONCE per `npx playwright test` invocation. Registers a fresh
 * citizen against the configured deployment (using MDMS rules for the
 * mobile number + country prefix, with server-side discovery fallback —
 * see provisionFreshCitizen for the full discovery chain) and persists
 * the identity to `citizen-fixture.json` in the suite root.
 *
 * Citizen-touching specs read this fixture via readProvisionedCitizen()
 * from utils/citizen-provision rather than re-provisioning, so the whole
 * suite shares a single citizen identity per run. (User accepted that
 * provisioned citizens accumulate on the tenant — no afterAll cleanup.)
 */
import { test as setup, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { provisionFreshCitizen, CITIZEN_FIXTURE_PATH } from '../utils/citizen-provision';

setup('provision a fresh citizen (suite-wide)', async () => {
  const citizen = await provisionFreshCitizen();
  expect(citizen.mobile, 'provisioned citizen must have a mobile').toBeTruthy();
  expect(citizen.token, 'provisioned citizen must have a token').toBeTruthy();
  expect(citizen.uuid, 'provisioned citizen must have a uuid').toBeTruthy();

  writeFileSync(CITIZEN_FIXTURE_PATH, JSON.stringify(citizen, null, 2));
  console.log(
    `[citizen.setup] provisioned mobile=${citizen.mobile} uuid=${citizen.uuid} tenant=${citizen.tenantId}`,
  );
});

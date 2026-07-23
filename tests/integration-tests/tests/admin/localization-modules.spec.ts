/**
 * Configurator localization module correctness.
 *
 * Regression test for egovernments/Citizen-Complaint-Resolution-System#636:
 * buildDepartmentLocalizations() and buildDesignationLocalizations() were
 * writing COMMON_MASTERS_DEPARTMENT_* and COMMON_MASTERS_DESIGNATION_* keys
 * into module "rainmaker-common-masters". The DIGIT-UI loads
 * "rainmaker-common" at startup (via StateInfo.localizationModules), not
 * "rainmaker-common-masters" — so department and designation labels displayed
 * as raw keys in employee screens.
 *
 * These tests verify that the localization API returns department/designation
 * keys under the correct module ("rainmaker-common"), and that no keys leak
 * into the incorrect module ("rainmaker-common-masters").
 */

import { test, expect } from '@playwright/test';
import { getDigitToken } from '../utils/auth';
import { BASE_URL, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

const LOCALE = 'en_IN';

/** The module that StateInfo.localizationModules includes — the UI loads this. */
const CORRECT_MODULE = 'rainmaker-common';
/** The module that was used by mistake — the UI never loads this. */
const WRONG_MODULE = 'rainmaker-common-masters';

interface LocalizationMessage {
  code: string;
  message: string;
  module: string;
  locale: string;
}

async function searchLocalizations(
  accessToken: string,
  module: string,
): Promise<LocalizationMessage[]> {
  const url = `${BASE_URL}/localization/messages/v1/_search?locale=${LOCALE}&tenantId=${TENANT}&module=${module}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: accessToken },
    }),
  });
  expect(resp.ok, `Localization search failed (${resp.status})`).toBe(true);
  const data = await resp.json();
  return (data.messages || []) as LocalizationMessage[];
}

test.describe('Configurator localization modules (#636)', () => {
  let accessToken: string;

  test.beforeAll(async () => {
    const tokenResponse = await getDigitToken({
      baseURL: BASE_URL,
      tenant: TENANT,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    });
    accessToken = tokenResponse.access_token;
  });

  test('department localizations are in rainmaker-common, not rainmaker-common-masters', {
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'],
  }, async () => {
    // Search the correct module for department keys
    const correctMessages = await searchLocalizations(accessToken, CORRECT_MODULE);
    const deptKeysInCorrect = correctMessages.filter((m) =>
      m.code.startsWith('COMMON_MASTERS_DEPARTMENT_'),
    );

    test.info().annotations.push({
      type: 'dept-keys-correct-module',
      description: `Found ${deptKeysInCorrect.length} COMMON_MASTERS_DEPARTMENT_* keys in ${CORRECT_MODULE}`,
    });

    // There should be department keys in the correct module (seeded by bootstrap)
    expect(
      deptKeysInCorrect.length,
      `Expected COMMON_MASTERS_DEPARTMENT_* keys in "${CORRECT_MODULE}" — ` +
        'these are seeded during tenant bootstrap',
    ).toBeGreaterThan(0);

    // Search the WRONG module — it should have zero department keys
    const wrongMessages = await searchLocalizations(accessToken, WRONG_MODULE);
    const deptKeysInWrong = wrongMessages.filter((m) =>
      m.code.startsWith('COMMON_MASTERS_DEPARTMENT_'),
    );

    test.info().annotations.push({
      type: 'dept-keys-wrong-module',
      description: `Found ${deptKeysInWrong.length} COMMON_MASTERS_DEPARTMENT_* keys in ${WRONG_MODULE}`,
    });

    expect(
      deptKeysInWrong.length,
      `COMMON_MASTERS_DEPARTMENT_* keys found in "${WRONG_MODULE}" — ` +
        `these should be in "${CORRECT_MODULE}" instead (see #636)`,
    ).toBe(0);
  });

  test('designation localizations are in rainmaker-common, not rainmaker-common-masters', {
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'],
  }, async () => {
    // Search the correct module for designation keys
    const correctMessages = await searchLocalizations(accessToken, CORRECT_MODULE);
    const desigKeysInCorrect = correctMessages.filter((m) =>
      m.code.startsWith('COMMON_MASTERS_DESIGNATION_'),
    );

    test.info().annotations.push({
      type: 'desig-keys-correct-module',
      description: `Found ${desigKeysInCorrect.length} COMMON_MASTERS_DESIGNATION_* keys in ${CORRECT_MODULE}`,
    });

    expect(
      desigKeysInCorrect.length,
      `Expected COMMON_MASTERS_DESIGNATION_* keys in "${CORRECT_MODULE}" — ` +
        'these are seeded during tenant bootstrap',
    ).toBeGreaterThan(0);

    // Search the WRONG module — it should have zero designation keys
    const wrongMessages = await searchLocalizations(accessToken, WRONG_MODULE);
    const desigKeysInWrong = wrongMessages.filter((m) =>
      m.code.startsWith('COMMON_MASTERS_DESIGNATION_'),
    );

    test.info().annotations.push({
      type: 'desig-keys-wrong-module',
      description: `Found ${desigKeysInWrong.length} COMMON_MASTERS_DESIGNATION_* keys in ${WRONG_MODULE}`,
    });

    expect(
      desigKeysInWrong.length,
      `COMMON_MASTERS_DESIGNATION_* keys found in "${WRONG_MODULE}" — ` +
        `these should be in "${CORRECT_MODULE}" instead (see #636)`,
    ).toBe(0);
  });

  test('rainmaker-common-masters module has no localization data at all', {
    tag: ['@area:configurator-manage', '@kind:regression', '@layer:ui', '@persona:admin'],
  }, async () => {
    // This module should not exist in the localization system — any data here
    // indicates a bug in one of the localization builders.
    const wrongMessages = await searchLocalizations(accessToken, WRONG_MODULE);

    test.info().annotations.push({
      type: 'wrong-module-total',
      description: `Total keys in ${WRONG_MODULE}: ${wrongMessages.length}`,
    });

    expect(
      wrongMessages.length,
      `Module "${WRONG_MODULE}" should have no localization data — ` +
        `the UI loads "${CORRECT_MODULE}" via StateInfo.localizationModules. ` +
        `Found ${wrongMessages.length} orphaned keys.`,
    ).toBe(0);
  });
});

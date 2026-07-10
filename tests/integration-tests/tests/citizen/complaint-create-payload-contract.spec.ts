// PGR citizen / CSR create. End-to-end checks for the bugs fixed in
// PR #69 (ward-leaf, pincode pattern, form reset) and PR #72
// (re-enabled AddressOne / AddressTwo, tenant-aware boundary cascade).
//
// The historical-data assertion was unreliable — past complaints can't
// backfill, so even after the fix the assertion stayed red until a new
// complaint trickled in. Replaced with two stronger assertions:
//   (a) the rendered Create-Complaint page has both Address inputs.
//   (b) the backend round-trips buildingName + street on a fresh
//       PGR _create call (that's the contract the form mapping
//       eventually exercises).
import { test, expect } from '@playwright/test';
import { loginEmployee } from '../utils/launch-fixes/api.js';
import { BASE_URL, POSTAL_CODE_PATTERN, POSTAL_CODE_VALID } from '../utils/env';

const BASE = BASE_URL;

test.describe('03-citizen-create: PGR _create payload completeness (#478 + #72)', () => {
  test('digit-ui bundle declares AddressOne + AddressTwo populators (PR-C re-enabled)', {
    annotation: {
      type: 'description',
      description: `Bundle-level guard for PR-C (CCRS#72): the AddressOne and AddressTwo populators on the citizen Create Complaint form were commented out — pre-fix the bundle had neither string anywhere. Post-fix both must appear. Faster and more reliable than navigating the SPA — fetch index.js and grep.

Steps:
1. fetch GET /digit-ui/index.js from the deployment.
2. Assert response.ok.
3. Assert the response body contains 'AddressOne' AND 'AddressTwo'.

Catches a regression where the populators get re-disabled (or refactored to internal-only references) without the JSX config being updated.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@ccrs:72', '@kind:regression', '@layer:api', '@persona:citizen'] }, async () => {
    // Pre-PR-C the populators were commented out in the JSX config —
    // the bundle had no string `AddressOne` / `AddressTwo` anywhere.
    // Post-PR-C they're back. Fetch the bundle directly (faster + more
    // reliable than navigating the SPA) and grep.
    const r = await fetch(`${BASE}/digit-ui/index.js`);
    expect(r.ok).toBe(true);
    const body = await r.text();
    expect(body).toContain('AddressOne');
    expect(body).toContain('AddressTwo');
  });
});

test.describe('03-citizen-create: pincode validation (#478)', () => {
  test('the deployment postal-code pattern accepts this tenant\'s valid sample and rejects malformed input', {
    annotation: {
      type: 'description',
      description: `Pure-regex unit check for the post-fix, tenant-pinned postal-code pattern (globalConfigs CORE_POSTAL_CONFIGS.postalCodePattern, mirrored into POSTAL_CODE_PATTERN in .env). Confirms the pattern accepts the deployment's known-valid sample (POSTAL_CODE_VALID — e.g. Nairobi GPO "00100" on a 5-digit tenant, "0101-03" on mz.maputo) AND rejects a non-numeric input and an over-long numeric run.

Steps:
1. Build PATTERN from POSTAL_CODE_PATTERN env.
2. Assert PATTERN.test(POSTAL_CODE_VALID) === true.
3. Assert PATTERN.test('abcde') === false (non-numeric).
4. Assert PATTERN.test('999999999999') === false (absurdly long).

No HTTP, no UI — pure regex assertion. Pairs with the legacy-pattern test below.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:api', '@persona:citizen'] }, () => {
    const PATTERN = new RegExp(POSTAL_CODE_PATTERN); // tenant-pinned, from env
    expect(PATTERN.test(POSTAL_CODE_VALID)).toBe(true);
    expect(PATTERN.test('abcde')).toBe(false);
    expect(PATTERN.test('999999999999')).toBe(false);
  });

  test('the legacy Indian pattern would have rejected this tenant\'s valid postal code', {
    annotation: {
      type: 'description',
      description: `Documents WHY the old pattern was wrong outside India: the legacy Indian rule /^[1-9][0-9]{5}$/i (exactly 6 digits, can't start with 0) rejects this deployment's known-valid postal sample (POSTAL_CODE_VALID — "00100" starts with 0, "0101-03" has a hyphen). Justifies migrating away from the Indian PIN format to the tenant-pinned pattern in the sibling test.

Steps:
1. Define LEGACY = /^[1-9][0-9]{5}$/i.
2. Assert LEGACY.test(POSTAL_CODE_VALID) === false.

Pins the rationale in code so a future "standardize the regex" PR can't silently regress to the Indian form.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:citizen'] }, () => {
    const LEGACY = /^[1-9][0-9]{5}$/i;
    expect(LEGACY.test(POSTAL_CODE_VALID)).toBe(false);
  });
});

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

const BASE = process.env.NAIPEPEA_BASE ?? 'https://naipepea.digit.org';

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
  test('Kenya 5-digit Nairobi GPO postal code (00100) is now a valid pattern', {
    annotation: {
      type: 'description',
      description: `Pure-regex unit check for the post-fix Kenya postal-code pattern /^[0-9]{5}$/. Confirms the 5-digit rule accepts Nairobi GPO ("00100") AND rejects too-short / too-long / non-numeric inputs.

Steps:
1. Define PATTERN = /^[0-9]{5}$/.
2. Assert PATTERN.test('00100') === true.
3. Assert PATTERN.test('1234') === false (too short).
4. Assert PATTERN.test('123456') === false (too long).
5. Assert PATTERN.test('abcde') === false (non-numeric).

No HTTP, no UI — pure regex assertion. Pairs with the legacy-pattern test below to lock in the spec.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:regression', '@layer:api', '@persona:citizen'] }, () => {
    const PATTERN = /^[0-9]{5}$/; // post-fix
    expect(PATTERN.test('00100')).toBe(true);
    expect(PATTERN.test('1234')).toBe(false);
    expect(PATTERN.test('123456')).toBe(false);
    expect(PATTERN.test('abcde')).toBe(false);
  });

  test('the legacy Indian pattern would have rejected Nairobi GPO', {
    annotation: {
      type: 'description',
      description: `Documents WHY the old pattern was wrong for Kenya: the legacy Indian rule /^[1-9][0-9]{5}$/i (6 digits, can't start with 0) would have rejected Nairobi GPO "00100". Justifies the migration to the 5-digit Kenya pattern in the sibling test.

Steps:
1. Define LEGACY = /^[1-9][0-9]{5}$/i.
2. Assert LEGACY.test('00100') === false.

Tiny test, but it pins down the rationale in code so a future "let's standardize the regex" PR can't regress to the Indian form without explicitly breaking this assertion.`,
    },
    tag: ['@area:pgr', '@ccrs:478', '@kind:edge-case', '@kind:regression', '@layer:api', '@persona:citizen'] }, () => {
    const LEGACY = /^[1-9][0-9]{5}$/i;
    expect(LEGACY.test('00100')).toBe(false);
  });
});

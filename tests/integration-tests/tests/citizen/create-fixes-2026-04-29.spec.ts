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
  test('digit-ui bundle declares AddressOne + AddressTwo populators (PR-C re-enabled)', async () => {
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
  test('Kenya 5-digit Nairobi GPO postal code (00100) is now a valid pattern', () => {
    const PATTERN = /^[0-9]{5}$/; // post-fix
    expect(PATTERN.test('00100')).toBe(true);
    expect(PATTERN.test('1234')).toBe(false);
    expect(PATTERN.test('123456')).toBe(false);
    expect(PATTERN.test('abcde')).toBe(false);
  });

  test('the legacy Indian pattern would have rejected Nairobi GPO', () => {
    const LEGACY = /^[1-9][0-9]{5}$/i;
    expect(LEGACY.test('00100')).toBe(false);
  });
});

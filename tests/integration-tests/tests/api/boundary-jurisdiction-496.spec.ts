/**
 * Lifecycle — boundary jurisdiction filter (CCRS #496 unresolved sub-bug).
 *
 * Gurjeet 2026-05-19 retest open item: "CSR can pick wards outside
 * their jurisdiction". When a CSR is scoped to a single leaf ward,
 * the `/boundary-service/boundary-relationships/_search` response
 * (used by the picker) must return ONLY that ward's subtree — not
 * the entire admin tree.
 *
 * Today this spec fails red on bomet: the API returns the full tree
 * for both ADMIN and the ward CSR. That's the honest signal — the
 * sub-bug is unresolved. The fix lives in the `boundary-service`
 * backend (filter by `requestInfo.userInfo` jurisdictions). When it
 * ships, this test goes green automatically.
 *
 * Test user: `WARD_CSR_USER` (defaults to `BOMET_CSR_CHESOEN_…` on
 * the bomet deployment). Override `WARD_CSR_BOUNDARY` and
 * `FORBIDDEN_WARDS` for other tenants.
 */
import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  ROOT_TENANT,
  WARD_CSR_USER,
  WARD_CSR_PASS,
  WARD_CSR_BOUNDARY,
  FORBIDDEN_WARDS,
} from '../utils/env';

test.describe('lifecycle — boundary jurisdiction filter for ward CSR #496', () => {
  test('boundary-relationships API returns only the ward subtree', async ({ request }) => {
    // ============ CSR oauth token ============
    const tokenResp = await request.post(`${BASE_URL}/user/oauth/token`, {
      headers: {
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: `username=${WARD_CSR_USER}&password=${encodeURIComponent(WARD_CSR_PASS)}&grant_type=password&scope=read&tenantId=${ROOT_TENANT}&userType=EMPLOYEE`,
    });
    // The ward-scoped CSR is a seeded persona (bomet defaults). On a deployment
    // that hasn't onboarded such a user, authentication 400s — there's nothing
    // to test, so skip with a clear reason rather than fail red. When the
    // persona IS present (bomet), the test runs and exposes the real #496
    // jurisdiction-filter regression as before.
    test.skip(
      !tokenResp.ok(),
      `Ward-scoped CSR "${WARD_CSR_USER}" not provisioned on this deployment ` +
        `(auth ${tokenResp.status()} at tenant ${ROOT_TENANT}). Set WARD_CSR_USER/PASS/BOUNDARY ` +
        `+ FORBIDDEN_WARDS to a real jurisdiction-scoped CSR to exercise #496.`,
    );
    const token = (await tokenResp.json()).access_token as string;

    // ============ Hit boundary-relationships as the CSR ============
    const boundaryResp = await request.post(
      `${BASE_URL}/boundary-service/boundary-relationships/_search?tenantId=${ROOT_TENANT}&hierarchyType=ADMIN`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: { authToken: token } },
      },
    );
    expect(boundaryResp.ok()).toBeTruthy();
    const body = await boundaryResp.json();

    // Walk all nested `code` fields.
    const codes = new Set<string>();
    const collect = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.code === 'string') codes.add(obj.code);
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') collect(v);
      }
    };
    collect(body);

    expect(codes.size, 'response must include at least one boundary').toBeGreaterThan(0);
    expect(
      codes.has(WARD_CSR_BOUNDARY),
      `CSR's own ward (${WARD_CSR_BOUNDARY}) must be in the response`,
    ).toBe(true);

    // Forbidden wards MUST NOT appear.
    const offenders = FORBIDDEN_WARDS.filter((c) => codes.has(c));
    expect(
      offenders,
      `#496 — ward-scoped CSR jurisdiction filter not applied. CSR (${WARD_CSR_BOUNDARY}) sees ${codes.size} boundaries including: ${JSON.stringify(offenders)}`,
    ).toEqual([]);

    // Total code count must be bounded — a CSR scoped to one leaf ward
    // shouldn't see the entire admin tree.
    expect(
      codes.size,
      `#496 — code count for a single-ward CSR must be small; got ${codes.size}: ${JSON.stringify([...codes].slice(0, 10))}`,
    ).toBeLessThanOrEqual(5);
  });
});

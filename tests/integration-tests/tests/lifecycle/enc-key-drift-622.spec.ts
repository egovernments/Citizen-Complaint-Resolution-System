/**
 * Lifecycle — egov-user encryption-key drift after tenant flip + recreate (CCRS #622).
 *
 * The bug: when a deploy flips `STATE_LEVEL_TENANT_ID` (e.g. via
 * host_vars) AND restarts containers with
 * `docker compose up -d --force-recreate`, egov-enc-service
 * auto-generates a NEW symmetric key for the new tenant. Existing
 * `eg_user` rows are encrypted with the OLD key, so username-lookup
 * queries (encrypted with the new key) miss them and every
 * `/user/oauth/token` returns "Invalid login credentials".
 *
 * This spec is `.skip` by default — most deployments use
 * `docker compose up -d` WITHOUT `--force-recreate`, so the env
 * change silently no-ops on running containers and the bug never
 * fires. Run with `PLAYWRIGHT_FORCE_RECREATE_FLIP=1` on a deployment
 * that has been explicitly flipped + force-recreated to catch the
 * regression.
 *
 * Fix surface this catches: deterministic enc-key seed per tenant
 * (instead of auto-generation on first encryption call). Tracked
 * upstream as CCRS #687 (persistence story).
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

test.describe('lifecycle — enc-key drift after STATE_LEVEL_TENANT_ID flip #622', () => {
  test.skip(
    process.env.PLAYWRIGHT_FORCE_RECREATE_FLIP !== '1',
    'Set PLAYWRIGHT_FORCE_RECREATE_FLIP=1 to run — requires a deployment with STATE_LEVEL_TENANT_ID flipped + `docker compose up --force-recreate`.',
  );

  test('ADMIN can still oauth/token immediately after the flip + recreate', async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/user/oauth/token`, {
      headers: {
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: `username=${ADMIN_USER}&password=${encodeURIComponent(ADMIN_PASS)}&grant_type=password&scope=read&tenantId=${ROOT_TENANT}&userType=EMPLOYEE`,
    });

    expect(
      resp.status(),
      `#622 — oauth/token returned ${resp.status()} after the recreate; expected 2xx. Body: ${(await resp.text()).slice(0, 400)}`,
    ).toBeLessThan(400);

    const body = await resp.json();
    expect(
      typeof body.access_token,
      `#622 — oauth/token body must contain access_token; got ${JSON.stringify(body).slice(0, 300)}`,
    ).toBe('string');
    expect(body.access_token.length).toBeGreaterThan(0);
  });
});

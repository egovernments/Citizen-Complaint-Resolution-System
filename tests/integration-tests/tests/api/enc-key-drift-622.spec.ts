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
 * The regression is now fixed in-repo: the bootstrap re-provisions the
 * ADMIN user with the correct (post-flip) encryption key, so ADMIN can
 * always oauth/token on a freshly-bootstrapped deployment. That makes the
 * basic "ADMIN /user/oauth/token returns 2xx + access_token" assertion a
 * cheap always-valid guard, so it runs UNCONDITIONALLY.
 *
 * The destructive stress variant — which requires a deployment that has
 * been explicitly flipped (`STATE_LEVEL_TENANT_ID`) AND restarted with
 * `docker compose up -d --force-recreate` — stays gated behind
 * `PLAYWRIGHT_FORCE_RECREATE_FLIP=1`. Most deployments use `docker compose
 * up -d` WITHOUT `--force-recreate`, so the env change silently no-ops on
 * running containers and the bug never fires; only an operator who has
 * deliberately reproduced the flip+recreate should run it.
 *
 * Fix surface this catches: deterministic enc-key seed per tenant
 * (instead of auto-generation on first encryption call). Tracked
 * upstream as CCRS #687 (persistence story).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';

async function assertAdminCanOauth(request: APIRequestContext): Promise<void> {
  const resp = await request.post(`${BASE_URL}/user/oauth/token`, {
    headers: {
      Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: `username=${ADMIN_USER}&password=${encodeURIComponent(ADMIN_PASS)}&grant_type=password&scope=read&tenantId=${ROOT_TENANT}&userType=EMPLOYEE`,
  });

  expect(
    resp.status(),
    `#622 — oauth/token returned ${resp.status()}; expected 2xx. Body: ${(await resp.text()).slice(0, 400)}`,
  ).toBeLessThan(400);

  const body = await resp.json();
  expect(
    typeof body.access_token,
    `#622 — oauth/token body must contain access_token; got ${JSON.stringify(body).slice(0, 300)}`,
  ).toBe('string');
  expect(body.access_token.length).toBeGreaterThan(0);
}

test.describe('lifecycle — enc-key drift after STATE_LEVEL_TENANT_ID flip #622', () => {
  // Basic guard — always valid now that bootstrap re-provisions ADMIN with the
  // correct post-flip encryption key. Runs on every deployment.
  test('ADMIN can oauth/token (post-bootstrap enc-key guard)', { tag: ['@persona:system'] }, async ({ request }) => {
    await assertAdminCanOauth(request);
  });

  // Destructive stress variant — only meaningful after a real STATE_LEVEL_TENANT_ID
  // flip + `docker compose up -d --force-recreate`. Gated so it doesn't run on
  // ordinary deployments where the flip silently no-ops.
  test('ADMIN can still oauth/token immediately after a force-recreate flip', { tag: ['@persona:system'] }, async ({ request }) => {
    test.skip(
      process.env.PLAYWRIGHT_FORCE_RECREATE_FLIP !== '1',
      'Set PLAYWRIGHT_FORCE_RECREATE_FLIP=1 to run — requires a deployment with STATE_LEVEL_TENANT_ID flipped + `docker compose up --force-recreate`.',
    );
    await assertAdminCanOauth(request);
  });
});

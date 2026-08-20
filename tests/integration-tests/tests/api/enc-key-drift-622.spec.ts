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
 * There used to be a second test here gated behind
 * `PLAYWRIGHT_FORCE_RECREATE_FLIP=1`, described as the "destructive stress
 * variant" for a deployment that had been flipped and
 * `--force-recreate`d by hand. It called the SAME `assertAdminCanOauth()`
 * helper as the test above it, so setting the flag could only ever produce a
 * duplicate green — it asserted nothing the unconditional test did not, and
 * "skipped" overstated what was missing. The suite cannot own the flip itself
 * (it is a redeploy, not a request), so the destructive path stays an operator
 * procedure rather than a test.
 *
 * What replaced it is a guard the suite CAN make, unconditionally, and which is
 * strictly stronger than the ADMIN check: ADMIN is the one account bootstrap
 * re-provisions with the post-flip key, so ADMIN succeeding proves the least of
 * anyone. The seeded employees are NOT re-provisioned — their `eg_user` rows
 * keep whatever key encrypted them — so they are exactly the rows #622 broke.
 * Asserting one of them still authenticates AND still decrypts to plaintext
 * detects key drift from the outside, with no redeploy.
 *
 * How the decrypt check works: egov-enc-service stores the key id in the
 * ciphertext itself, so an encrypted column reads `<keyId>|<base64>` (tenant
 * `pg`'s active key is 489366, and every seeded `eg_user` name on that tenant is
 * `489366|…` at rest). A name that comes back still carrying that prefix is a
 * value the service could not decrypt — the visible symptom of drift — so the
 * assertion is that the returned name does NOT look like ciphertext.
 *
 * Fix surface this catches: deterministic enc-key seed per tenant
 * (instead of auto-generation on first encryption call). Tracked
 * upstream as CCRS #687 (persistence story).
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { BASE_URL, ROOT_TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { resolvePersona } from '../utils/personas';

/** egov-enc-service ciphertext shape: `<numeric key id>|<base64 payload>`. */
const CIPHERTEXT_RE = /^\d+\|/;

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

  // The rows bootstrap does NOT re-provision. See the header comment for why
  // this replaced the old PLAYWRIGHT_FORCE_RECREATE_FLIP-gated duplicate.
  test('a pre-existing seeded employee still authenticates and still decrypts', {
    annotation: {
      type: 'description',
      description: `Detects #622 enc-key drift on the rows that actually break — the seeded employees, which bootstrap does not re-provision (unlike ADMIN, whose success proves the least).

Steps:
1. Resolve a non-ADMIN employee persona from the deployment itself; self-skip if it has none.
2. POST /user/oauth/token as that employee and assert 2xx + access_token — a drifted key makes username lookup miss the row and returns "Invalid login credentials".
3. Assert the returned UserRequest.name is non-empty and does NOT match egov-enc-service's ciphertext shape /^\\d+\\|/ — a name still carrying its key-id prefix is a value the service could not decrypt.

Runs unconditionally: no flag, no redeploy, no destructive flip.`,
    },
    tag: ['@persona:system'] }, async ({ request }) => {
    // resolvePersona (not getPersona) so a deployment with no non-ADMIN employee
    // self-skips with the resolver's own diagnostic instead of throwing.
    const employee = await resolvePersona('gro-with-department');
    test.skip(!employee, 'deployment has no non-ADMIN employee persona to check enc-key drift against');
    test.skip(
      employee!.username === ADMIN_USER,
      `the only resolvable employee IS ${ADMIN_USER} — bootstrap re-provisions that account, so it cannot evidence drift`,
    );

    const resp = await request.post(`${BASE_URL}/user/oauth/token`, {
      headers: {
        Authorization: 'Basic ZWdvdi11c2VyLWNsaWVudDo=',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data:
        `username=${encodeURIComponent(employee!.username)}` +
        `&password=${encodeURIComponent(employee!.password)}` +
        `&grant_type=password&scope=read&tenantId=${employee!.tenant}&userType=EMPLOYEE`,
    });
    expect(
      resp.status(),
      `#622 — seeded employee ${employee!.username} got ${resp.status()} from oauth/token; a drifted enc key makes the username lookup miss its own row. Body: ${(await resp.text()).slice(0, 300)}`,
    ).toBeLessThan(400);

    const body = await resp.json();
    expect(typeof body.access_token, '#622 — no access_token for a seeded employee').toBe('string');

    const name = String(body?.UserRequest?.name ?? '');
    expect(name.length, `#622 — ${employee!.username} authenticated but its name came back empty`).toBeGreaterThan(0);
    expect(
      CIPHERTEXT_RE.test(name),
      `#622 — ${employee!.username}'s name came back as ciphertext (${name.slice(0, 24)}…), meaning egov-enc-service could not decrypt a row it previously encrypted`,
    ).toBe(false);
  });
});
